// Job 'voiceover' (Fase 17): naskah pengguna -> arahan Codex CLI (naskah baca + emosi, intonasi, tempo, jeda) -> suara kloning VoxCPM2 (lokal) dari rekaman
// pengguna -> waktu kata Whisper -> voice over aktif project. Motion tetap ditulis Claude Code; job ini hanya menyiapkan suaranya.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CREATIVE, MOTION_GFX } from "@app/config";
import type { JobRow } from "@app/shared";
import { buildDirectionPrompt, checkReading, checkSegments, DIRECTION_SCHEMA, parseDirection, ttsChunks, uploadedVoiceoverInfo, wavDurationS, type VoiceoverInfo, type VoiceProfile } from "@app/shared/voiceover";
import { loadVoiceProfile, saveVoiceover, voiceoverAudioPath, voiceoverUploadPath, voiceProfileAudioPath } from "@app/shared/voiceover-store";
import { runProvider } from "./analyze/providers.ts";
import { REPO_ROOT } from "./creative/workdir.ts";
import { encodeAac, extractAudioWav } from "./media.ts";
import { WORKER_TMP } from "./temp-dir.ts";
import { transcribeWav } from "./whisper.ts";

const VO = MOTION_GFX.voiceover;

type Ctx = { db: SupabaseClient; setProgress: (fraction: number) => Promise<void> };
type Stage = "arahan" | "memuat" | "suara" | "waktu" | "simpan";
type StageTable<S extends string> = Record<S, { label: string; progress: number }>;
// Porsi terbesar untuk suara: di CPU langkah ini memakan puluhan menit
const STAGE: StageTable<Stage> = {
  arahan: { label: "Codex mengarahkan naskah baca dan intonasi", progress: 0.01 },
  memuat: { label: "Memuat model suara", progress: 0.03 },
  suara: { label: "Membuat suara", progress: 0.1 },
  waktu: { label: "Mencatat waktu tiap kata", progress: 0.92 },
  simpan: { label: "Menyimpan voice over", progress: 0.98 },
};

type UploadStage = "baca" | "waktu" | "simpan";
const UPLOAD_STAGE: StageTable<UploadStage> = {
  baca: { label: "Membaca file voice over", progress: 0.02 },
  waktu: { label: "Mencatat waktu tiap kata", progress: 0.08 },
  simpan: { label: "Menyimpan voice over", progress: 0.95 },
};

function voicePython(): string {
  if (process.env.VOICEOVER_PYTHON) return process.env.VOICEOVER_PYTHON;
  const venv = path.join(REPO_ROOT, VO.venvDir);
  return process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

type TtsEvent = { stage?: string; chunk?: number; total?: number; durationS?: number };

function runTts(requestFile: string, onEvent: (e: TtsEvent) => void, signal?: AbortSignal): Promise<{ durationS: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(voicePython(), [path.join(REPO_ROOT, "apps/worker/py/voiceover.py"), requestFile], {
      windowsHide: true,
      env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", USERPROFILE: process.env.USERPROFILE ?? "", TEMP: WORKER_TMP, TMP: WORKER_TMP, PYTHONIOENCODING: "utf-8", HF_HOME: path.join(REPO_ROOT, ".cache", "huggingface"), HF_HUB_OFFLINE: "1" },
    });
    let last: TtsEvent = {}, pending = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Pembuatan suara melewati batas ${Math.round(VO.ttsTimeoutMs / 60000)} menit`)); }, VO.ttsTimeoutMs);
    const abort = () => { child.kill(); reject(signal?.reason instanceof Error ? signal.reason : new Error("Dibatalkan.")); };
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (d) => {
      pending += d;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim().startsWith("{")) continue;
        try { last = JSON.parse(line) as TtsEvent; onEvent(last); } catch { /* baris bukan milik kita */ }
      }
    });
    child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-1500); });
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Python voice over tidak bisa dijalankan (${e.message}). Jalankan: npm run setup:voiceover`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (code !== 0) return reject(new Error(`Pembuatan suara gagal (kode ${code}): ${stderr.trim().slice(-600) || "tanpa pesan"}`));
      if (typeof last.durationS !== "number") return reject(new Error("Mesin suara selesai tanpa ringkasan hasil."));
      resolve({ durationS: last.durationS });
    });
  });
}

type Direction = Pick<VoiceoverInfo, "readingText" | "segments" | "direction" | "directionModel" | "note">;

/** Arahan Codex. Gagal atau ditolak validasi = naskah dibaca apa adanya dan alasannya dicatat (tidak gagal diam-diam). */
export async function directScript(script: string, run: typeof runProvider = runProvider): Promise<Direction> {
  const plain = (note: string): Direction => ({ readingText: script, direction: "naskah", directionModel: null, note });
  try {
    const r = await run("codex", buildDirectionPrompt(script), DIRECTION_SCHEMA, VO.codexTimeoutMs);
    const parsed = parseDirection(r.json, script);
    if (!parsed.ok) return plain(`Arahan Codex tidak dipakai (${parsed.error}); naskah dibaca apa adanya.`);
    return { readingText: parsed.readingText, segments: parsed.segments, direction: "codex", directionModel: r.model, note: parsed.notes || null };
  } catch (e) {
    return plain(`Codex CLI gagal (${(e instanceof Error ? e.message : String(e)).slice(0, 300)}); naskah dibaca apa adanya.`);
  }
}

/** Naskah -> file audio + waktu kata di folder project. Belum menjadi voice over aktif sampai `saveVoiceover`. */
export async function produceVoiceover(a: { projectId: string; jobId: string; script: string; profile: VoiceProfile; readingText?: string; segments?: unknown; signal?: AbortSignal; onStage?: (stage: Stage, detail?: string) => Promise<void> | void; onProgress?: (stage: Stage, f: number) => void }): Promise<VoiceoverInfo> {
  await a.onStage?.("arahan");
  let direction: Direction;
  if (a.segments !== undefined) {
    const checked = checkSegments(a.script, a.segments);
    if (!checked.ok) throw new Error(`Arahan suara tidak sesuai naskah: ${checked.error}.`);
    direction = { readingText: checked.readingText, segments: checked.segments, direction: "pengguna", directionModel: null, note: null };
  } else if (a.readingText) {
    const bad = checkReading(a.script, a.readingText);
    if (bad) throw new Error(`Naskah baca tidak sesuai naskah: ${bad}.`);
    direction = { readingText: a.readingText, direction: "pengguna", directionModel: null, note: null };
  } else direction = await directScript(a.script);
  a.signal?.throwIfAborted();

  const work = await mkdtemp(path.join(WORKER_TMP, "voiceover-"));
  const audioFile = voiceoverAudioPath(a.projectId, a.jobId);
  try {
    await a.onStage?.("memuat");
    const requestFile = path.join(work, "permintaan.json"), reference = path.join(work, "acuan.wav"), wav = path.join(work, "suara.wav"), wav16 = path.join(work, "suara16.wav");
    await extractAudioWav(voiceProfileAudioPath(a.profile.id), reference);
    await writeFile(requestFile, JSON.stringify({ chunks: ttsChunks(direction), referenceWav: reference, referenceText: a.profile.text, out: wav, modelDir: path.join(REPO_ROOT, VO.modelDir), seed: VO.seed }), "utf8");
    const tts = await runTts(requestFile, (e) => {
      if (typeof e.chunk !== "number" || !e.total) return;
      void a.onStage?.("suara", `kalimat ${e.chunk + 1} dari ${e.total}`);
      a.onProgress?.("suara", e.chunk / e.total);
    }, a.signal);
    if (tts.durationS > VO.maxDurationS) throw new Error(`Voice over ${Math.round(tts.durationS)} detik, maksimal ${VO.maxDurationS} detik. Pendekkan naskahnya.`);

    await a.onStage?.("waktu");
    await extractAudioWav(wav, wav16);
    const { words } = await transcribeWav(wav16, (f) => a.onProgress?.("waktu", f), VO.language);
    if (!words.length) throw new Error("Whisper tidak menemukan kata pada suara hasil. Coba rekam ulang suara Anda.");

    await a.onStage?.("simpan");
    await mkdir(path.dirname(audioFile), { recursive: true });
    await encodeAac(wav, audioFile, VO.audioBitrate);
    return { jobId: a.jobId, script: a.script, profileId: a.profile.id, durationS: tts.durationS, words: words.map((w) => ({ text: w.text, start: w.start, end: w.end })), engine: VO.engine, createdAt: new Date().toISOString(), ...direction };
  } catch (e) {
    await rm(audioFile, { force: true });
    throw e;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** File voice over pengguna -> audio + waktu kata di folder project. Tanpa Codex dan mesin suara; belum aktif sampai `saveVoiceover`. */
export async function importVoiceover(a: { projectId: string; jobId: string; sourceFile: string; fileName: string; script?: string; signal?: AbortSignal; onStage?: (stage: UploadStage) => Promise<void> | void; onProgress?: (stage: UploadStage, f: number) => void }): Promise<VoiceoverInfo> {
  const work = await mkdtemp(path.join(WORKER_TMP, "voiceover-"));
  const audioFile = voiceoverAudioPath(a.projectId, a.jobId);
  try {
    await a.onStage?.("baca");
    const wav16 = path.join(work, "suara16.wav");
    await extractAudioWav(a.sourceFile, wav16).catch(() => { throw new Error(`File "${a.fileName}" tidak bisa dibaca sebagai audio. Pastikan filenya tidak rusak.`); });
    const durationS = wavDurationS(await readFile(wav16));
    if (!durationS) throw new Error(`File "${a.fileName}" tidak berisi audio.`);
    if (durationS > VO.maxDurationS) throw new Error(`Voice over ${Math.round(durationS)} detik, maksimal ${VO.maxDurationS} detik. Pendekkan audionya.`);
    a.signal?.throwIfAborted();

    await a.onStage?.("waktu");
    const { words } = await transcribeWav(wav16, (f) => a.onProgress?.("waktu", f), VO.language);
    if (!words.length) throw new Error("Whisper tidak menemukan kata pada file ini. Pastikan file berisi suara bicara.");
    a.signal?.throwIfAborted();

    await a.onStage?.("simpan");
    await mkdir(path.dirname(audioFile), { recursive: true });
    await encodeAac(a.sourceFile, audioFile, VO.audioBitrate);
    return uploadedVoiceoverInfo({ jobId: a.jobId, fileName: a.fileName, script: a.script, durationS, words: words.map((w) => ({ text: w.text, start: w.start, end: w.end })), createdAt: new Date().toISOString() });
  } catch (e) {
    await rm(audioFile, { force: true });
    throw e;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function handleVoiceover(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  const upload = job.payload.upload as { fileId?: unknown; fileName?: unknown } | undefined;
  const isUpload = typeof upload?.fileId === "string";
  const script = typeof job.payload.script === "string" ? job.payload.script.trim() : "";
  if (script.length > VO.maxScriptChars || (!script && !isUpload)) throw new Error(`Naskah kosong atau lebih dari ${VO.maxScriptChars} karakter.`);
  const profile = isUpload ? null : loadVoiceProfile();
  if (!isUpload && !profile) throw new Error("Belum ada rekaman suara. Rekam suara Anda dulu di tab Voice over.");
  const readingText = typeof job.payload.readingText === "string" && job.payload.readingText.trim() ? job.payload.readingText.trim() : undefined;
  // Pembatalan oleh pengguna: job ini bisa berjalan puluhan menit
  const ctrl = new AbortController();
  const poll = setInterval(async () => {
    const { data } = await db.from("jobs").select("status").eq("id", job.id).maybeSingle();
    if (data?.status === "cancelled") ctrl.abort(new Error("Dibatalkan oleh pengguna."));
  }, CREATIVE.cancelPollMs);
  const reporter = <S extends string>(table: StageTable<S>) => {
    const stages = Object.keys(table) as S[];
    return {
      onStage: async (stage: S, detail?: string) => {
        await db.from("jobs").update({ payload: { ...job.payload, stage, stageLabel: detail ? `${table[stage].label}: ${detail}` : table[stage].label } }).eq("id", job.id);
        if (!detail) await setProgress(table[stage].progress);
      },
      onProgress: (stage: S, f: number) => {
        const from = table[stage].progress, to = table[stages[stages.indexOf(stage) + 1]]?.progress ?? 1;
        void setProgress(from + f * (to - from));
      },
    };
  };
  const sourceFile = isUpload ? voiceoverUploadPath(job.project_id, upload.fileId as string) : null;
  try {
    const info = sourceFile
      ? await importVoiceover({ projectId: job.project_id, jobId: job.id, sourceFile, fileName: typeof upload?.fileName === "string" ? upload.fileName : "voice over", script: script || undefined, signal: ctrl.signal, ...reporter(UPLOAD_STAGE) })
      : await produceVoiceover({ projectId: job.project_id, jobId: job.id, script, profile: profile!, readingText, segments: job.payload.segments, signal: ctrl.signal, ...reporter(STAGE) });
    ctrl.signal.throwIfAborted();
    await saveVoiceover(job.project_id, info);
  } finally {
    clearInterval(poll);
    if (sourceFile) await rm(sourceFile, { force: true });
  }
  // Brief pertama: motion dibuat setelah suaranya ada, agar animasi mengikuti waktu kata
  const next = job.payload.next as { prompt?: unknown; model?: unknown; assets?: { provider?: unknown; model?: unknown }; reference?: unknown } | undefined;
  // Fase 22: referensi gaya dari brief pertama (sudah divalidasi rute web menjadi lampiran) ikut ke job berikutnya
  const reference = next?.reference && typeof next.reference === "object" ? { reference: next.reference } : {};
  // Fase 19: Opinion Motion = riset aset dulu (brief ikut disimpan); motion dibuat pengguna setelah memilih aset
  if (typeof next?.prompt === "string" && next.prompt.trim() && next.assets) {
    const provider = next.assets.provider === "codex" ? "codex" : "claude";
    const { error } = await db.from("jobs").insert({ project_id: job.project_id, type: "assets", payload: { provider, ...(typeof next.assets.model === "string" && next.assets.model ? { model: next.assets.model } : {}), brief: next.prompt.trim().slice(0, CREATIVE.maxPromptChars), ...reference } });
    if (error && error.code !== "23505") throw new Error(`Voice over selesai, tetapi riset aset gagal dimulai: ${error.message}${/jobs_type_check/.test(error.message) ? " Jalankan supabase/migrations/20261110100000_fase19_opinion_motion.sql." : ""}`);
    return;
  }
  if (typeof next?.prompt === "string" && next.prompt.trim()) {
    const { error } = await db.from("jobs").insert({ project_id: job.project_id, type: "creative", payload: { prompt: next.prompt.trim().slice(0, CREATIVE.maxPromptChars), model: typeof next.model === "string" ? next.model : CREATIVE.defaultModel, ...reference } });
    if (error && error.code !== "23505") throw new Error(`Voice over selesai, tetapi motion gagal dimulai: ${error.message}`);
  }
}
