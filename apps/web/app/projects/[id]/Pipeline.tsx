"use client";
import type { AssetRow, ProjectRow } from "@app/shared";
import { ErrorBox } from "./ErrorBox";

export type JobLite = {
  id: string;
  type: "ingest" | "transcribe" | "analyze" | "render" | "preview" | "denoise" | "prompt" | "creative";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  /** Isi job (rute detail project mengirimnya), mis. ringkasan koreksi AI transkrip. */
  payload?: Record<string, unknown> | null;
};

type StageState = "idle" | "queued" | "running" | "done" | "failed" | "paused";

const ICON: Record<StageState, string> = { idle: "○", queued: "◔", running: "◐", done: "✓", failed: "✕", paused: "⏸" };
const COLOR: Record<StageState, string> = { idle: "var(--ui-muted)", queued: "var(--ui-warning)", running: "var(--ui-blue)", done: "var(--ui-success)", failed: "var(--ui-danger)", paused: "var(--ui-warning)" };

function took(job: JobLite | undefined): string {
  if (!job?.started_at) return "";
  const end = job.finished_at ? new Date(job.finished_at).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - new Date(job.started_at).getTime()) / 1000));
  if (s < 60) return `${s} dtk`;
  return `${Math.floor(s / 60)} mnt ${s % 60} dtk`;
}

/**
 * Status tiap tahap: unggah, periksa file, transkrip, analisis, render.
 * Tahap yang gagal menampilkan penjelasan ramah + detail teknis, dan tombol coba ulang bila berlaku.
 */
export function Pipeline({
  project,
  asset,
  jobs,
  uploadPct,
  onRetry,
}: {
  project: ProjectRow;
  asset: AssetRow | null;
  jobs: JobLite[];
  uploadPct: number | null;
  onRetry: () => void;
}) {
  const job = (t: JobLite["type"]) => jobs.find((j) => j.type === t);

  const stages: Array<{ key: string; label: string; state: StageState; progress?: number; note?: string; error?: string | null; retry?: boolean; optional?: boolean; job?: JobLite }> = [];

  // Unggah
  if (uploadPct !== null) stages.push({ key: "upload", label: "Unggah video", state: "running", progress: uploadPct / 100 });
  else if (!asset) stages.push({ key: "upload", label: "Unggah video", state: "idle", note: "belum ada video" });
  else if (project.status === "uploading") stages.push({ key: "upload", label: "Unggah video", state: "paused", note: "terputus. Pilih file yang SAMA untuk melanjutkan" });
  else stages.push({ key: "upload", label: "Unggah video", state: "done" });

  // Fase 12: hanya penyiapan video yang wajib. Transkrip, auto cut, dan render dijalankan dari workspace.
  for (const [type, label] of [
    ["ingest", "Periksa file dan siapkan video"],
  ] as const) {
    const j = job(type);
    const state: StageState = !j ? "idle" : j.status === "cancelled" ? "idle" : j.status;
    stages.push({ key: type, label, state, progress: j?.progress, error: j?.status === "failed" ? j.error : null, retry: j?.status === "failed" && project.status === "failed", job: j });
  }
  {
    const j = job("preview");
    if (j) stages.push({ key: "preview", label: "Salinan pratinjau (MOV/HEVC)", state: j.status === "cancelled" ? "idle" : j.status, progress: j.progress, error: j.status === "failed" ? j.error : null, optional: true, job: j });
  }
  for (const [type, label] of [
    ["transcribe", "Transkrip (dari workspace)"],
    ["analyze", "Auto cut (dari workspace)"],
    ["render", "Render MP4"],
  ] as const) {
    const j = job(type);
    const state: StageState = !j ? "idle" : j.status === "cancelled" ? "idle" : j.status;
    stages.push({ key: type, label, state, progress: j?.progress, error: j?.status === "failed" ? j.error : null, optional: true, job: j, note: !j ? "belum dijalankan" : undefined });
  }

  return (
    <section className="pipeline" aria-label="Progres project">
      {stages.map((s) => (
        <div key={s.key} className="pipeline-step">
          <span style={{ color: COLOR[s.state], fontWeight: 700, display: "inline-block", width: 22 }}>{ICON[s.state]}</span>
          <span style={{ color: s.state === "idle" ? "var(--ui-muted)" : undefined }}>{s.label}</span>
          {(s.state === "running" || s.state === "queued") && (
            <span style={{ marginLeft: 10 }}>
              {s.state === "queued" ? "menunggu worker" : <progress value={s.progress ?? 0} max={1} style={{ width: 160, verticalAlign: "middle" }} />}{" "}
              {s.state === "running" && `${Math.round((s.progress ?? 0) * 100)}%`}
              {s.job?.started_at && s.state === "running" && <small style={{ color: "var(--ui-muted)" }}> · {took(s.job)}</small>}
            </span>
          )}
          {s.state === "done" && s.job && <small style={{ color: "var(--ui-muted)", marginLeft: 8 }}>{took(s.job)}</small>}
          {s.note && <small style={{ color: "var(--ui-muted)", marginLeft: 8 }}>{s.note}</small>}
          {s.state === "failed" && (
            <ErrorBox raw={s.error ?? "Gagal tanpa pesan"}>
              {s.retry ? (
                <button onClick={onRetry}>Coba ulang dari tahap ini</button>
              ) : (
                <small style={{ color: "var(--ui-muted)" }}>Video, transkrip, dan EDL Anda tidak berubah. Klik tombol {s.key === "analyze" ? "analisis" : "render"} di bawah untuk mencoba lagi.</small>
              )}
            </ErrorBox>
          )}
        </div>
      ))}
    </section>
  );
}
