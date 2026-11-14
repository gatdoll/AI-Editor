"use client";
import { memo, useMemo, useState } from "react";
import type { SuggestionKind, SuggestionRow } from "@app/shared";
import { KIND_COLOR, KIND_LABEL, fmtTime } from "./kinds";
import s from "./editor.module.css";

type Status = SuggestionRow["status"];

const Card = memo(function Card({
  x, selected, onSelect, onStatus, restored = 0, onListen,
}: {
  x: SuggestionRow;
  /** Fase 12: putar bagian sekitar potongan, sebelum (after=false) atau sesudah dipotong (after=true). */
  onListen?: (x: SuggestionRow, after: boolean) => void;
  /** Detik dari usulan ini yang dimunculkan lagi lewat timeline (tarik tepi klip / penanda sambungan). */
  restored?: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onStatus: (x: SuggestionRow, st: Status) => void;
}) {
  const unclear = x.kind === "unclear";
  return (
    <div
      className={`${s.card} ${selected ? s.sel : ""} ${x.status === "approved" ? s.approved : ""} ${x.status === "rejected" ? s.rejected : ""}`}
      style={{ ["--c" as string]: KIND_COLOR[x.kind] }}
      onClick={() => onSelect(x.id)}
    >
      <div>
        <span className={s.kind}>{KIND_LABEL[x.kind]}</span>{" "}
        <span className={s.muted}>{fmtTime(Number(x.start_s))}–{fmtTime(Number(x.end_s))} · {(Number(x.end_s) - Number(x.start_s)).toFixed(1)} dtk</span>
      </div>
      {x.quote && <div className={s.q}>“{x.quote}”</div>}
      <div className={s.why}>{x.reason}</div>
      {x.status === "approved" && restored > 0.01 && <div className={s.small} style={{ color: "var(--ui-warning)" }}>{restored >= Number(x.end_s) - Number(x.start_s) - 0.01 ? "Dipulihkan seluruhnya di timeline" : `Dipulihkan sebagian di timeline (${restored.toFixed(1)} dtk)`}. Kembalikan lewat Undo atau trim klip.</div>}
      {!unclear && (
        <div className={s.actions} onClick={(e) => e.stopPropagation()}>
          <button className={`${s.mini} ${s.yes}`} disabled={x.status === "approved"} onClick={() => onStatus(x, "approved")}>✓ Setuju</button>
          <button className={`${s.mini} ${s.no}`} disabled={x.status === "rejected"} onClick={() => onStatus(x, "rejected")}>✕ Tolak</button>
          {x.status !== "pending" && <button className={s.mini} onClick={() => onStatus(x, "pending")}>Kembalikan</button>}
          {onListen && <span className={s.listen}>
            <button className={s.mini} title="Putar bagian ini apa adanya (1 detik sebelum sampai 1 detik sesudah)" onClick={() => onListen(x, false)}>▶ Sebelum</button>
            <button className={s.mini} title="Putar sambungan setelah bagian ini dipotong" onClick={() => onListen(x, true)}>▶ Sesudah</button>
          </span>}
        </div>
      )}
    </div>
  );
});

export function SuggestionsPanel({
  suggestions, selectedId, onSelect, onStatus, onBulk, keeps = [], onListen, header,
}: {
  onListen?: (x: SuggestionRow, after: boolean) => void;
  /** Fase 12: kotak Auto cut di atas daftar. */
  header?: React.ReactNode;
  suggestions: SuggestionRow[];
  /** Bagian video mentah yang dipulihkan pengguna (style.manual.keeps). */
  keeps?: Array<{ start: number; end: number }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStatus: (x: SuggestionRow, st: Status) => void;
  onBulk: (kind: Exclude<SuggestionKind, "unclear">, status: Status) => void;
}) {
  const [kind, setKind] = useState<SuggestionKind | "all">("all");
  const [only, setOnly] = useState<"all" | "pending">("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const x of suggestions) c[x.kind] = (c[x.kind] ?? 0) + 1;
    return c;
  }, [suggestions]);
  const pending = suggestions.filter((x) => x.status === "pending" && x.kind !== "unclear").length;
  const approved = suggestions.filter((x) => x.status === "approved").length;
  const shown = suggestions.filter((x) => (kind === "all" || x.kind === kind) && (only === "all" || x.status === "pending"));

  return (
    <div className={s.tabBody}>
      {header}
      <div className={s.filters}>
        <button className={kind === "all" ? s.on : ""} onClick={() => setKind("all")}>Semua {suggestions.length}</button>
        {(Object.keys(KIND_LABEL) as SuggestionKind[]).filter((k) => counts[k]).map((k) => (
          <button key={k} className={kind === k ? s.on : ""} style={{ color: kind === k ? undefined : KIND_COLOR[k] }} onClick={() => setKind(k)}>{KIND_LABEL[k]} {counts[k]}</button>
        ))}
      </div>
      <div className={s.filters}>
        <span className={s.muted}>{approved} disetujui · {pending} menunggu</span>
        <span className={s.spacer} />
        <label className={s.small}><input type="checkbox" checked={only === "pending"} onChange={(e) => setOnly(e.target.checked ? "pending" : "all")} /> hanya yang menunggu</label>
      </div>
      {kind !== "all" && kind !== "unclear" && (
        <div className={s.filters}>
          <span className={s.muted}>Semua {KIND_LABEL[kind]}:</span>
          <button onClick={() => onBulk(kind, "approved")}>✓ setujui yang menunggu</button>
          <button onClick={() => onBulk(kind, "rejected")}>✕ tolak yang menunggu</button>
        </div>
      )}
      <div className={s.scroll}>
        {shown.length === 0 && <div className={s.empty}>{suggestions.length === 0 ? "Belum ada usulan. Jalankan analisis, atau ketik perintah di tab Perintah." : "Tidak ada usulan di filter ini."}</div>}
        {shown.map((x) => <Card key={x.id} x={x} selected={x.id === selectedId} onSelect={onSelect} onStatus={onStatus} onListen={onListen} restored={keeps.reduce((n, k) => n + Math.max(0, Math.min(k.end, Number(x.end_s)) - Math.max(k.start, Number(x.start_s))), 0)} />)}
      </div>
    </div>
  );
}
