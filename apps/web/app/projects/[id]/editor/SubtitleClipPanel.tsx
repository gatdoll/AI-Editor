"use client";
import { useEffect, useRef } from "react";
import { MANUAL } from "@app/config";
import type { SubtitleClip } from "@app/shared/subtitles";
import { fmtTime } from "./kinds";
import s from "./editor.module.css";

/** Klip subtitle terpilih (Fase 10): edit teks, hapus, pecah, gabung, buat ulang dari transkrip. */
export function SubtitleClipPanel({ clip, text, hiddenWords, frozen, hasNext, focusToken, disabled, onText, onDelete, onSplit, onMerge, onRegenerate, onSeek, onClose }: {
  clip: SubtitleClip;
  /** Teks kata yang sedang terlihat (kata di bagian terpotong tidak ikut diedit). */
  text: string;
  hiddenWords: number;
  /** Subtitle sudah menjadi klip mandiri (pernah diedit). */
  frozen: boolean;
  hasNext: boolean;
  /** Berubah = fokuskan kotak teks (klik dua kali di timeline). */
  focusToken: number;
  disabled: boolean;
  onText: (text: string) => void; onDelete: () => void; onSplit: () => void; onMerge: () => void; onRegenerate: () => void;
  onSeek: (t: number) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focusToken) { ref.current?.focus(); ref.current?.select(); } }, [focusToken]);
  const commit = () => { const v = ref.current?.value ?? ""; if (v.replace(/\s+/g, " ").trim() !== text) onText(v); };
  return <div className={s.manualPanel}>
    <div className={s.manualHero}><span>SUBTITLE</span><strong>Klip subtitle.</strong><p>{fmtTime(clip.start)} — {fmtTime(clip.end)} video mentah · {(clip.end - clip.start).toFixed(2)} dtk. Tarik tepinya di timeline untuk trim, tarik badannya untuk menggeser.</p></div>
    <fieldset disabled={disabled} className={s.manualFields}>
      <div className={s.manualSection}>
        <h3>Teks</h3>
        <textarea key={`${clip.id}-${text}`} ref={ref} defaultValue={text} rows={3} maxLength={MANUAL.subtitles.maxChars} aria-label="Teks subtitle" style={{ width: "100%" }}
          onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); } if (e.key === "Escape") { e.currentTarget.value = text; e.currentTarget.blur(); } }}/>
        <p className={s.muted}>Enter menyimpan. Jumlah kata sama = waktu tiap kata tetap; jumlah berbeda = waktu dibagi rata.{hiddenWords ? ` ${hiddenWords} kata di bagian terpotong tidak ditampilkan dan tetap disimpan.` : ""}</p>
      </div>
      <div className={s.manualActions}>
        <button onClick={() => onSeek(clip.start)}>▶ Ke subtitle ini</button>
        <button onClick={onSplit} title="Pecah di playhead (S)">✂ Pecah di playhead <kbd>S</kbd></button>
        <button onClick={onMerge} disabled={!hasNext}>⇥ Gabung dengan berikutnya</button>
        <button onClick={onDelete} title="Hapus (Delete)">Hapus <kbd>Del</kbd></button>
      </div>
      <div className={s.manualSection}>
        <h3>Subtitle otomatis</h3>
        <p className={s.muted}>{frozen ? "Subtitle sudah menjadi klip mandiri dan tidak lagi mengikuti transkrip (koreksi typo di tab Transkrip tetap ikut)." : "Belum diedit: subtitle masih dibuat otomatis dari transkrip. Edit pertama mengubahnya menjadi klip mandiri."}</p>
        {frozen && <button onClick={onRegenerate}>↺ Buat ulang dari transkrip</button>}
      </div>
      <button className={s.mini} onClick={onClose}>Tutup</button>
    </fieldset>
  </div>;
}
