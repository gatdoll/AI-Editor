"use client";
// Koreksi transkrip oleh AI (Nov 2026): ringkasan kata yang diperbaiki Opus 5.5 sesudah Whisper, kata yang ditandai ragu
// (tidak diganti, cek sendiri), dan daftar istilah pengguna (petunjuk Whisper + ejaan benar untuk koreksi AI).
import { useEffect, useState } from "react";
import s from "./editor.module.css";

type AiFix = { model?: string | null; changes?: Array<{ at: number; from: string; to: string }>; doubts?: Array<{ at: number; text: string; note: string }>; error?: string };

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function TranscriptAiFix({ aiFix, onSeek }: { aiFix: AiFix | null | undefined; onSeek: (s: number) => void }) {
  const [glossary, setGlossary] = useState<string | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/glossary").then((r) => r.json()).then((b) => { setGlossary(b.glossary ?? ""); setSaved(b.glossary ?? ""); }).catch(() => setGlossary(""));
  }, []);
  async function save() {
    const r = await fetch("/api/glossary", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ glossary: glossary ?? "" }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(b.error ?? `HTTP ${r.status}`);
    setGlossary(b.glossary); setSaved(b.glossary); setMsg("Tersimpan. Dipakai di transkrip berikutnya (Generate ulang subtitle).");
  }
  const changes = aiFix?.changes ?? [], doubts = aiFix?.doubts ?? [];
  return (
    <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
      {aiFix?.error && <p className={s.err} style={{ margin: 0 }}>Koreksi AI tidak jalan: {aiFix.error}. Transkrip memakai hasil Whisper apa adanya.</p>}
      {aiFix && !aiFix.error && (
        <details>
          <summary>Koreksi AI{aiFix.model ? ` (${aiFix.model.replace("claude-", "").replace(/-(\d)-(\d)/, " $1.$2")})` : ""}: {changes.length} kata diperbaiki{doubts.length ? ` · ${doubts.length} perlu dicek` : ""}</summary>
          {doubts.length > 0 && <>
            <p className={s.muted} style={{ margin: "6px 0 2px" }}>Ragu (TIDAK diganti; dengarkan lalu klik dua kali kata itu untuk memperbaiki):</p>
            <ul style={{ margin: 0, paddingLeft: 16 }}>{doubts.map((d, i) => <li key={i}><button className={s.mini} onClick={() => onSeek(d.at)}>{fmt(d.at)}</button> “{d.text}” <span className={s.muted}>{d.note}</span></li>)}</ul>
          </>}
          {changes.length > 0 && <>
            <p className={s.muted} style={{ margin: "6px 0 2px" }}>Diperbaiki (salah satunya keliru? klik dua kali katanya untuk mengubah):</p>
            <ul style={{ margin: 0, paddingLeft: 16 }}>{changes.map((c, i) => <li key={i}><button className={s.mini} onClick={() => onSeek(c.at)}>{fmt(c.at)}</button> <s className={s.muted}>{c.from}</s> → <b>{c.to}</b></li>)}</ul>
          </>}
        </details>
      )}
      <details>
        <summary>Istilah khusus{saved ? ` (${saved.split(",").filter((x) => x.trim()).length})` : ""}</summary>
        <p className={s.muted} style={{ margin: "4px 0" }}>Nama produk, merek, singkatan yang sering kamu ucapkan (pisahkan dengan koma atau baris). Dipakai Whisper sebagai petunjuk dan AI sebagai ejaan yang benar, untuk semua project.</p>
        <textarea rows={3} style={{ width: "100%", padding: 6 }} value={glossary ?? ""} onChange={(e) => setGlossary(e.target.value)} placeholder="Contoh: Impes, CPNS, Shopee, invoice, Mantiq" aria-label="Istilah khusus untuk transkrip" />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className={s.mini} disabled={glossary === null || glossary === saved} onClick={() => void save()}>Simpan istilah</button>
          {msg && <span className={s.muted}>{msg}</span>}
        </div>
      </details>
    </div>
  );
}
