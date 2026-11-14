"use client";
// Log aktivitas langsung job AI (Mode Kreatif / riset aset): apa yang sedang dikerjakan, dengan waktu sejak job mulai.
// Isi dari job.payload.activity (ditulis worker, apps/worker/src/activity.ts). Teks dirender sebagai teks biasa.
import { useEffect, useRef, useState } from "react";
import type { ActivityEntry } from "../../lib/activity";
import s from "./activity.module.css";

export type { ActivityEntry };

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function ActivityFeed({ entries, live, title = "Aktivitas AI" }: { entries: ActivityEntry[]; live: boolean; title?: string }) {
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  // Ikuti baris terbaru, kecuali pengguna sedang menggulir ke atas
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [entries.length, open]);
  const last = entries.at(-1);

  return (
    <div className={s.feed}>
      <button type="button" className={s.head} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={live ? s.pulse : s.idle} aria-hidden="true" />
        <span className={s.title}>{title}</span>
        {!open && last && <span className={s.peek}>{last.text}</span>}
        <span className={s.toggle}>{open ? "Sembunyikan" : "Tampilkan"}</span>
      </button>
      {open && (
        <ol ref={listRef} className={s.list} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
          {entries.length === 0 && <li className={s.empty}>{live ? "Menunggu langkah pertama AI…" : "Belum ada aktivitas tercatat."}</li>}
          {entries.map((e, i) => (
            <li key={i} className={`${s.row} ${e.text.startsWith("✕") ? s.bad : e.text.startsWith("✓") ? s.good : e.text.startsWith("AI: ") ? s.say : ""} ${live && i === entries.length - 1 ? s.now : ""}`}>
              <time>{fmt(e.t)}</time><span>{e.text.startsWith("AI: ") ? e.text.slice(4) : e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
