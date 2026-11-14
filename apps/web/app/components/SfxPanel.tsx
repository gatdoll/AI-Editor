"use client";
// Fase 14: panel efek suara. Dipakai editor video (waktu SUMBER) dan workspace motion (waktu hasil = sumber).
import { useMemo, useRef, useState } from "react";
import { SFX } from "@app/config";
import type { SfxCue, SfxItem } from "@app/shared/sfx";
import { playSfx, type SfxLibrary } from "../../lib/use-sfx-library";
import s from "./sfx.module.css";

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;

export function SfxPanel({ lib, cues, selected, onSelect, onAdd, onPatch, onDelete, master, onMaster, creativeCount, useCreative, onUseCreative, onCopyCreative, onSeek, disabled, onMessage, timeNote }: {
  lib: SfxLibrary;
  /** Isyarat edit (gaya), waktu sumber. */
  cues: SfxCue[];
  selected: number | null;
  onSelect: (i: number | null) => void;
  /** Tambah suara di posisi playhead. */
  onAdd: (item: SfxItem) => void;
  onPatch: (i: number, patch: Partial<SfxCue>) => void;
  onDelete: (i: number) => void;
  master: number;
  onMaster: (v: number) => void;
  /** Isyarat dari versi Mode Kreatif aktif (0 = tidak ada). */
  creativeCount: number;
  useCreative: boolean;
  onUseCreative: (on: boolean) => void;
  onCopyCreative: () => void;
  onSeek: (t: number) => void;
  disabled: boolean;
  onMessage: (m: string) => void;
  timeNote: string;
}) {
  const [q, setQ] = useState("");
  const [tags, setTags] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(lib.items.map((i) => [i.id, i])), [lib.items]);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? lib.items.filter((i) => i.name.includes(k) || i.tags.some((t) => t.includes(k))) : lib.items;
  }, [lib.items, q]);
  const cue = selected === null ? null : cues[selected] ?? null;
  const name = (id: string) => byId.get(id)?.name ?? `${id} (hilang dari pustaka)`;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try { const item = await lib.upload(file, tags); onMessage(`SFX "${item.name}" ditambahkan ke pustaka.`); setTags(""); }
    catch (e) { onMessage(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  return <div className={s.panel}>
    <div className={s.hero}><span>SFX</span><strong>Efek suara.</strong><p>Pilih suara lalu tambahkan di playhead, atau minta lewat perintah (“tambah whoosh saat aku bilang dashboard”). {timeNote}</p></div>
    <fieldset disabled={disabled} className={s.fields}>
      <label className={s.row} title="Volume semua SFX. Suara bicara tidak berubah.">
        <span>Volume SFX</span>
        <input type="range" min={0} max={1} step={0.05} value={master} onChange={(e) => onMaster(Number(e.target.value))} aria-label="Volume semua SFX"/>
        <output>{master === 0 ? "mati" : `${Math.round(master * 100)}%`}</output>
      </label>

      {cue && <div className={s.card}>
        <div className={s.cardHead}><b>♪ {name(cue.id)}</b><button className={s.mini} onClick={() => onSelect(null)}>Tutup</button></div>
        <div className={s.grid2}>
          <label>Mulai (detik)<input key={`${selected}-${cue.at}`} type="number" step={0.01} min={0} defaultValue={cue.at} aria-label="Waktu mulai SFX"
            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && Math.abs(v - cue.at) > 1e-4) onPatch(selected!, { at: v }); }}/></label>
          <label>Volume<input type="range" min={0} max={1} step={0.05} value={cue.volume} aria-label="Volume SFX ini" onChange={(e) => onPatch(selected!, { volume: Number(e.target.value) })}/></label>
        </div>
        <div className={s.actions}>
          <button onClick={() => playSfx(cue.id, cue.volume * master || cue.volume)}>▶ Dengar</button>
          <button onClick={() => onSeek(cue.at)}>Ke posisinya</button>
          <button onClick={() => onDelete(selected!)}>Hapus <kbd>Del</kbd></button>
        </div>
        <p className={s.hint}>Geser kotaknya di track SFX untuk memindahkan. SFX di bagian yang dipotong tidak berbunyi.</p>
      </div>}

      {creativeCount > 0 && <div className={s.card}>
        <label className={s.row}><span>SFX dari Mode Kreatif ({creativeCount})</span><input type="checkbox" checked={useCreative} onChange={(e) => onUseCreative(e.target.checked)}/></label>
        <p className={s.hint}>Ditaruh AI Kreatif mengikuti animasinya (garis putus-putus di timeline). Salin ke edit agar bisa digeser dan dihapus satu per satu.</p>
        <div className={s.actions}><button onClick={onCopyCreative} disabled={!useCreative}>Salin ke edit</button></div>
      </div>}

      <h3 className={s.h3}>Di video ini <small>{cues.length}/{SFX.maxCues}</small></h3>
      {cues.length === 0 ? <p className={s.hint}>Belum ada SFX edit.</p> : <div className={s.list}>
        {cues.map((c, i) => <button key={`${i}-${c.at}`} className={`${s.item} ${selected === i ? s.on : ""}`} onClick={() => { onSelect(i); onSeek(c.at); }}>
          <span>♪ {name(c.id)}</span><small>{fmt(c.at)} · {Math.round(c.volume * 100)}%</small></button>)}
      </div>}

      <h3 className={s.h3}>Pustaka <small>{lib.items.length} suara</small></h3>
      {lib.error && <p className={s.error}>{lib.error}</p>}
      {!lib.error && lib.items.length === 0 && <p className={s.hint}>Pustaka kosong. Jalankan <code>npm run setup:sfx</code> sekali, atau unggah suaramu sendiri.</p>}
      <input className={s.search} placeholder="Cari: whoosh, pop, impact…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari SFX"/>
      <div className={s.list}>
        {shown.map((item) => <div key={item.id} className={s.lib}>
          <button className={s.mini} onClick={() => playSfx(item.id)} aria-label={`Dengar ${item.name}`} title="Dengar">▶</button>
          <span className={s.libName} title={`${item.tags.join(", ")}${item.license ? ` · ${item.license}` : ""}`}>{item.name}<small>{item.durationS ? `${item.durationS.toFixed(1)} dtk` : ""}{item.source === "unggahan" ? " · unggahan" : ""}</small></span>
          <button className={s.mini} onClick={() => onAdd(item)} disabled={cues.length >= SFX.maxCues} title="Tambah di posisi playhead">＋</button>
          {item.source === "unggahan" && <button className={s.mini} aria-label={`Hapus ${item.name} dari pustaka`} title="Hapus dari pustaka"
            onClick={() => { if (window.confirm(`Hapus "${item.name}" dari pustaka? SFX ini berhenti berbunyi di semua project yang memakainya.`)) lib.remove(item.id).then(() => onMessage(`"${item.name}" dihapus dari pustaka.`), (e) => onMessage(String(e instanceof Error ? e.message : e))); }}>×</button>}
        </div>)}
      </div>

      <h3 className={s.h3}>Unggah SFX</h3>
      <div className={s.upload}>
        <input placeholder="Tag (pisah koma), mis. whoosh, transisi" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tag SFX unggahan"/>
        <button className={s.btn} disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? "Mengunggah…" : "Pilih file audio"}</button>
        <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" hidden onChange={(e) => void upload(e.target.files?.[0])}/>
      </div>
      <p className={s.hint}>MP3, WAV, OGG, atau M4A, maks. {Math.round(SFX.upload.maxBytes / 1048576)} MB. Berlaku untuk semua project. Suara bawaan: Kenney (CC0) dan suara sintetis buatan sendiri.</p>
    </fieldset>
  </div>;
}
