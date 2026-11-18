import { existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRANSCRIPT_FIX, ANALYSIS, VIDEO } from "@app/config";
import { Provider, resolveMediaPath, type AssetRow, type JobRow, type Word } from "@app/shared";
import { analyzeWithLlm, buildSuggestionRows } from "./analyze/run.ts";
import { renderEdited } from "./render.ts";
import { RENDER_CANCELLED, watchRenderCancel } from "./render-cancel.ts";
import { loadCreativeCode, type CreativeCodeRow } from "@app/shared/creative-store";
import { getSfx, loadCreativeSfx } from "@app/shared/sfx-library";
import { loadReel, rawLabel } from "@app/shared/reel-db";
import { nextOffset } from "@app/shared/reel";
import { cleanupReelCache, reelRenderSources, reelSilences, transcribeReel } from "./reel-media.ts";
import { loadImageMaterials } from "./creative/materials.ts";
import { talentFacesById } from "./talent.ts";
import { fixTranscript } from "./transcript-fix.ts";
import { loadGlossary } from "@app/shared/glossary";
import { loadCreativeFonts, type FontRef } from "@app/shared/font-library";
import { fontServeFiles } from "./creative/handler.ts";

/** Fase 24: font versi kreatif untuk props (src diisi server lokal di renderEdited lewat id yang sama). */
const fontsForProps = (fonts: FontRef[]) => fonts.map((f) => ({ id: f.id, family: f.family, weight: f.weight, src: "" }));
import { materialAssets } from "../../../packages/remotion/src/motion-props.ts";
import { creativeErrorsFromLogs } from "./creative/stills.ts";
import { buildEditedProps, normalizeStyle, seedFrom } from "../../../packages/remotion/src/build-props.ts";
import { detectSilences, extractAudioWav, extractSegmentsWav, probe } from "./media.ts";
import { mapWordsFromConcat, transcriptSegments } from "@app/shared/transcript-segments";
import { subtractRange, unionRanges } from "@app/shared/manual";
import { assetDir, hashFile } from "./storage.ts";
import { ensureDenoised } from "./derived.ts";
import { handleMotionRender } from "./creative/motion-render.ts";
import { transcribeWav } from "./whisper.ts";

type Ctx = { db: SupabaseClient; setProgress: (fraction: number) => Promise<void> };

async function getAsset(db: SupabaseClient, assetId: unknown): Promise<AssetRow> {
  if (typeof assetId !== "string") throw new Error("payload.assetId tidak ada");
  const { data, error } = await db.from("assets").select("*").eq("id", assetId).single();
  if (error || !data) throw new Error(`Aset tidak ditemukan: ${error?.message}`);
  return data as AssetRow;
}

/**
 * Ingest video mentah: checksum, metadata, audio untuk Whisper, posisi reel (Fase 16). Video lain di project yang belum
 * diingest (mis. job-nya tertolak indeks lama satu-job-per-project) ikut diproses di job ini.
 */
export async function handleIngest(job: JobRow, ctx: Ctx): Promise<void> {
  const { db } = ctx;
  const first = await getAsset(db, job.payload.assetId);
  if (first.kind !== "raw") throw new Error("Ingest hanya untuk aset mentah");
  const done = new Set<string>();
  for (let asset: AssetRow | undefined = first; asset; ) {
    await ingestOne(job, ctx, asset);
    done.add(asset.id);
    const reel = await loadReel(db, job.project_id);
    asset = reel.assets.find((a) => !done.has(a.id) && !(Number(a.duration_s) > 0) && existsSync(resolveMediaPath(a.storage_path)));
  }
  await db.from("projects").update({ status: "ready", error: null }).eq("id", job.project_id);
}

async function ingestOne(job: JobRow, { db, setProgress }: Ctx, asset: AssetRow): Promise<void> {
  // Video tambahan untuk project yang sudah siap: editor tetap bisa dipakai selama video baru diproses
  const before = await loadReel(db, job.project_id);
  if (!before.clips.some((c) => c.id !== asset.id)) await db.from("projects").update({ status: "ingesting" }).eq("id", job.project_id);

  const dir = assetDir(asset.id);
  await rm(dir, { recursive: true, force: true }); // hanya cache sementara, bukan file mentah
  await mkdir(dir, { recursive: true });
  const rawFile = resolveMediaPath(asset.storage_path); // dibaca langsung dari disk, tidak disalin
  const wavFile = path.join(dir, "audio.wav");
  if (!existsSync(rawFile)) throw new Error(`File mentah tidak ada di disk: ${asset.storage_path}`);

  const { sha256, sizeBytes } = await hashFile(rawFile, (f) => setProgress(f * 0.6));

  const info = await probe(rawFile);
  if (!info.hasAudio) {
    throw new Error(`${rawLabel(asset)}: video tidak punya audio. Aplikasi ini hanya untuk video bicara.`);
  }
  if (!(info.durationS > 0)) throw new Error(`${rawLabel(asset)}: durasi video tidak terbaca`);

  // Fase 16: posisi tetap di sumbu reel (setelah video terakhir + jarak). Video yang sudah punya posisi tidak dipindah.
  const others = before.clips.filter((c) => c.id !== asset.id);
  const offset = asset.reel_offset_s != null ? Number(asset.reel_offset_s) : nextOffset(others, VIDEO.reelGapSec);
  const meta = { sha256, size_bytes: sizeBytes, duration_s: info.durationS, width: info.width, height: info.height, fps: info.fps };
  let { error: upErr } = await db.from("assets").update({ ...meta, reel_offset_s: offset }).eq("id", asset.id);
  // Migrasi Fase 16 belum dijalankan: hanya project satu video yang bisa jalan
  if (upErr && /reel_offset_s/.test(upErr.message)) {
    if (others.length) throw new Error("Project ini punya lebih dari satu video. Jalankan supabase/migrations/20261030150000_fase16_multi_video.sql di SQL Editor Supabase, lalu coba ulang.");
    ({ error: upErr } = await db.from("assets").update(meta).eq("id", asset.id));
  }
  if (upErr) throw new Error(`Gagal menyimpan metadata: ${upErr.message}`);
  await setProgress(0.7);

  await extractAudioWav(rawFile, wavFile);
  await setProgress(0.95);

  // Fase 11: salinan pratinjau bila browser tidak bisa memutar file mentah (mis. MOV HEVC).
  // Gagal mengantre (mis. migrasi belum dijalankan) tidak menggagalkan ingest.
  const { error: prevErr } = await db.from("jobs").insert({ project_id: job.project_id, type: "preview", payload: { assetId: asset.id } });
  if (prevErr) console.error("[ingest] salinan pratinjau tidak diantrekan:", prevErr.message);
  // Fase 12: tidak ada proses di depan. Transkrip dibuat saat diminta di workspace (Auto cut / Auto subtitle).
}

/** Pastikan audio.wav ada (kalau cache hilang, ekstrak ulang dari file mentah). */
export async function ensureWav(asset: AssetRow): Promise<string> {
  const dir = assetDir(asset.id);
  const wavFile = path.join(dir, "audio.wav");
  if (existsSync(wavFile)) return wavFile;
  await mkdir(dir, { recursive: true });
  await extractAudioWav(resolveMediaPath(asset.storage_path), wavFile);
  return wavFile;
}

export async function handleTranscribe(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  const asset = await getAsset(db, job.payload.assetId);

  // Fase 12: transkrip yang sudah ada tapi belum mencakup potongan sekarang (bagian dipulihkan) -> transkrip HANYA bagian
  // yang belum ada lalu gabungkan. Kata lama, termasuk koreksi pengguna, tidak disentuh.
  const wanted = Array.isArray(job.payload.segments) ? transcriptSegments(job.payload.segments as Array<{ start: number; end: number }>) : null;
  const fresh = job.payload.fresh === true;
  if (wanted?.length && !fresh) {
    const { data: latest } = await db.from("transcripts").select("*").eq("asset_id", asset.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const coverage = latest?.segments as Array<{ start: number; end: number }> | null | undefined;
    if (latest && coverage) {
      let missing = wanted;
      for (const c of coverage) missing = subtractRange(missing, c);
      missing = transcriptSegments(missing.filter((m) => m.end - m.start > 0.3));
      if (missing.length) {
        await db.from("projects").update({ status: "transcribing" }).eq("id", job.project_id);
        // Fase 16: tiap video didengar sendiri, waktu kata dalam waktu reel
        const r = await transcribeReel(await loadReel(db, job.project_id), missing, job.id, (f) => void setProgress(f * 0.85));
        // Koreksi AI hanya untuk kata BARU; kata lama (termasuk koreksi pengguna) tidak disentuh
        const added = (await correctTranscript(db, job, r.words)).words;
        const merged = [...(latest.words as Word[]), ...added].sort((a, b) => a.start - b.start);
        const { error } = await db.from("transcripts").update({ words: merged, segments: unionRanges([...coverage, ...missing]) }).eq("id", latest.id);
        if (error) throw new Error(`Gagal memperbarui transkrip: ${error.message}`);
      }
      await db.from("projects").update({ status: "ready", error: null }).eq("id", job.project_id);
      await cleanupReelCache(await loadReel(db, job.project_id));
      await queueNext(db, job);
      return;
    }
  }

  // Koreksi manual pengguna tidak boleh hilang: bila transkrip terbaru sudah pernah dikoreksi,
  // jangan ganti dengan hasil mesin yang baru.
  const { count: editedCount } = await db
    .from("transcripts")
    .select("id", { count: "exact", head: true })
    .eq("asset_id", asset.id)
    .not("original_words", "is", null);
  // "Generate ulang subtitle" (fresh) sengaja membuat transkrip baru dari klip sekarang; transkrip lama tetap di DB
  if ((editedCount ?? 0) > 0 && !fresh) {
    console.log(`[worker] transkrip untuk ${asset.id} sudah dikoreksi pengguna; transkrip ulang dilewati`);
    await db.from("projects").update({ status: "ready", error: null }).eq("id", job.project_id);
    await rm(assetDir(asset.id), { recursive: true, force: true });
    await queueNext(db, job);
    return;
  }

  await db.from("projects").update({ status: "transcribing" }).eq("id", job.project_id);

  // Fase 12: transkrip dari video yang SUDAH dipotong. Hanya audio segmen yang dipertahankan yang didengar Whisper
  // (take yang salah tidak ikut), lalu waktu kata dipetakan kembali ke video mentah.
  // Fase 16: per video, waktu kata dalam waktu reel (transkrip project tetap satu, milik video utama)
  const segments = Array.isArray(job.payload.segments) ? transcriptSegments(job.payload.segments as Array<{ start: number; end: number }>) : null;
  const reel = await loadReel(db, job.project_id);
  let lastReported = 0;
  const result = await transcribeReel(reel, segments?.length ? segments : null, job.id, (f) => {
    // batasi tulis DB: tiap kenaikan >= 2%
    if (f - lastReported >= 0.02) {
      lastReported = f;
      void setProgress(f * 0.85);
    }
  });

  const language = result.language ?? "id", model = result.model;
  const words = result.words;
  if (words.length === 0) {
    throw new Error(segments?.length ? "Whisper tidak menemukan ucapan di bagian video yang dipertahankan" : "Whisper tidak menemukan ucapan di video ini");
  }

  // Koreksi AI (bawaan Opus 5.5): kata salah dengar diperbaiki dari konteks. Hasil mesin disimpan di original_words.
  const fixed = await correctTranscript(db, job, words);
  const row: Record<string, unknown> = { asset_id: asset.id, language, engine: "whisper.cpp", model, words: fixed.words, ...(fixed.changes ? { original_words: words } : {}) };
  let { error } = await db.from("transcripts").insert(segments?.length ? { ...row, segments } : row);
  // Migrasi 20261029120000 belum dijalankan: simpan tanpa catatan cakupan (dianggap seluruh video)
  if (error && segments?.length && /segments/.test(error.message)) ({ error } = await db.from("transcripts").insert(row));
  if (error) throw new Error(`Gagal menyimpan transkrip: ${error.message}`);

  await db.from("projects").update({ status: "ready", error: null }).eq("id", job.project_id);
  await cleanupReelCache(reel);
  await queueNext(db, job);
}

/**
 * Koreksi transkrip oleh AI sesudah Whisper. Ringkasan (koreksi + yang ragu) dicatat di payload job untuk tab Transkrip.
 * CLI tidak siap / gagal = kata Whisper apa adanya + catatan (transkripsi tetap berhasil).
 */
async function correctTranscript(db: SupabaseClient, job: JobRow, words: Word[]): Promise<{ words: Word[]; changes: number }> {
  if (!TRANSCRIPT_FIX.enabled || !words.length || job.payload.aiFix === false) return { words, changes: 0 };
  await db.from("jobs").update({ payload: { ...job.payload, stageLabel: "Koreksi AI (Opus 5.5)" } }).eq("id", job.id);
  try {
    const r = await fixTranscript(words, { glossary: loadGlossary() });
    console.log(`[transkrip] koreksi AI ${r.model}: ${r.changes.length} koreksi, ${r.doubts.length} ragu, ${r.dropped} dibuang`);
    await db.from("jobs").update({ payload: { ...job.payload, aiFix: { model: r.model, changes: r.changes.slice(0, 300), doubts: r.doubts, dropped: r.dropped } } }).eq("id", job.id);
    return { words: r.words, changes: r.changes.length };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.error(`[transkrip] koreksi AI gagal: ${message}`);
    await db.from("jobs").update({ payload: { ...job.payload, aiFix: { error: message } } }).eq("id", job.id);
    return { words, changes: 0 };
  }
}

/**
 * Fase 12: transkrip yang diminta Auto cut langsung dilanjutkan ke analisis (run sudah dibuat oleh rute web).
 * Payload `next` = { type: "analyze", runId, provider }.
 */
async function queueNext(db: SupabaseClient, job: JobRow): Promise<void> {
  const next = job.payload.next as { type?: string; runId?: string; provider?: string; model?: string } | undefined;
  if (next?.type !== "analyze" || typeof next.runId !== "string") return;
  await db.from("projects").update({ status: "analyzing" }).eq("id", job.project_id);
  const { error } = await db.from("jobs").insert({ project_id: job.project_id, type: "analyze", payload: { assetId: job.payload.assetId, runId: next.runId, provider: next.provider, ...(next.model ? { model: next.model } : {}) } });
  if (error) {
    await db.from("analysis_runs").update({ status: "failed", error: `Gagal memulai analisis: ${error.message}`, finished_at: new Date().toISOString() }).eq("id", next.runId);
    await db.from("projects").update({ status: "ready" }).eq("id", job.project_id);
    throw new Error(`Transkrip selesai, tetapi analisis gagal dimulai: ${error.message}`);
  }
}

/**
 * Analisis cut: LLM (Claude Code CLI / Codex CLI) + aturan (filler) + ffmpeg silencedetect.
 * Hanya MENGUSULKAN. Semua baris lahir 'pending' (aturan 2); EDL tidak disentuh di sini.
 */
export async function handleAnalyze(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  const runId = job.payload.runId;
  const provider = Provider.parse(job.payload.provider);
  if (typeof runId !== "string") throw new Error("payload.runId tidak ada");

  const t0 = Date.now();
  await db.from("analysis_runs").update({ status: "running" }).eq("id", runId);
  await db.from("projects").update({ status: "analyzing" }).eq("id", job.project_id);

  const asset = await getAsset(db, job.payload.assetId);
  const { data: tr, error: trErr } = await db
    .from("transcripts")
    .select("words")
    .eq("asset_id", asset.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (trErr || !tr) throw new Error("Transkrip belum ada. Selesaikan transkrip dulu.");
  const words = tr.words as Word[];
  if (words.length === 0) throw new Error("Transkrip kosong");

  // Jeda dari audio asli (bukan dari timestamp Whisper yang kurang presisi). Fase 16: semua video, waktu reel.
  const reel = await loadReel(db, job.project_id);
  const silences = await reelSilences(reel, ANALYSIS.silenceThresholdDb, ANALYSIS.minPauseSec);
  await setProgress(0.1);

  // Model pilihan pengguna (divalidasi lagi di runProvider terhadap AI_MODELS)
  const model = typeof job.payload.model === "string" ? job.payload.model : undefined;
  const llm = await analyzeWithLlm(provider, words, (f) => setProgress(0.1 + f * 0.8), model);
  const rows = buildSuggestionRows(words, llm, silences);
  // Potongan di ujung video diperluas ke tepi file; jangan melewati durasi sebenarnya
  const maxEnd = reel.durationS;
  if (maxEnd > 0) {
    for (const r of rows) {
      r.end_s = Math.min(r.end_s, maxEnd);
      r.orig_end_s = Math.min(r.orig_end_s, maxEnd);
    }
  }

  // Job bisa diulang setelah worker mati: bersihkan usulan setengah jadi dari run yang sama
  await db.from("cut_suggestions").delete().eq("run_id", runId);

  // Sisipkan bertahap
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((r) => ({ ...r, run_id: runId, project_id: job.project_id }));
    const { error } = await db.from("cut_suggestions").insert(batch);
    if (error) throw new Error(`Gagal menyimpan usulan: ${error.message}`);
  }

  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  await db
    .from("analysis_runs")
    .update({
      status: "done",
      model: llm.stats.model,
      duration_ms: Date.now() - t0,
      finished_at: new Date().toISOString(),
      error: null,
      stats: {
        total: rows.length,
        byKind,
        words: words.length,
        silences: silences.length,
        chunks: llm.stats.chunks,
        retries: llm.stats.retries,
        droppedInvalid: llm.stats.droppedInvalid,
        usage: llm.stats.usage,
      },
    })
    .eq("id", runId);
  await db.from("projects").update({ status: "ready", error: null }).eq("id", job.project_id);
  await cleanupReelCache(reel);
}

/**
 * Render MP4 dari EDL. File mentah hanya DIBACA; hasil ditulis sebagai aset 'output' baru.
 * Kegagalan render tidak mengubah status project (video dan EDL tetap utuh).
 */
export async function handleRender(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  // Fase 13: project motion graphics tidak punya EDL/video mentah
  if (job.payload.mode === "motion") return handleMotionRender(job, { db, setProgress });
  const edlId = job.payload.edlId;
  if (typeof edlId !== "string") throw new Error("payload.edlId tidak ada");

  const { data: edl, error: edlErr } = await db.from("edl").select("*").eq("id", edlId).maybeSingle();
  if (edlErr || !edl) throw new Error("EDL tidak ditemukan");
  const segments = z.array(z.object({ start: z.number().min(0), end: z.number() })).parse(edl.segments);
  if (segments.length === 0) throw new Error("EDL tidak punya segmen");

  // Fase 16: semua video project (reel). Video utama memberi fps/ukuran sumber dan memiliki transkrip.
  const reel = await loadReel(db, job.project_id);
  const raw = reel.primary;
  if (!raw) throw new Error("Video mentah tidak ditemukan");
  if (!raw.width || !raw.height || !raw.fps || !raw.duration_s) throw new Error("Metadata video belum lengkap (ingest belum selesai)");

  const sourceFile = resolveMediaPath(raw.storage_path);
  if (!existsSync(sourceFile)) throw new Error(`File mentah tidak ada di disk: ${raw.storage_path}`);

  const rel = `projects/${job.project_id}/output/edl-v${edl.version}-${Date.now()}.mp4`;
  const finalFile = resolveMediaPath(rel);
  const partFile = finalFile + ".part.mp4"; // ekstensi .mp4 agar ffmpeg menentukan format
  await mkdir(path.dirname(finalFile), { recursive: true });

  const fps = Number(raw.fps);

  // Transkrip TERBARU (termasuk koreksi pengguna) + gaya: payload job > EDL > bawaan
  const { data: tr } = await db
    .from("transcripts")
    .select("words")
    .eq("asset_id", raw.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const words = ((tr?.words ?? []) as Word[]).map((w) => ({ text: w.text, start: w.start, end: w.end }));
  const style = normalizeStyle((job.payload.style ?? (edl.params as { style?: unknown })?.style) as never);
  // Mode Kreatif: versi yang tercatat di gaya JOB ini (bukan yang aktif saat render berjalan).
  // Versi yang hilang/gagal menggagalkan render, bukan diam-diam merender tanpa layer kreatif.
  let creative: CreativeCodeRow | null = null;
  const renderFonts: FontRef[] = [];
  const images = await loadImageMaterials(db, job.project_id);
  if (style.creativeId) {
    const loaded = await loadCreativeCode(db, job.project_id, style.creativeId);
    if (!loaded.ok) throw new Error(`Mode Kreatif: ${loaded.error}`);
    creative = { ...loaded.code, sfx: loadCreativeSfx(job.project_id, style.creativeId), fonts: fontsForProps(loadCreativeFonts(job.project_id, style.creativeId)) };
    renderFonts.push(...loadCreativeFonts(job.project_id, style.creativeId));
  }
  // Fase 18: klip akhir. Versi yang hilang menggagalkan render, bukan diam-diam mengekspor tanpa CTA.
  let endClip: CreativeCodeRow | null = null;
  if (style.endClip) {
    const loaded = await loadCreativeCode(db, job.project_id, style.endClip.versionId);
    if (!loaded.ok) throw new Error(`Klip akhir: ${loaded.error}`);
    if (!loaded.code.overlay) throw new Error("Klip akhir: versi ini tidak punya kode animasi.");
    endClip = { ...loaded.code, sfx: loadCreativeSfx(job.project_id, style.endClip.versionId), fonts: fontsForProps(loadCreativeFonts(job.project_id, style.endClip.versionId)) };
    renderFonts.push(...loadCreativeFonts(job.project_id, style.endClip.versionId));
  }
  const built = buildEditedProps({
    segments,
    source: { width: raw.width, height: raw.height, fps, durationS: reel.durationS },
    words,
    style,
    seed: seedFrom(edl.id),
    creative,
    sfxLength: (sid) => getSfx(sid)?.durationS,
    // Fase 15: gambar/logo hanya bila ada kode kreatif; src diisi server lokal di renderEdited
    creativeAssets: creative || endClip ? materialAssets(images.materials, () => "", undefined, { imagesOnly: true }) : undefined,
    clips: reel.clips,
    endClip,
    // Fase 24: blur wajah / teks di belakang talent (hanya bila talent sudah disiapkan)
    talent: creative ? talentFacesById(job.project_id, reel.clips.map((c) => c.id)) : undefined,
  });
  // Jangan pernah merender rencana kamera yang melanggar aturan (tepi hitam, preset berulang, dll.)
  if (built.cameraErrors.length > 0) throw new Error(`Rencana kamera tidak valid: ${built.cameraErrors[0]}`);
  const expectedFrames = built.durationInFrames;
  // Fase 11: "Kurangi noise" aktif = audio hasil noisereduce (dibuat sekarang bila belum ada). Gagal = render gagal,
  // bukan diam-diam memakai audio mentah.
  // Fase 16: per video (audio hasil noisereduce masing-masing)
  const sources = await reelRenderSources(reel, style.params["audio.kurangiNoise"]);
  const audioFile = sources.find((x) => x.id === raw.id)?.audioFile ?? null;
  // Error kode kreatif per frame: frame itu tanpa layer kreatif (error boundary), lalu DILAPORKAN di job
  const browserLogs: string[] = [];
  let last = 0;
  const cancel = watchRenderCancel(db, job.id);
  try {
  if (await cancel.check()) throw new Error(RENDER_CANCELLED);
  // Satu kali coba ulang: sekali teramati gagal sesaat di folder sementara Windows (ffmpeg tidak bisa menulis
  // ke folder audio-mixing) lalu berhasil di percobaan berikutnya tanpa perubahan apa pun.
  for (let attempt = 1; ; attempt++) {
    try {
      await renderEdited({
        cancelSignal: cancel.cancelSignal,
        sourceFile,
        outFile: partFile,
        props: built.props,
        audioFile,
        sources,
        materials: [...images.files, ...fontServeFiles(renderFonts)],
        retry: attempt > 1,
        onBrowserLog: creative || endClip ? (t) => { if (t.includes("[kreatif]") && browserLogs.length < 200) browserLogs.push(t); } : undefined,
        onProgress: (f) => {
          if (f - last >= 0.02) {
            last = f;
            void setProgress(0.02 + f * 0.96);
          }
        },
      });
      break;
    } catch (e) {
      await rm(partFile, { force: true });
      // Dibatalkan pengguna: berhenti, jangan mencoba ulang
      if (cancel.cancelled() || await cancel.check()) throw new Error(RENDER_CANCELLED);
      if (attempt >= 2) throw e;
      console.error(`[worker] render gagal (percobaan ${attempt}), mengulang:`, e instanceof Error ? e.message.split("\n")[0] : e);
      last = 0;
    }
  }
  } finally {
    cancel.stop();
  }

  // Verifikasi hasil dengan ffprobe, bukan percaya begitu saja
  const out = await probe(partFile);
  const expectedS = expectedFrames / fps;
  if (!out.hasAudio) {
    await rm(partFile, { force: true });
    throw new Error("Hasil render tidak punya audio");
  }
  if (out.width !== built.props.width || out.height !== built.props.height) {
    await rm(partFile, { force: true });
    throw new Error(`Ukuran hasil ${out.width}x${out.height} tidak sesuai harapan ${built.props.width}x${built.props.height}`);
  }
  if (Math.abs(out.durationS - expectedS) > 0.25) {
    await rm(partFile, { force: true });
    throw new Error(`Durasi hasil ${out.durationS.toFixed(2)} dtk tidak sesuai EDL (${expectedS.toFixed(2)} dtk)`);
  }
  // Dibatalkan tepat saat render selesai: hasil dibuang, tidak dicatat
  if (await cancel.check()) { await rm(partFile, { force: true }); throw new Error(RENDER_CANCELLED); }

  await rename(partFile, finalFile);
  const size = (await stat(finalFile)).size;
  const { data: outAsset, error } = await db
    .from("assets")
    .insert({
      project_id: job.project_id,
      kind: "output",
      storage_bucket: "local",
      storage_path: rel,
      size_bytes: size,
      duration_s: out.durationS,
      width: out.width,
      height: out.height,
      fps: out.fps,
      edl_id: edl.id,
    })
    .select("id")
    .single();
  if (error || !outAsset) throw new Error(`Gagal mencatat hasil render: ${error?.message}`);
  const creativeErrors = creativeErrorsFromLogs(browserLogs).slice(0, 20);
  if (creativeErrors.length) console.error(`[worker] render selesai dengan ${creativeErrors.length} error kode kreatif:`, creativeErrors[0]);

  await db
    .from("jobs")
    .update({ payload: { ...job.payload, outputAssetId: outAsset.id, style, cameraMoves: built.props.camera.length, captionPages: built.props.pages.length, creativeVersionId: style.creativeId ?? null, creativeErrors } })
    .eq("id", job.id);
}
