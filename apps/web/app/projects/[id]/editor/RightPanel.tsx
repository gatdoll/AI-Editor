"use client";
import type { SuggestionRow } from "@app/shared";
import { ASPECTS, STYLES, type AspectId, type StyleId } from "@app/config";
import type { StyleChoice } from "@app/remotion/src/build-props.ts";
import { PARAMS, type ParamDef, type ParamValue } from "@app/shared/params";
import type { ExportInfo } from "./useEditorData";
import { KIND_COLOR, KIND_LABEL, fmtTime } from "./kinds";
import s from "./editor.module.css";
import { Icon } from "../../../components/Icon";

function ParamRow({ def, styleId, value, onChange }: { def: ParamDef; styleId: StyleId; value: ParamValue | undefined; onChange: (v: ParamValue | undefined) => void }) {
  const base = def.base(styleId);
  const shown = value ?? base;
  const changed = value !== undefined;
  let input: React.ReactNode;
  if (def.kind === "number") {
    const v = typeof shown === "number" ? shown : def.min ?? 0;
    input = (
      <>
        <input aria-label={def.label} type="range" min={def.min} max={def.max} step={def.step} value={v} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 110 }} />
        <span className={s.small} style={{ minWidth: 42, textAlign: "right" }}>{Number(v.toFixed(2))}{def.unit ? ` ${def.unit}` : ""}{shown === undefined ? " (oto)" : ""}</span>
      </>
    );
  } else if (def.kind === "boolean") {
    input = <input aria-label={def.label} type="checkbox" checked={shown === true} onChange={(e) => onChange(e.target.checked)} />;
  } else if (def.kind === "color") {
    input = <input aria-label={def.label} type="color" value={typeof shown === "string" ? shown : "#ffffff"} onChange={(e) => onChange(e.target.value.toUpperCase())} />;
  } else {
    input = (
      <select aria-label={def.label} value={String(shown)} onChange={(e) => onChange(e.target.value)}>
        {def.options!.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <div className={s.row} title={def.desc} style={{ justifyContent: "space-between" }}>
      <span className={s.small} style={{ fontWeight: changed ? 700 : 400 }}>{def.label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {input}
        {changed && <button className={s.mini} title="Kembalikan ke bawaan gaya" onClick={() => onChange(undefined)}>↺</button>}
      </span>
    </div>
  );
}

/** Tombol cepat reduksi noise; nilai lain tetap bisa diatur di Manual → Audio. */
const NOISE_LEVELS: Array<[string, number]> = [["Mati", 0], ["Ringan", 0.5], ["Sedang", 0.75], ["Kuat", 1]];

export function RightPanel({
  selected, duration, sourceAspect, onClose, ready,
  style, updateStyle,
  previewPending, setPreviewPending,
  pendingCount, approvedCount, keptS, removedS,
  exportInfo, edlStale, exporting,
  onStatus, onTime, onSeek, onSaveEdl, onExport, noiseStatus, onSaveOutput, saveState,
}: {
  /** Simpan hasil render ke folder pilihan ("Simpan sebagai"). */
  onSaveOutput?: (o: { id: string }) => void;
  saveState?: string | null;
  /** Fase 12: status "Kurangi noise" (diproses worker per kekuatan). */
  noiseStatus?: string | null;
  onClose: () => void;
  ready: boolean;
  selected: SuggestionRow | null;
  duration: number;
  sourceAspect: number;
  style: StyleChoice;
  updateStyle: (p: Partial<StyleChoice>, group?: string) => void;
  previewPending: boolean;
  setPreviewPending: (v: boolean) => void;
  pendingCount: number;
  approvedCount: number;
  keptS: number;
  removedS: number;
  exportInfo: ExportInfo | null;
  edlStale: boolean;
  exporting: boolean;
  onStatus: (x: SuggestionRow, st: SuggestionRow["status"]) => void;
  onTime: (x: SuggestionRow, field: "start_s" | "end_s", v: number) => void;
  onSeek: (t: number) => void;
  onSaveEdl: () => void;
  onExport: () => void;
}) {
  const outAspect = ASPECTS[style.aspect].width / ASPECTS[style.aspect].height;
  const rj = exportInfo?.renderJob;
  const rendering = rj?.status === "queued" || rj?.status === "running";

  return (
    <aside className={s.right} aria-label="Properti video">
      <div className={s.panelHeading}><Icon name="sliders" size={15}/> Properti video <span>INSPECTOR</span><button className={`${s.iconBtn} ${s.inspectorClose}`} aria-label="Tutup properti" onClick={onClose}>×</button></div>
      {selected && (
        <div className={s.sec}>
          <h3>Usulan terpilih</h3>
          <div style={{ color: KIND_COLOR[selected.kind], fontWeight: 600 }}>{KIND_LABEL[selected.kind]}</div>
          {selected.quote && <div className={s.small} style={{ fontStyle: "italic", margin: "4px 0" }}>“{selected.quote}”</div>}
          <div className={`${s.small} ${s.muted}`}>{selected.reason}</div>
          {selected.kind !== "unclear" && (
            <>
              <div className={s.row}>
                <label>Awal <input className={s.field} type="number" step={0.05} min={0} max={duration} defaultValue={Number(selected.start_s).toFixed(2)} key={`a${selected.id}${selected.start_s}`} onBlur={(e) => onTime(selected, "start_s", Number(e.target.value))} /></label>
                <label>Akhir <input className={s.field} type="number" step={0.05} min={0} max={duration} defaultValue={Number(selected.end_s).toFixed(2)} key={`b${selected.id}${selected.end_s}`} onBlur={(e) => onTime(selected, "end_s", Number(e.target.value))} /></label>
              </div>
              <div className={s.actions}>
                <button className={`${s.mini} ${s.yes}`} disabled={selected.status === "approved"} onClick={() => onStatus(selected, "approved")}>✓ Setuju</button>
                <button className={`${s.mini} ${s.no}`} disabled={selected.status === "rejected"} onClick={() => onStatus(selected, "rejected")}>✕ Tolak</button>
                <button className={s.mini} onClick={() => onSeek(Math.max(0, Number(selected.start_s) - 1.5))}>▶ Dari 1,5 dtk sebelum</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className={s.sec}>
        <h3>Gaya video</h3>
        <div className={s.row}>
          <span className={s.seg}>
            {(Object.keys(ASPECTS) as AspectId[]).map((a) => (
              <button key={a} aria-pressed={style.aspect === a} className={style.aspect === a ? s.on : ""} onClick={() => updateStyle({ aspect: a })}>{a}</button>
            ))}
          </span>
        </div>
        <div className={s.presetGrid}>
          {(Object.keys(STYLES) as StyleId[]).map((k) => <button key={k} className={s.preset} aria-pressed={style.styleId === k} onClick={() => updateStyle({ styleId: k })} title={`Gunakan gaya ${STYLES[k].label}`}><strong style={{ color: (k === 'modern' || k === 'motion') ? 'var(--accent)' : k === 'tebal' ? 'var(--ui-warning)' : 'var(--text)' }}>Aa</strong><span>{STYLES[k].label}{k === "motion" ? " · Kinetik" : ""}</span></button>)}
        </div>
        <div className={s.row}><label className={s.switchRow}><input type="checkbox" checked={style.camera} onChange={(e) => updateStyle({ camera: e.target.checked })} /> Gerakan kamera</label></div>
        <div className={s.row}><label className={s.switchRow}><input type="checkbox" checked={style.captions} onChange={(e) => updateStyle({ captions: e.target.checked })} /> Subtitle</label></div>
        <div className={s.row}><label className={s.switchRow}><input type="checkbox" checked={style.effects} onChange={(e) => updateStyle({ effects: e.target.checked })} /> Efek film</label></div>
        <div className={s.row} role="group" aria-label="Kurangi noise">
          <span className={s.small}>Kurangi noise</span>
          {NOISE_LEVELS.map(([label, v]) => <button key={label} className={s.mini} aria-pressed={Number(style.params["audio.kurangiNoise"] ?? 0) === v} style={Number(style.params["audio.kurangiNoise"] ?? 0) === v ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            onClick={() => { const { ["audio.kurangiNoise"]: _x, ...rest } = style.params; updateStyle({ params: v ? { ...style.params, "audio.kurangiNoise": v } : rest }); }}>{label}</button>)}
          {noiseStatus && <span className={s.small}>{noiseStatus}</span>}
        </div>
        {outAspect < sourceAspect - 0.05 && (
          <div className={s.row}><label>Posisi potong <input type="range" min={0} max={1} step={0.01} value={style.focusX} onChange={(e) => updateStyle({ focusX: Number(e.target.value) })} /> {Math.round(style.focusX * 100)}%</label></div>
        )}
        {style.cameraOverrides.length > 0 && (
          <div className={s.row}>
            <span className={s.small}>★ {style.cameraOverrides.length} arahan kamera</span>
            <button className={s.mini} onClick={() => updateStyle({ cameraOverrides: [] })}>Hapus semua</button>
          </div>
        )}
      </div>

      {(style.titles?.length ?? 0) > 0 && <section className={s.sec}>
        <h3>Judul motion</h3>
        {style.titles!.map((title, i) => <div key={`${i}-${title.startS}`} style={{ marginBottom: 10 }}>
          <input aria-label={`Teks judul ${i + 1}`} maxLength={120} defaultValue={title.text} key={title.text} onBlur={(e) => { if (e.target.value.trim()) updateStyle({ titles: style.titles!.map((t, n) => n === i ? { ...t, text: e.target.value.trim() } : t) }); }} style={{ width: "100%" }} />
          <div className={s.row}><span className={s.small}>{fmtTime(title.startS)}–{fmtTime(title.endS)} · {title.animation}</span><button className={s.mini} onClick={() => onSeek(title.startS)}>Lihat</button><button className={s.mini} aria-label={`Hapus judul ${i + 1}`} onClick={() => updateStyle({ titles: style.titles!.filter((_, n) => n !== i) })}>Hapus</button></div>
        </div>)}
      </section>}

      <details className={s.sec}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Pengaturan lanjutan{Object.keys(style.params).length > 0 ? ` (${Object.keys(style.params).length} diubah)` : ""}</summary>
        <div className={`${s.small} ${s.muted}`} style={{ margin: "6px 0" }}>Semua ini juga bisa diatur lewat perintah di kolom prompt. Tebal = sudah diubah dari bawaan gaya.</div>
        {(["Motion", "Teks", "Warna", "Efek", "Kamera"] as const).map((g) => (
          <div key={g} style={{ marginTop: 6 }}>
            <div className={s.small} style={{ fontWeight: 700, opacity: 0.7 }}>{g}</div>
            {PARAMS.filter((d) => d.group === g).map((d) => (
              <ParamRow
                key={d.id}
                def={d}
                styleId={style.styleId}
                value={style.params[d.id]}
                onChange={(v) => {
                  const next = { ...style.params };
                  if (v === undefined) delete next[d.id];
                  else next[d.id] = v;
                  updateStyle({ params: next }, d.id);
                }}
              />
            ))}
          </div>
        ))}
        {Object.keys(style.params).length > 0 && (
          <div className={s.row}><button className={s.mini} onClick={() => updateStyle({ params: {} })}>Kembalikan semua ke bawaan gaya</button></div>
        )}
      </details>

      <div className={s.sec}>
        <h3>Pratinjau</h3>
        <div className={s.row}>
          <label title="Hanya untuk melihat. Tidak menyetujui apa pun."><input type="checkbox" checked={previewPending} onChange={(e) => setPreviewPending(e.target.checked)} /> Lihat andaikan semua usulan disetujui</label>
        </div>
        <div className={s.stats}><div className={s.stat}><b>{fmtTime(keptS)}</b><span>Durasi hasil</span></div><div className={s.stat}><b>{fmtTime(removedS)}</b><span>Durasi dipotong</span></div></div>
      </div>

      <div className={s.sec}>
        <h3>Ekspor</h3>
        <div className={`${s.small} ${s.muted}`}>
          Menerapkan <b style={{ color: "var(--ok)" }}>{approvedCount}</b> potongan yang sudah disetujui.
          {pendingCount > 0 && <> <b style={{ color: "var(--warn)" }}>{pendingCount}</b> usulan belum diputuskan TIDAK ikut dipotong.</>}
        </div>
        <div className={s.row}>
          <button className={s.btn} onClick={onSaveEdl} disabled={exporting || !ready}>Simpan EDL</button>
          <button className={`${s.btn} ${s.primary}`} onClick={onExport} disabled={exporting || rendering || !ready}>{rendering ? "Merender..." : "Ekspor MP4"}</button>
        </div>
        {exportInfo?.edl && <div className={`${s.small} ${edlStale ? "" : s.ok}`}>{edlStale ? `EDL v${exportInfo.edl.version} perlu diperbarui (cut atau split berubah)` : `EDL v${exportInfo.edl.version} tersimpan`}</div>}
        {rendering && rj && <div className={s.row}><progress value={rj.progress} max={1} style={{ width: "100%" }} /> <span>{Math.round(rj.progress * 100)}%</span></div>}
        {rj?.status === "failed" && <div className={`${s.small} ${s.err}`}>Render gagal: {rj.error}</div>}
        {saveState && <div className={s.small}><span className={s.spin} /> {saveState}</div>}
        {(exportInfo?.outputs.length ?? 0) > 0 && (
          <div style={{ marginTop: 8 }}>
            {exportInfo!.outputs.slice(0, 5).map((o) => (
              <div key={o.id} className={s.small} style={{ margin: "4px 0" }}>
                {o.width}×{o.height} · {o.duration_s != null ? fmtTime(Number(o.duration_s)) : "?"} · {o.size_bytes ? (o.size_bytes / 1048576).toFixed(1) + " MB" : ""}{" "}
                <a href={`/api/assets/${o.id}/file`} target="_blank" rel="noreferrer">Putar</a>{" · "}
                {onSaveOutput ? <button className={s.mini} onClick={() => onSaveOutput(o)} title="Pilih folder dan nama file">Simpan ke…</button> : <a href={`/api/assets/${o.id}/file?download=1`}>Unduh</a>}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
