"use client";
// Fase 12: Auto cut di workspace. Transkrip dibuat saat diminta (bila belum ada), lalu AI mengusulkan potongan.
// Hasilnya langsung terlihat di timeline dan bisa diputar sebagai simulasi sebelum disetujui (aturan 2).
import { useState } from "react";
import { AI_MODELS, ANALYSIS } from "@app/config";
import type { AnalyzersState, Provider } from "@app/shared";
import type { JobLite } from "../Pipeline";
import { fmtTime } from "./kinds";
import s from "./editor.module.css";

export function AutoCutBox({ projectId, analyzers, jobs, hasTranscript, pendingCount, durations, previewPending, setPreviewPending, onStarted, disabled }: {
  projectId: string;
  analyzers: { analyzers: AnalyzersState | null; stale: boolean } | null;
  jobs: JobLite[];
  hasTranscript: boolean;
  pendingCount: number;
  /** Durasi hasil sekarang (yang disetujui) dan bila semua usulan disetujui, dalam detik. */
  durations: { now: number; ifAll: number };
  previewPending: boolean;
  setPreviewPending: (v: boolean) => void;
  onStarted: () => void;
  disabled: boolean;
}) {
  const [provider, setProvider] = useState<Provider>("claude");
  const [model, setModel] = useState<string>(ANALYSIS.defaultModel.claude);
  const pickProvider = (p: Provider) => { setProvider(p); setModel(ANALYSIS.defaultModel[p]); };
  const modelLabel = AI_MODELS[provider].find((m) => m.id === model)?.label ?? "bawaan akun";
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const tr = jobs.find((j) => j.type === "transcribe");
  const an = jobs.find((j) => j.type === "analyze");
  const active = (j?: JobLite) => j && (j.status === "queued" || j.status === "running");
  const busy = active(tr) || active(an) || sending;
  const st = (p: Provider) => analyzers?.analyzers?.[p];

  async function start() {
    setSending(true); setErr(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) setErr(b.error ?? `HTTP ${r.status}`);
      onStarted();
    } finally { setSending(false); }
  }

  const failed = !busy && ((tr?.status === "failed" && !hasTranscript && tr.error) || (an?.status === "failed" && an.error));
  return (
    <div className={s.autoBox}>
      <div className={s.autoHead}><b>Auto cut</b><span className={s.muted}>AI mengusulkan bagian yang dipotong: salah ucap, retake, jeda, kata pengisi. Tidak ada yang terpotong sebelum Anda setujui.</span></div>
      <div className={s.row}>
        {(["claude", "codex"] as const).map((p) => {
          const ok = st(p) ? st(p)!.installed && st(p)!.loggedIn : undefined;
          return <label key={p} className={s.small} title={st(p)?.detail}><input type="radio" name="autocut-prov" checked={provider === p} disabled={ok === false} onChange={() => pickProvider(p)} /> {p === "claude" ? "Claude Code CLI" : "Codex CLI"}</label>;
        })}
        {AI_MODELS[provider].length > 1 && (
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} aria-label="Model AI Auto cut" title="Model AI untuk Auto cut. Opus paling teliti, tapi lebih lambat.">
            {AI_MODELS[provider].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        <span className={s.spacer} />
        <button className={`${s.btn} ${s.primary}`} disabled={disabled || busy} onClick={() => void start()}>{busy ? "Berjalan…" : pendingCount ? "Auto cut lagi" : "✂ Auto cut"}</button>
      </div>
      {busy && <div className={s.small}><span className={s.spin} /> {active(tr) ? `Membuat transkrip dari ucapan… ${Math.round((tr!.progress ?? 0) * 100)}% (sekali saja; dipakai juga untuk subtitle)` : active(an) ? `Menganalisis dengan ${provider === "claude" ? "Claude" : "Codex"} (${modelLabel})…` : "Mengantre…"}</div>}
      {!busy && !hasTranscript && <div className={`${s.small} ${s.muted}`}>Transkrip belum ada: dibuat dulu saat Auto cut dijalankan (beberapa menit untuk video panjang).</div>}
      {(err || failed) && <div className={s.versionError}>{err ?? (failed as string)}</div>}
      {pendingCount > 0 && (
        <div className={s.autoResult}>
          <div><b>{pendingCount} usulan menunggu.</b> Durasi {fmtTime(durations.now)} → {fmtTime(durations.ifAll)} bila semua disetujui.</div>
          <div className={s.row}>
            <button className={`${s.btn} ${previewPending ? s.primary : ""}`} onClick={() => setPreviewPending(!previewPending)} aria-pressed={previewPending}>{previewPending ? "■ Kembali ke video sekarang" : "▶ Putar hasil cut"}</button>
          </div>
          <div className={`${s.small} ${s.muted}`}>“Putar hasil cut” memutar video seolah semua usulan disetujui (hanya simulasi). Di daftar bawah, tombol ▶ memutar bagian sekitar tiap potongan, sebelum dan sesudah.</div>
        </div>
      )}
    </div>
  );
}
