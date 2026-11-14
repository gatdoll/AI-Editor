"use client";
import { useEffect, useRef, useState } from "react";
import { REFERENCE } from "@app/config";
import { referenceUrl, type ReferenceInput } from "@app/shared/reference";
import s from "./editor.module.css";
/** Fase 22: penjelasan referensi di Kreatif/Motion (satu teks untuk semua kategori). */
export const CREATIVE_REFERENCE_NOTE = "Link YouTube/Shorts, Reels Instagram, TikTok, atau unggah video. Sebelum menulis kode, AI melihat sampel frame hingga 30 detik (mulai detik pilihanmu), menulis analisis gayanya, lalu meniru GAYA-nya: tipografi, warna, layout, animasi, tempo. Isinya (teks, logo, wajah) tidak disalin. Audio tidak dibaca. Link privat/minta login: unggah file.";

export function ReferencePicker({ projectId, disabled, onChange, onBusy, note, title = "Referensi gaya" }: {
  projectId: string; disabled: boolean; onChange: (v: ReferenceInput | undefined) => void; onBusy: (busy: boolean) => void;
  /** Penjelasan apa yang terjadi dengan referensi (berbeda antara Prompt Cepat dan Kreatif/Motion). */
  note?: string; title?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useRef<XMLHttpRequest | null>(null);
  const [attachment, setAttachment] = useState<(ReferenceInput & { label: string }) | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => () => upload.current?.abort(), []);
  const attach = (v: ReferenceInput & { label: string }) => { setAttachment(v); onChange(v); setError(null); };

  async function selectFile(file?: File) {
    if (!file) return;
    if (file.size <= 0 || file.size > REFERENCE.maxBytes || !/\.(mp4|mov|mkv|webm|m4v)$/i.test(file.name)) {
      setError("Pilih MP4/MOV/MKV/WebM/M4V, maksimal 150 MB."); return;
    }
    setError(null); setProgress(0); onBusy(true);
    const xhr = new XMLHttpRequest(); upload.current = xhr;
    try {
      const result = await new Promise<{ id: string; label: string }>((resolve, reject) => {
        xhr.open("POST", `/api/projects/${projectId}/references?name=${encodeURIComponent(file.name)}`);
        xhr.timeout = 180_000;
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = () => {
          try { const body = JSON.parse(xhr.responseText); if (xhr.status < 200 || xhr.status >= 300) reject(new Error(body.error ?? "Unggahan gagal.")); else resolve(body); }
          catch { reject(new Error("Respons upload tidak terbaca. Coba lagi.")); }
        };
        xhr.onerror = () => reject(new Error("Koneksi upload terputus. Coba lagi."));
        xhr.ontimeout = () => reject(new Error("Upload terlalu lama. Gunakan cuplikan lebih pendek."));
        xhr.onabort = () => reject(new Error("Unggahan dibatalkan."));
        xhr.send(file);
      });
      attach({ kind: "upload", id: result.id, label: result.label, startS: 0 });
    } catch (e) { setError(e instanceof Error ? e.message : "Unggahan gagal."); }
    finally { upload.current = null; setProgress(null); onBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  function addLink() {
    try { const link = referenceUrl(url); attach({ kind: "link", url: link.url, label: link.platform, startS: 0 }); setUrl(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Link tidak valid."); }
  }
  return <details className={s.referencePicker} open={attachment || progress !== null ? true : undefined}>
    <summary>＋ {title} <span>{attachment ? "· 1 terpasang" : "· upload / link"}</span></summary>
    <p className={s.small}>YouTube, Reels Instagram, TikTok, atau video lokal.</p>
    <input ref={fileInput} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v" aria-label="Upload video referensi" style={{ display: "none" }} onChange={(e) => void selectFile(e.target.files?.[0])} />
    <button className={s.mini} disabled={disabled || progress !== null} onClick={() => fileInput.current?.click()}>Upload video · maks. 150 MB</button>
    <div className={s.referenceLink}>
      <input type="url" aria-label="Link video referensi" placeholder="https://… link satu video" value={url} disabled={disabled || progress !== null} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
      <button className={s.mini} disabled={disabled || !url.trim() || progress !== null} onClick={addLink}>Pasang</button>
    </div>
    {progress !== null && <div role="status" className={s.small}>Mengunggah {progress}% <button className={s.mini} onClick={() => upload.current?.abort()}>Batal</button></div>}
    {attachment && <div className={s.referenceCard}>
      <div><strong>{attachment.label}</strong><button aria-label="Lepas referensi" disabled={disabled || progress !== null} onClick={() => { setAttachment(null); onChange(undefined); }}>×</button></div>
      {attachment.kind === "link" && <span className={s.small}>{attachment.url}</span>}
      <label className={s.small}>Mulai analisis pada detik <input type="number" aria-label="Awal cuplikan referensi" min={0} max={REFERENCE.maxStartS} step={1} value={attachment.startS ?? 0} disabled={disabled || progress !== null} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0 && n <= REFERENCE.maxStartS) attach({ ...attachment, startS: n }); }} /></label>
    </div>}
    <p className={s.small}>{note ?? "Sampel visual hingga 30 detik dikirim ke Codex saat Kirim. Link: video maksimal 20 menit / 150 MB. Jika meminta login, unggah file."}</p>
    {error && <p role="alert" className={s.err}>{error}</p>}
  </details>;
}
