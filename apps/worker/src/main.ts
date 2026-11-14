import { cleanStaleTemp, WORKER_TMP } from "./temp-dir.ts"; // pertama: sebelum modul Remotion dimuat
import { createAdminClient, type JobRow, type JobType } from "@app/shared";
import type { AnalyzersState } from "@app/shared";
import { checkProvider } from "./analyze/providers.ts";
import { handleAnalyze, handleIngest, handleRender, handleTranscribe } from "./handlers.ts";
import { handlePrompt } from "./prompt/handler.ts";
import { handleCreative } from "./creative/handler.ts";
import { handleDenoise, handlePreview } from "./derived.ts";
import { handleVoiceover } from "./voiceover.ts";
import { handleAssets } from "./opinion/handler.ts";

const db = createAdminClient();
const TYPES: JobType[] = ["ingest", "transcribe", "analyze", "render", "prompt", "creative", "preview", "denoise", "voiceover", "assets"];
const POLL_MS = 3000;

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function recoverStaleJobs(): Promise<void> {
  // Worker mati di tengah job -> job 'running' tertinggal. Antrekan ulang.
  const { error } = await db
    .from("jobs")
    .update({ status: "queued", progress: 0, started_at: null })
    .eq("status", "running")
    .in("type", TYPES);
  if (error) console.error("[worker] gagal memulihkan job:", error.message);
}

async function claim(): Promise<JobRow | null> {
  const { data, error } = await db.rpc("claim_next_job", { p_types: TYPES });
  if (error) throw new Error(`claim_next_job: ${error.message}`);
  return (data as JobRow | null)?.id ? (data as JobRow) : null;
}

async function runJob(job: JobRow): Promise<void> {
  console.log(`[worker] mulai ${job.type} ${job.id}`);
  const setProgress = async (fraction: number) => {
    await db.from("jobs").update({ progress: Math.min(1, Math.max(0, fraction)) }).eq("id", job.id);
  };
  try {
    if (job.type === "ingest") await handleIngest(job, { db, setProgress });
    else if (job.type === "transcribe") await handleTranscribe(job, { db, setProgress });
    else if (job.type === "analyze") await handleAnalyze(job, { db, setProgress });
    else if (job.type === "render") await handleRender(job, { db, setProgress });
    else if (job.type === "prompt") await handlePrompt(job, { db, setProgress });
    else if (job.type === "creative") await handleCreative(job, { db, setProgress });
    else if (job.type === "preview") await handlePreview(job, { db, setProgress });
    else if (job.type === "denoise") await handleDenoise(job, { db, setProgress });
    else if (job.type === "voiceover") await handleVoiceover(job, { db, setProgress });
    else if (job.type === "assets") await handleAssets(job, { db, setProgress });
    // Hanya job yang masih 'running': job yang dibatalkan pengguna tetap 'cancelled'
    await db
      .from("jobs")
      .update({ status: "done", progress: 1, finished_at: new Date().toISOString(), error: null })
      .eq("id", job.id)
      .eq("status", "running");
    console.log(`[worker] selesai ${job.type} ${job.id}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[worker] GAGAL ${job.type} ${job.id}:`, message);
    await db
      .from("jobs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "running");
    if (job.type === "transcribe") {
      // Fase 12: transkrip dibuat dari workspace. Gagal = pesan di job; project dan video tetap bisa diedit.
      await db.from("projects").update({ status: "ready" }).eq("id", job.project_id);
      const next = job.payload.next as { type?: string; runId?: string } | undefined;
      if (next?.type === "analyze" && typeof next.runId === "string") {
        await db.from("analysis_runs").update({ status: "failed", error: `Transkrip gagal: ${message}`, finished_at: new Date().toISOString() }).eq("id", next.runId);
      }
    } else if (job.type === "preview" || job.type === "denoise") {
      // File turunan gagal tidak merusak project: pratinjau memakai file mentah, audio memakai audio mentah (status di aset / job).
    } else if (job.type === "voiceover") {
      // Voice over gagal hanya tercatat di job; voice over aktif, versi motion, dan project tidak tersentuh.
    } else if (job.type === "assets") {
      // Riset aset gagal hanya tercatat di job; aset yang sudah dipilih, voice over, dan versi motion tidak tersentuh.
    } else if (job.type === "creative") {
      // Kreatif gagal hanya tercatat sebagai versi 'gagal' (oleh handler); project, EDL, dan versi aktif tidak tersentuh.
    } else if (job.type === "analyze") {
      // Analisis gagal tidak merusak project: transkrip dan video tetap utuh.
      if (typeof job.payload.runId === "string") {
        await db
          .from("analysis_runs")
          .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
          .eq("id", job.payload.runId);
      }
      await db.from("projects").update({ status: "ready" }).eq("id", job.project_id);
    } else if (job.type === "prompt") {
      // Perintah yang gagal hanya ditandai gagal di riwayatnya; project tidak tersentuh.
      if (typeof job.payload.promptRunId === "string") {
        await db
          .from("prompt_runs")
          .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
          .eq("id", job.payload.promptRunId);
      }
    } else if (job.type !== "render") {
      // Render gagal tidak merusak project: video, transkrip, dan EDL tetap utuh.
      await db.from("projects").update({ status: "failed", error: message }).eq("id", job.project_id);
    }
  }
}

/** Tulis ketersediaan Claude Code CLI / Codex CLI ke DB agar UI bisa menampilkannya (tidak memakai kuota). */
async function publishAnalyzerStatus(): Promise<void> {
  try {
    const [claude, codex] = await Promise.all([checkProvider("claude"), checkProvider("codex")]);
    // jobTypes: UI bisa tahu worker lama (belum dimulai ulang) yang tidak akan pernah mengambil jenis job baru
    const value: AnalyzersState = { claude, codex, checkedAt: new Date().toISOString(), jobTypes: TYPES };
    await db.from("app_status").upsert({ key: "analyzers", value, updated_at: new Date().toISOString() });
  } catch (e) {
    console.error("[worker] gagal memeriksa CLI:", e instanceof Error ? e.message : e);
  }
}

// Sisa render/folder kerja dari proses sebelumnya (mati di tengah jalan). Job berjalan satu per satu, jadi saat
// mulai tidak ada yang sedang memakai; setelahnya hanya yang lebih tua dari 6 jam.
const swept = cleanStaleTemp(0);
console.log(`[worker] folder sementara: ${WORKER_TMP} (${swept.removed} sisa lama dibersihkan)`);
setInterval(() => cleanStaleTemp(6 * 3600_000), 3600_000).unref();
await recoverStaleJobs();
void publishAnalyzerStatus();
setInterval(() => void publishAnalyzerStatus(), 2 * 60 * 1000).unref();
console.log(`[worker] siap, memantau antrean: ${TYPES.join(", ")}`);
while (!stopping) {
  try {
    const job = await claim();
    if (job) await runJob(job);
    else await sleep(POLL_MS);
  } catch (e) {
    console.error("[worker] error loop:", e instanceof Error ? e.message : e);
    await sleep(POLL_MS * 2);
  }
}
console.log("[worker] berhenti");
