"use client";
import { useRef, useState } from "react";
import { snapTime } from "@app/shared/manual";
import s from "./editor.module.css";

/**
 * Pointer capture keeps trim reliable outside the track. Only pointer-up persists.
 * `minStart`/`maxEnd`: how far an edge may be dragged OUTWARD (video clip: up to the hidden material that can be restored).
 * Without them a non-movable block can only shrink.
 */
export function EditableBlock({ start, end, pps, fps, duration, label, selected, onSelect, onCommit, movable = false, anchors, disabled, top = 5, minStart, maxEnd, className, onDoubleClick, icon, fixedLength = false }: {
  start: number; end: number; pps: number; fps: number; duration: number; label: string; selected: boolean;
  onSelect: () => void; onCommit: (a: number, b: number) => void; movable?: boolean; anchors: number[]; disabled: boolean; top?: number;
  minStart?: number; maxEnd?: number; className?: string; onDoubleClick?: () => void; icon?: string;
  /** Panjang tetap (SFX): hanya bisa digeser, tanpa pegangan trim. */
  fixedLength?: boolean;
}) {
  const lo = minStart ?? (movable ? 0 : start), hi = maxEnd ?? (movable ? duration : end);
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);
  const drag = useRef<{ x: number; mode: "start" | "end" | "move"; moved: boolean } | null>(null);
  const draftRef = useRef(draft);
  const skipClick = useRef(false);
  const begin = (e: React.PointerEvent<HTMLDivElement>, mode: "start" | "end" | "move") => {
    if (disabled || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); onSelect();
    drag.current = { x: e.clientX, mode, moved: false }; e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    e.stopPropagation(); const delta = (e.clientX - d.x) / pps;
    d.moved ||= Math.abs(e.clientX - d.x) > 2;
    let a = start, b = end;
    if (d.mode === "start") a = Math.max(lo, Math.min(end - 1 / fps, snapTime(start + delta, fps, anchors, !e.altKey)));
    if (d.mode === "end") b = Math.min(hi, Math.max(start + 1 / fps, snapTime(end + delta, fps, anchors, !e.altKey)));
    if (d.mode === "move") { a = Math.max(lo, Math.min(hi - (end - start), snapTime(start + delta, fps, anchors, !e.altKey))); b = a + end - start; }
    draftRef.current = { a, b }; setDraft(draftRef.current);
  };
  const finish = (e: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    if (!drag.current) return;
    e.stopPropagation(); const changed = draftRef.current;
    skipClick.current = drag.current.moved;
    if (!cancel && drag.current.moved && changed) onCommit(changed.a, changed.b);
    drag.current = null; draftRef.current = null; setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const a = draft?.a ?? start, b = draft?.b ?? end;
  return <div role="button" tabIndex={0} aria-label={label} aria-pressed={selected} className={`${s.editBlock} ${selected ? s.editBlockSelected : ""} ${movable ? s.titleBlock : ""} ${className ?? ""}`} style={{ left: a * pps, width: Math.max(8, (b - a) * pps), top }}
    onClick={(e) => { e.stopPropagation(); if (!skipClick.current) onSelect(); skipClick.current = false; }}
    onDoubleClick={onDoubleClick ? (e) => { e.stopPropagation(); onDoubleClick(); } : undefined}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelect(); } }}
    onPointerDown={movable ? (e) => begin(e, "move") : undefined} onPointerMove={move} onPointerUp={(e) => finish(e)} onPointerCancel={(e) => finish(e, true)} title={`${label} · ${a.toFixed(2)}–${b.toFixed(2)} s`}>
    {!fixedLength && <span className={s.trimHandle} role="slider" tabIndex={disabled ? -1 : 0} aria-label={`Trim awal ${label}`} aria-valuenow={a} aria-valuemin={0} aria-valuemax={end} onPointerDown={(e) => begin(e as unknown as React.PointerEvent<HTMLDivElement>, "start")} onKeyDown={(e) => { e.stopPropagation(); if (!disabled && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); const t = start + (e.key === "ArrowRight" ? 1 : -1) / fps; if (t >= lo - 1e-9 && t < end) onCommit(t, end); } }}/>}
    <span className={s.editBlockLabel}>{icon ?? (movable ? "Aa " : "▸ ")}{label}</span>
    {!fixedLength && <span className={`${s.trimHandle} ${s.trimEnd}`} role="slider" tabIndex={disabled ? -1 : 0} aria-label={`Trim akhir ${label}`} aria-valuenow={b} aria-valuemin={start} aria-valuemax={duration} onPointerDown={(e) => begin(e as unknown as React.PointerEvent<HTMLDivElement>, "end")} onKeyDown={(e) => { e.stopPropagation(); if (!disabled && ["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); const t = end + (e.key === "ArrowRight" ? 1 : -1) / fps; if (t <= hi + 1e-9 && t > start) onCommit(start, t); } }}/>}
  </div>;
}
