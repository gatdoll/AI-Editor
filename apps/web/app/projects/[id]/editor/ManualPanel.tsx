"use client";
import { useEffect, useState, type ReactNode } from "react";
import { CAMERA, MANUAL, MOTION } from "@app/config";
import { PARAMS, type ParamDef, type ParamValue } from "@app/shared/params";
import { normalizeManual, snapTime, transformFromParams } from "@app/shared/manual";
import type { Interval } from "@app/shared/edl";
import type { StyleChoice } from "@app/remotion/src/build-props.ts";
import type { MotionTitle } from "@app/remotion/src/title-plan.ts";
import { PRESET_LABEL, fmtTime } from "./kinds";
import s from "./editor.module.css";

function Control({ def, style, update }: { def: ParamDef; style: StyleChoice; update: (p: Partial<StyleChoice>, group?: string) => void }) {
  const v = style.params[def.id] ?? def.base(style.styleId);
  const set = (value: ParamValue) => update({ params: { ...style.params, [def.id]: value } }, def.id);
  return <label className={s.manualControl} title={def.desc}><span>{def.label}</span>{def.kind === "number" ? <><input aria-label={def.label} type="range" min={def.min} max={def.max} step={def.step} value={Number(v ?? def.min ?? 0)} onChange={(e) => set(Number(e.target.value))}/><output>{Number(Number(v ?? def.min ?? 0).toFixed(2))}{def.unit}</output></> : def.kind === "boolean" ? <input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked)}/> : def.kind === "color" ? <input type="color" value={String(v ?? "#ffffff")} onChange={(e) => set(e.target.value)}/> : <select value={String(v)} onChange={(e) => set(e.target.value)}>{def.options?.map((o) => <option key={o}>{o}</option>)}</select>}</label>;
}

export function ManualPanel({ style, update, duration, fps, clip, clipLimits, selectedTitle, onSelectTitle, onTrim, onDelete, onSplit, getTime, onSeek, disabled, onMessage, sfx, sfxFocus = 0 }: {
  /** Fase 14: isi bagian SFX (panel lengkap), dan pemicu untuk membukanya (berubah = pindah ke bagian SFX). */
  sfx?: ReactNode; sfxFocus?: number;
  style: StyleChoice; update: (p: Partial<StyleChoice>, group?: string) => void; duration: number; fps: number;
  clip: Interval | null;
  /** Seberapa jauh In/Out boleh keluar dari klip (memulihkan bagian terpotong), waktu mentah. */
  clipLimits?: { minStart: number; maxEnd: number } | null;
  selectedTitle: number | null; onSelectTitle: (n: number | null) => void;
  onTrim: (clip: Interval, start: number, end: number) => void; onDelete: () => void; onSplit: () => void;
  getTime: () => number; onSeek: (t: number) => void; disabled: boolean; onMessage: (m: string) => void;
}) {
  const [section, setSection] = useState("Klip");
  useEffect(() => { if (selectedTitle !== null) setSection("Teks"); }, [selectedTitle]);
  useEffect(() => { if (clip) setSection("Klip"); }, [clip?.start]);
  useEffect(() => { if (sfxFocus) setSection("SFX"); }, [sfxFocus]);
  const manual = normalizeManual(style.manual), titles = style.titles ?? [];
  const title = selectedTitle == null ? null : titles[selectedTitle];
  const group = section === "Gambar" ? ["Video", "Efek"] : section === "Audio" ? ["Audio"] : section === "Kamera" ? ["Kamera", "Motion"] : ["Teks", "Warna"];
  const addTitle = () => {
    if (titles.length >= MOTION.title.maxCount) return onMessage("Batas jumlah judul tercapai.");
    const startS = Math.min(snapTime(getTime(), fps), duration - 1 / fps);
    update({ titles: [...titles, { text: "TULIS CERITAMU", startS, endS: Math.min(duration, startS + MANUAL.titleSeconds), animation: "blur-slide", position: "tengah" }] });
    onSelectTitle(titles.length); setSection("Teks");
  };
  const patchTitle = (patch: Partial<MotionTitle>) => {
    if (!title) return;
    const next = { ...title, ...patch };
    if (next.endS <= next.startS || next.startS < 0 || next.endS > duration || next.endS - next.startS > MOTION.title.maxDurationSec || !next.text.trim()) return onMessage("Judul perlu teks dan rentang waktu valid (maks. " + MOTION.title.maxDurationSec + " detik).");
    update({ titles: titles.map((t, i) => i === selectedTitle ? next : t) });
  };
  const tabs = <div className={s.manualCategories} role="tablist" aria-label="Alat manual">{["Klip", "Teks", "Gambar", "Audio", "Kamera", ...(sfx ? ["SFX"] : [])].map((g) => <button role="tab" aria-selected={section === g} key={g} onClick={() => setSection(g)}>{g}</button>)}</div>;
  if (section === "SFX" && sfx) return <div className={s.manualPanel}>{tabs}{sfx}</div>;
  return <div className={s.manualPanel}>
    <div className={s.manualHero}><span>EDIT LANGSUNG</span><strong>Detail di tanganmu.</strong><p>Pilih klip atau judul di timeline. Semua perubahan masuk ke preview dan ekspor.</p></div>
    {tabs}
    <fieldset disabled={disabled} className={s.manualFields}>
    {disabled && <p className={s.muted}>Tunggu prompt AI selesai sebelum mengedit manual.</p>}
    {section === "Klip" && <>
      <div className={s.manualSection}><h3>Klip sumber</h3><p className={s.muted}>{clip ? `${fmtTime(clip.start)} — ${fmtTime(clip.end)} · ${(clip.end - clip.start).toFixed(2)} dtk` : "Klik bagian video di timeline untuk memilih klip."}</p>
        <div className={s.manualActions}><button onClick={onSplit}>✂ Split di playhead <kbd>S</kbd></button><button onClick={onDelete} disabled={!clip}>Hapus klip <kbd>Del</kbd></button></div>
        {clip && <form key={`${clip.start}-${clip.end}`} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); onTrim(clip, Number(f.get("start")), Number(f.get("end"))); }}>
          <div className={s.manualTimes}><label>In (detik)<input name="start" aria-label="Awal trim klip" type="number" step="any" min={clipLimits?.minStart ?? clip.start} max={clip.end} defaultValue={clip.start} required/></label><label>Out (detik)<input name="end" aria-label="Akhir trim klip" type="number" step="any" min={clip.start} max={clipLimits?.maxEnd ?? clip.end} defaultValue={clip.end} required/></label></div>
          {clipLimits && (clipLimits.minStart < clip.start - 1e-3 || clipLimits.maxEnd > clip.end + 1e-3) && <p className={s.muted}>Bisa diperpanjang ke bagian yang terpotong: In sampai {fmtTime(clipLimits.minStart)}, Out sampai {fmtTime(clipLimits.maxEnd)}.</p>}
          <button className={s.btn} type="submit">Terapkan</button>
        </form>}
        <p className={s.manualHint}>Tarik tepi klip untuk trim. Batas menempel ke frame dan playhead. Celah otomatis dirapatkan pada hasil video.</p>
      </div>
      <div className={s.manualSection}><h3>Bagian yang dihapus manual</h3>{manual.cuts.length === 0 ? <p className={s.muted}>Belum ada. Cut AI tetap dikelola di tab Usulan.</p> : manual.cuts.map((c, i) => <div className={s.manualItem} key={i}><span>{fmtTime(c.start)}–{fmtTime(c.end)}</span><button className={s.mini} onClick={() => update({ manual: { ...manual, cuts: manual.cuts.filter((_, j) => j !== i) } })}>Pulihkan</button></div>)}
        {!!manual.splits.length && <button className={s.mini} onClick={() => update({ manual: { ...manual, splits: [] } })}>Gabungkan batas split manual</button>}
      </div>
    </>}
    {section === "Teks" && <div className={s.manualSection}>
      <div className={s.manualSectionHeader}><h3>Judul & overlay</h3><button className={s.btn} onClick={addTitle}>＋ Teks</button></div>
      {titles.map((t, i) => <button key={i} className={`${s.manualTitleItem} ${selectedTitle === i ? s.on : ""}`} onClick={() => { onSelectTitle(i); onSeek(t.startS); }}><b>Aa</b><span>{t.text}<small>{fmtTime(t.startS)} – {fmtTime(t.endS)}</small></span></button>)}
      {title && <div className={s.manualTitleForm} key={`${selectedTitle}-${title.startS}-${title.endS}`}>
        <label>Teks judul<textarea aria-label="Isi judul manual" key={title.text} defaultValue={title.text} maxLength={MOTION.title.maxChars} onBlur={(e) => patchTitle({ text: e.target.value.trim() })}/></label>
        <div className={s.manualTimes}>{(["startS", "endS"] as const).map((k) => <label key={k}>{k === "startS" ? "Awal judul" : "Akhir judul"}<input aria-label={k === "startS" ? "Awal judul manual" : "Akhir judul manual"} type="number" step={0.1} min={0} max={duration} defaultValue={Number(title[k].toFixed(2))} onBlur={(e) => patchTitle({ [k]: Number(e.target.value) })}/></label>)}</div>
        <label>Animasi<select aria-label="Animasi judul manual" value={title.animation} onChange={(e) => patchTitle({ animation: e.target.value as MotionTitle["animation"] })}><option value="blur-slide">Blur slide</option><option value="kinetik">Kinetik</option><option value="hook">Hook (kata dari berbagai arah)</option><option value="lower-third">Lower third</option></select></label>
        <label>Posisi<select aria-label="Posisi judul manual" value={title.position} onChange={(e) => patchTitle({ position: e.target.value as MotionTitle["position"] })}><option value="atas">Atas</option><option value="tengah">Tengah</option></select></label>
        <div className={s.manualActions}><button disabled={titles.length >= MOTION.title.maxCount} onClick={() => { update({ titles: [...titles, { ...title, startS: Math.min(title.endS, Math.max(0, duration - (title.endS - title.startS))), endS: Math.min(duration, title.endS + title.endS - title.startS) }] }); onSelectTitle(titles.length); }}>Duplikat</button><button onClick={() => { update({ titles: titles.filter((_, i) => i !== selectedTitle) }); onSelectTitle(null); }}>Hapus judul</button></div>
      </div>}
    </div>}
    {section === "Gambar" && <div className={s.manualSection}><h3>Keyframe transform</h3><p className={s.manualHint}>Atur posisi, skala, rotasi, opacity; simpan pada playhead. Dua keyframe atau lebih menghasilkan gerakan halus. Keyframe menimpa transform statis.</p><button className={s.btn} disabled={manual.keyframes.length >= MANUAL.maxKeyframes} onClick={() => { const time = snapTime(getTime(), fps); update({ manual: { ...manual, keyframes: [...manual.keyframes.filter((k) => Math.abs(k.time - time) >= 1 / fps), { time, ...transformFromParams(style.params) }] } }); }}>◇ Simpan keyframe di playhead</button>
      {manual.keyframes.map((k, i) => <div key={i} className={s.manualItem}><button className={s.mini} onClick={() => onSeek(k.time)}>◇ {fmtTime(k.time)}</button><small>{k.scale.toFixed(2)}× · {k.rotation}°</small><button aria-label={`Hapus keyframe ${i + 1}`} className={s.mini} onClick={() => update({ manual: { ...manual, keyframes: manual.keyframes.filter((_, j) => i !== j) } })}>×</button></div>)}
    </div>}
    {section === "Kamera" && <div className={s.manualSection}><label className={s.manualControl}>Kamera otomatis AI<input type="checkbox" checked={style.camera} onChange={(e) => update({ camera: e.target.checked })}/></label><h3>Gerakan di playhead</h3><div className={s.manualActions}>{Object.entries(PRESET_LABEL).map(([preset, label]) => <button disabled={style.cameraOverrides.length >= CAMERA.overrideMax} key={preset} onClick={() => { const startS = Math.min(getTime(), duration - 1 / fps); update({ camera: true, cameraOverrides: [...style.cameraOverrides, { startS, endS: Math.min(duration, startS + MANUAL.titleSeconds), preset: preset as StyleChoice["cameraOverrides"][number]["preset"] }] }); }}>{label}</button>)}</div>
      {style.cameraOverrides.map((c, i) => <div key={i} className={s.manualItem}><button className={s.mini} onClick={() => onSeek(c.startS)}>{PRESET_LABEL[c.preset]} · {fmtTime(c.startS)}</button><button aria-label={`Hapus gerakan ${i + 1}`} className={s.mini} onClick={() => update({ cameraOverrides: style.cameraOverrides.filter((_, j) => j !== i) })}>×</button></div>)}
    </div>}
    {section !== "Klip" && <div className={s.manualSection}><h3>{section === "Teks" ? "Gaya subtitle & warna bersama" : section === "Gambar" ? "Gambar sumber · seluruh video" : section === "Audio" ? "Audio sumber · seluruh video" : "Pengaturan kamera"}</h3>{PARAMS.filter((d) => group.includes(d.group)).map((def) => <Control key={def.id} def={def} style={style} update={update}/>)}</div>}
    </fieldset>
    <div className={s.manualFoot}>Manual + AI · satu project, satu hasil.</div>
  </div>;
}
