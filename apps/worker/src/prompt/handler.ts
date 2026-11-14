// Job 'prompt': kalimat pengguna -> operasi (AI) -> perubahan (kode) -> disimpan, dengan snapshot untuk pembatalan.
// Gagal di tengah jalan = perubahan yang sudah masuk dikembalikan. Tidak pernah mengubah status project.
import { stableStringify } from "@app/shared/prompt-undo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANALYSIS, isAllowedModel } from "@app/config";
import { Provider, type AssetRow, type JobRow, type Word } from "@app/shared";
import { saveEdlFromApproved } from "@app/shared/edl-save";
import { undoPromptRun, type UndoSnapshot } from "@app/shared/prompt-undo";
import { normalizeStyle } from "../../../../packages/remotion/src/build-props.ts";
import { loadReel } from "@app/shared/reel-db";
import { cleanupReelCache, reelSilences } from "../reel-media.ts";
import { detectSilences } from "../media.ts";
import { assetDir } from "../storage.ts";
import { rm } from "node:fs/promises";
import { planEffects } from "./effects.ts";
import { translatePrompt } from "./translate.ts";
import { analyzeReference } from "./reference.ts";
import type { ReferenceAttachment } from "@app/shared/reference";
import { listSfx } from "@app/shared/sfx-library";
import { normalizeOps, type Op } from "@app/shared/ops";

type Ctx = { db: SupabaseClient; setProgress: (fraction: number) => Promise<void> };

export async function handlePrompt(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  const runId = job.payload.promptRunId;
  if (typeof runId !== "string") throw new Error("payload.promptRunId tidak ada");
  const t0 = Date.now();

  const { data: run, error: runErr } = await db.from("prompt_runs").select("*").eq("id", runId).single();
  if (runErr || !run) throw new Error(`Perintah tidak ditemukan: ${runErr?.message}`);
  await db.from("prompt_runs").update({ status: "running" }).eq("id", runId);
  const provider = Provider.parse(run.provider);
  const requested = job.payload.model;
  const model = typeof requested === "string" && requested && isAllowedModel(provider, requested) ? requested : undefined;

  const { data: project } = await db.from("projects").select("style").eq("id", job.project_id).single();
  // Fase 16: semua video project pada sumbu reel; transkrip milik video utama
  const reel = await loadReel(db, job.project_id);
  if (!reel.primary) throw new Error("Video mentah tidak ditemukan");
  const asset = reel.primary;
  const durationS = reel.durationS;
  if (!(durationS > 0)) throw new Error("Durasi video belum diketahui (ingest belum selesai)");

  const { data: trRow } = await db.from("transcripts").select("id,words,original_words").eq("asset_id", asset.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  // Fase 12: transkrip dibuat saat diminta. Tanpa transkrip, perintah gaya/kamera/noise/judul tetap jalan;
  // perintah yang menyebut kata ucapan tidak menemukan apa pun dan diberi petunjuk di bawah.
  const words = (trRow?.words ?? []) as Word[];

  const { data: sugRows } = await db.from("cut_suggestions").select("start_s,end_s,status").eq("project_id", job.project_id);
  const existing = (sugRows ?? []).map((s) => ({ start: Number(s.start_s), end: Number(s.end_s) }));
  const style = normalizeStyle(project?.style as never);
  const sfxLibrary = listSfx();

  await setProgress(0.1);
  let referenceOps: Op[] = [];
  let referenceStyle = style;
  const referenceMessages: string[] = [];
  let referenceSummary: string | undefined;
  if (job.payload.reference) {
    const reference = job.payload.reference as ReferenceAttachment;
    const visual = await analyzeReference(job.project_id, reference, run.prompt, provider, model);
    referenceOps = visual.ops;
    referenceSummary = visual.report.summary;
    const planned = await planEffects(referenceOps, { words, durationS, style, existing, getSilences: async () => [] });
    referenceStyle = planned.style ?? style;
    referenceMessages.push(`Referensi ${reference.label}: ${visual.report.frameCount} frame diperiksa dari ${reference.startS}–${(reference.startS + visual.report.sampledSeconds).toFixed(1)} dtk.`, `Pengamatan referensi: ${visual.report.summary}`, "Analisis berupa sampel visual; audio dan gerakan di sela sampel tidak diperiksa.", ...visual.report.limitations.map((s) => `Batas referensi: ${s}`));
    await db.from("jobs").update({ payload: { ...job.payload, referenceReport: visual.report } }).eq("id", job.id);
    await setProgress(0.4);
  }
  const userTranslation = await translatePrompt(provider, run.prompt, {
    referenceApplied: referenceOps.length > 0,
    referenceSummary,
    durationS,
    wordCount: words.length,
    style: { styleId: referenceStyle.styleId, aspect: referenceStyle.aspect, camera: referenceStyle.camera, captions: referenceStyle.captions, effects: referenceStyle.effects, cameraOverrides: referenceStyle.cameraOverrides.length, params: referenceStyle.params },
    pending: (sugRows ?? []).filter((s) => s.status === "pending").length,
    approved: (sugRows ?? []).filter((s) => s.status === "approved").length,
    sfx: sfxLibrary.map((x) => ({ name: x.name, tags: x.tags })),
  }, model);
  const combined = normalizeOps(userTranslation.ops.some((op) => op.type === "undo_last") ? userTranslation.ops : [...referenceOps, ...userTranslation.ops]);
  const translation = { ...userTranslation, ...combined, rejected: [...userTranslation.rejected, ...combined.rejected] };
  await setProgress(0.6);

  const messages: string[] = [
    ...referenceMessages,
    ...translation.rejected.map((r) => `Perintah tidak dijalankan: ${r.reason}`),
    ...userTranslation.unsupported.map((u) => `Belum didukung: ${u}`),
  ];
  let undo: UndoSnapshot = {};

  if (translation.ops.some((o) => o.type === "undo_last")) {
    const r = await undoPromptRun(db, job.project_id);
    messages.push(...r.messages);
  } else if (translation.ops.length > 0) {
    const getSilences = (minSec: number) => reelSilences(reel, ANALYSIS.silenceThresholdDb, minSec);
    const fx = await planEffects(translation.ops, { words, durationS, style, existing, getSilences, sfxLibrary });
    messages.push(...fx.messages);
    const needsSpeech: string[] = ["propose_cut_phrase", "emphasize_phrase", "highlight_phrase", "auto_highlight", "fix_word"];
    if (!trRow && translation.ops.some((o) => needsSpeech.includes(o.type) || (o.type === "add_sfx" && !!o.phrase))) {
      messages.push("Belum ada transkrip, jadi perintah yang menyebut kata ucapan belum bisa dijalankan. Tekan Auto subtitle atau Auto cut di workspace untuk membuat transkrip, lalu kirim ulang perintah ini.");
    }

    // ---- simpan; bila gagal di tengah, kembalikan yang sudah masuk
    const createdIds: string[] = [];
    const styleBefore = (project?.style ?? {}) as Record<string, unknown>;
    let styleWritten = false;
    let styleWrittenAt = "";
    let wordsWritten = false;
    try {
      for (let i = 0; i < fx.suggestions.length; i += 200) {
        const batch = fx.suggestions.slice(i, i + 200).map((s) => ({ ...s, project_id: job.project_id, prompt_run_id: runId }));
        const { data, error } = await db.from("cut_suggestions").insert(batch).select("id");
        if (error) throw new Error(`Gagal menyimpan usulan: ${error.message}`);
        createdIds.push(...(data ?? []).map((d) => d.id as string));
      }
      if (fx.style) {
        // Gaya tidak boleh berubah selama AI bekerja: bandingkan di kode, lalu kunci dengan updated_at baris yang dibaca
        // (filter isi gaya lewat URL gagal untuk gaya besar: "Bad Request").
        const { data: fresh } = await db.from("projects").select("style,updated_at").eq("id", job.project_id).single();
        if (stableStringify(normalizeStyle(fresh?.style as never)) !== stableStringify(normalizeStyle(project?.style as never))) throw new Error("Edit berubah saat AI bekerja. Hasil AI tidak menimpa edit terbaru; kirim ulang prompt untuk memakai versi terbaru.");
        const { data: updated, error } = await db.from("projects").update({ style: fx.style }).eq("id", job.project_id).eq("updated_at", fresh!.updated_at).select("updated_at");
        if (error) throw new Error(`Gagal menyimpan gaya: ${error.message}`);
        if (!updated?.length) throw new Error("Edit berubah saat AI bekerja. Hasil AI tidak menimpa edit terbaru; kirim ulang prompt untuk memakai versi terbaru.");
        styleWritten = true;
        styleWrittenAt = updated[0].updated_at as string;
      }
      if (fx.wordFixes.length && trRow) {
        const next = words.map((w) => ({ ...w }));
        for (const f of fx.wordFixes) next[f.index] = { ...next[f.index], text: f.after };
        // hasil mesin disimpan sekali di original_words (sama dengan koreksi lewat layar)
        const patch: Record<string, unknown> = { words: next };
        if (trRow.original_words == null) patch.original_words = trRow.words;
        const { error } = await db.from("transcripts").update(patch).eq("id", trRow.id);
        if (error) throw new Error(`Gagal menyimpan koreksi kata: ${error.message}`);
        wordsWritten = true;
      }
    } catch (e) {
      // pemulihan sebisanya
      if (createdIds.length) await db.from("cut_suggestions").delete().in("id", createdIds);
      if (styleWritten) await db.from("projects").update({ style: styleBefore }).eq("id", job.project_id).eq("updated_at", styleWrittenAt);
      if (wordsWritten && trRow) await db.from("transcripts").update({ words: trRow.words }).eq("id", trRow.id);
      throw e;
    }
    undo = {
      suggestionIds: createdIds,
      styleBefore: fx.style ? styleBefore : undefined,
      styleAfter: fx.style ? (fx.style as unknown as Record<string, unknown>) : undefined,
      transcriptId: fx.wordFixes.length && trRow ? (trRow.id as string) : undefined,
      wordFixes: fx.wordFixes.length ? fx.wordFixes : undefined,
    };

    // ---- render (setelah perubahan lain tersimpan)
    if (fx.render) {
      const renderStyle = normalizeStyle({ ...(fx.style ?? style), ...(fx.render.aspect ? { aspect: fx.render.aspect } : {}) });
      const saved = await saveEdlFromApproved(db, job.project_id, renderStyle as unknown as Record<string, unknown>, null);
      if (!saved.edl) messages.push(`Render tidak dimulai: ${saved.error}`);
      else {
        const { error } = await db.from("jobs").insert({
          project_id: job.project_id,
          type: "render",
          payload: { edlId: saved.edl.id, edlVersion: saved.edl.version, style: renderStyle },
        });
        const approvedCount = Number((saved.edl.params as { approvedCount?: number }).approvedCount ?? 0);
        if (error) messages.push(error.code === "23505" ? "Render tidak dimulai: masih ada render yang berjalan." : `Render tidak dimulai: ${error.message}`);
        else
          messages.push(
            `Render dimulai dari EDL v${saved.edl.version} (rasio ${renderStyle.aspect}). Hanya ${approvedCount} potongan yang SUDAH Anda setujui yang diterapkan; usulan yang belum diputuskan tidak ikut dipotong.`,
          );
      }
    }
  }

  // Pesan buatan kode adalah satu-satunya kebenaran tentang apa yang berubah; balasan AI hanya catatan.
  if (translation.ops.length === 0 && messages.length === 0) messages.push("Tidak ada perubahan yang dilakukan: perintah ini tidak bisa diterjemahkan ke operasi yang didukung.");

  await db
    .from("prompt_runs")
    .update({
      status: "done",
      reply: translation.reply,
      ops: translation.ops,
      rejected: translation.rejected,
      messages,
      undo,
      duration_ms: Date.now() - t0,
      finished_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", runId);
  await cleanupReelCache(reel); // cache audio sementara (bila dipakai)
}

