"use client";
import { useEffect, useRef, useState } from "react";
import type { AnalyzersState, Provider } from "@app/shared";
import { explainError } from "@app/shared/errors";
import type { PromptItem } from "./useEditorData";
import s from "./editor.module.css";
import { Icon } from "../../../components/Icon";
import type { ReferenceInput } from "@app/shared/reference";
import { AI_MODELS } from "@app/config";
import { ReferencePicker } from "./ReferencePicker";

const EXAMPLES = [
  { label: "Orbit + blur", prompt: "Pakai gaya motion, aktifkan framing orbit dengan kekuatan 0.8. Subtitle blur-slide maksimal 3 kata, kapital tebal. Kamera sinematik energik, gerakan 2–4 detik, zoom maksimal 1.2x. Pertahankan rasio, cut, dan audio." },
  { label: "Parallax halus", prompt: "Aktifkan komposisi bergerak parallax dengan kekuatan 0.6. Kamera pola sinematik, energi tenang. Subtitle blur-slide. Pertahankan rasio, cut, dan audio." },
  { label: "Rapikan jeda", prompt: "potong semua jeda yang lebih dari 1 detik" },
  { label: "Zoom kata", prompt: "zoom pas aku bilang " },
];

function Err({ raw }: { raw: string }) {
  const e = explainError(raw);
  return (
    <div style={{ marginTop: 6 }}>
      <b className={s.err}>{e.title}</b>
      <div className={s.small}>{e.hint}</div>
      <details className={s.small}>
        <summary className={s.muted} style={{ cursor: "pointer" }}>Detail teknis</summary>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "4px 0 0", userSelect: "all" }}>{raw}</pre>
      </details>
    </div>
  );
}

export function PromptPanel({
  projectId,
  prompts, promptsError, analyzers, busy, ready,
  onSend, onUndo, onApproveAll,
}: {
  projectId: string;
  prompts: PromptItem[];
  promptsError: string | null;
  analyzers: { analyzers: AnalyzersState | null; stale: boolean } | null;
  busy: boolean;
  ready: boolean;
  onSend: (text: string, provider: Provider, model: string, reference?: ReferenceInput) => Promise<string | null>;
  onUndo: (id: string) => void;
  onApproveAll: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [provider, setProvider] = useState<Provider>("claude");
  const [model, setModel] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reference, setReference] = useState<ReferenceInput | undefined>();
  const [uploading, setUploading] = useState(false);
  const [referenceKey, setReferenceKey] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (prompts.length) endRef.current?.scrollIntoView({ block: "end" }); }, [prompts]);

  async function send() {
    const v = text.trim();
    if ((!v && !reference) || uploading || sending || busy || !ready || notReady) return;
    setSending(true);
    setErr(null);
    try {
      const e = await onSend(v, provider, model, reference);
      if (e) setErr(e); else { setText(""); setReference(undefined); setReferenceKey((n) => n + 1); }
    } catch { setErr("Koneksi terputus. Coba kirim lagi."); } finally { setSending(false); }
  }

  const st = (p: Provider) => analyzers?.analyzers?.[p];
  const notReady = promptsError && /prompt_runs|schema cache|relation|does not exist/i.test(promptsError);

  return (
    <div className={s.tabBody}>
      {notReady && (
        <div className={s.notice}>
          Fitur perintah belum aktif karena tabel database belum ada. Jalankan file <b>supabase/migrations/20261028100000_fase8_prompt.sql</b> di SQL Editor Supabase, lalu muat ulang halaman.
        </div>
      )}
      {promptsError && !notReady && <div className={s.notice}>Gagal memuat riwayat perintah: {promptsError}</div>}
      {analyzers?.stale && <div className={s.notice}>Worker tidak melapor. Pastikan aplikasi dinyalakan lewat <b>Mulai Aplikasi.bat</b>.</div>}

      <div className={s.chat}>
        {prompts.length === 0 && !promptsError && (
          <div className={s.chatIntro}>
            <Icon name="sparkle" size={27}/>
            <h2>Idemu, tinggal katakan.</h2>
            <p>Atur kamera, teks bergerak, judul, dan jeda lewat prompt. Coba Orbit + blur untuk mulai.</p>
            <p><Icon name="check" size={13}/> Setiap cut menunggu persetujuanmu.</p>
          </div>
        )}
        {prompts.map((p) => (
          <div key={p.id} style={{ display: "contents" }}>
            <div className={s.bubbleU}>{p.reference && <div className={s.referenceTag}>▧ {p.reference.label} · mulai {p.reference.startS} dtk{p.reference.url && <a href={p.reference.url} target="_blank" rel="noreferrer">Buka sumber ↗</a>}</div>}{p.prompt}</div>
            <div className={s.bubbleA}>
              {(p.status === "queued" || p.status === "running") && (
                <span className={s.muted}><span className={s.spin} />{p.status === "queued" ? "Menunggu worker..." : p.reference && (p.progress ?? 0) < 0.4 ? "Mengambil video dan membaca sampel visual referensi..." : `Menyusun perintah dengan ${p.provider === "claude" ? "Claude" : "Codex"}...`}</span>
              )}
              {p.status === "failed" && <Err raw={p.error ?? "Gagal"} />}
              {p.status === "done" && (
                <>
                  {p.messages.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {p.messages.map((m, i) => <li key={i}>{m}</li>)}
                    </ul>
                  )}
                  {p.messages.length === 0 && <span className={s.muted}>Tidak ada perubahan.</span>}
                  {p.rejected.length > 0 && <div className={s.notice}>Ada bagian yang ditolak. Hanya perubahan dalam daftar hasil di atas yang dijalankan.</div>}
                  {p.reply && (p.ops?.every((op) => op.type === "answer") && p.rejected.length === 0
                    ? <div style={{ marginTop: 6 }}>{p.reply}</div>
                    : <details className={`${s.small} ${s.muted}`} style={{ marginTop: 6 }}><summary>Rencana AI sebelum eksekusi</summary><p>Ini rencana awal, bukan bukti perubahan tersimpan. Hasil aktual ada pada daftar di atas.</p><p>{p.reply}</p></details>)}
                  <div className={s.actions}>
                    {p.createdSuggestions > 0 && !p.undone && (
                      <button className={`${s.mini} ${s.yes}`} onClick={() => onApproveAll(p.id)}>✓ Setujui semua ({p.createdSuggestions}) usulan dari perintah ini</button>
                    )}
                    {p.canUndo && <button className={s.mini} onClick={() => onUndo(p.id)}>↶ Batalkan</button>}
                    {p.undone && <span className={s.muted}>dibatalkan</span>}
                  </div>
                  <div className={`${s.small} ${s.muted}`} style={{ marginTop: 4 }}>{p.provider === "claude" ? "Claude Code CLI" : "Codex CLI"} · {((p.duration_ms ?? 0) / 1000).toFixed(1)} dtk</div>
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className={s.composer}>
        <ReferencePicker key={referenceKey} projectId={projectId} disabled={busy || sending || !ready} onBusy={setUploading} onChange={setReference} />
        <div className={s.chips}>
          {EXAMPLES.map((x) => <button key={x.label} title={x.prompt} onClick={() => setText(x.prompt)}>{x.label}</button>)}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={ready ? reference ? "Contoh: tiru gerakan teks dan warna referensi; kamera lebih halus." : "Apa yang ingin kamu ubah di video ini?" : "Menunggu video siap..."}
          disabled={!ready || notReady === true}
          maxLength={2000}
          aria-label="Perintah"
        />
        <div className={s.row} style={{ justifyContent: "space-between" }}>
          <span>
            {(["claude", "codex"] as Provider[]).map((p) => {
              const ok = st(p) ? st(p)!.installed && st(p)!.loggedIn : null;
              return (
                <label key={p} style={{ marginRight: 10, opacity: ok === false ? 0.45 : 1 }} title={st(p)?.detail}>
                  <input type="radio" name="prov" checked={provider === p} disabled={ok === false} onChange={() => { setProvider(p); setModel(""); }} /> {p === "claude" ? "Claude" : "Codex"}
                </label>
              );
            })}
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model AI" title="Model AI untuk prompt ini">
              {AI_MODELS[provider].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </span>
          <button className={`${s.btn} ${s.primary}`} onClick={() => void send()} disabled={(!text.trim() && !reference) || uploading || sending || busy || !ready || notReady === true || (st(provider) != null && !(st(provider)!.installed && st(provider)!.loggedIn))}>
            {busy || sending ? "Memproses..." : "Kirim"}
          </button>
        </div>
        {reference && <div className={s.small}>Prompt kosong akan mengadaptasi gaya visual referensi. Referensi dibaca oleh provider dan model yang dipilih; Opus lebih teliti tapi lebih lambat.</div>}
        <div className={s.composerHint}><span>Enter untuk kirim · Shift+Enter baris baru</span><span>{text.length}/2000</span></div>
        {err && <Err raw={err} />}
      </div>
    </div>
  );
}
