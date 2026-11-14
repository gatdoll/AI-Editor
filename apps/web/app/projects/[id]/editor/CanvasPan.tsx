"use client";
import { useEffect, useRef } from "react";
import { MANUAL } from "@app/config";
import { panFocus, type Focus } from "@app/shared/manual";
import s from "./editor.module.css";

export type { Focus };

/**
 * Lapisan di atas pratinjau untuk menggeser video seperti di Canva: tarik = posisi, roda mouse = zoom,
 * klik dua kali = kembali ke tengah. Hanya mengubah gaya project (non-destruktif); render memakai nilai yang sama.
 */
export function CanvasPan({ focus, scale, compW, compH, srcW, srcH, keyframed, onPan, onZoom, onReset, onDone }: {
  focus: Focus; scale: number; compW: number; compH: number; srcW: number; srcH: number;
  /** Ada keyframe transform: skala statis ditimpa keyframe, zoom lewat roda tidak terlihat. */
  keyframed: boolean;
  onPan: (f: Focus) => void; onZoom: (scale: number) => void; onReset: () => void; onDone: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; focus: Focus } | null>(null);
  const live = useRef({ scale, onZoom });
  live.current = { scale, onZoom };

  // Roda harus non-passive agar halaman tidak ikut bergulir
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoomMin, zoomMax, wheelZoomRate } = MANUAL.pan;
      const cur = live.current.scale;
      const next = Math.min(zoomMax, Math.max(Math.min(zoomMin, cur), cur * Math.exp(-e.deltaY * wheelZoomRate)));
      live.current.onZoom(Math.round(next * 100) / 100);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const move = (e: React.PointerEvent) => {
    const d = drag.current, el = ref.current; if (!d || !el) return;
    const k = compW / el.getBoundingClientRect().width;
    onPan(panFocus(d.focus, (e.clientX - d.x) * k, (e.clientY - d.y) * k, { compW, compH, srcW, srcH, scale }));
  };

  return (
    <div ref={ref} className={s.panLayer} role="application" aria-label="Geser video di canvas"
      onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, focus }; }}
      onPointerMove={move}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={onReset}>
      <div className={s.panGrid} />
      <div className={s.panBar} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <span>Tarik untuk geser · scroll untuk zoom{keyframed ? " (ditimpa keyframe)" : ""} · {Math.round(focus.x * 100)}% / {Math.round(focus.y * 100)}% · {scale.toFixed(2)}×</span>
        <button onClick={onReset}>Reset</button>
        <button className={s.panDone} onClick={onDone}>Selesai</button>
      </div>
    </div>
  );
}
