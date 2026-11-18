"use client";
// Track Audio: gelombang suara dalam WAKTU HASIL (bagian yang dipotong tidak tampil), agar cut-to-cut bisa dilihat dari
// jeda dan kata. Hanya area yang terlihat yang digambar (canvas selebar layar), jadi tetap ringan pada zoom tinggi.
import { useCallback, useEffect, useRef } from "react";
import type { FrameSegment } from "@app/remotion/src/frames.ts";
import s from "./editor.module.css";

export type Waveform = { perSecond: number; peaks: Uint8Array };

export function WaveformLane({ scrollRef, pps, duration, frameSegs, fps, wave, height, onClick, gain = 1 }: {
  /** Volume audio sumber (0 = bisu): tinggi gelombang ikut berubah agar perubahan volume terlihat. */
  gain?: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pps: number;
  /** Durasi hasil (detik). */
  duration: number;
  frameSegs: FrameSegment[];
  fps: number;
  wave: Waveform | null;
  height: number;
  onClick: (e: React.MouseEvent) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draw = useCallback(() => {
    const c = canvasRef.current, sc = scrollRef.current;
    if (!c || !sc) return;
    const dpr = window.devicePixelRatio || 1;
    const w = sc.clientWidth, h = height;
    c.style.left = `${sc.scrollLeft}px`;
    c.style.width = `${w}px`;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!wave) return;
    const css = getComputedStyle(c);
    g.fillStyle = css.getPropertyValue("--ui-track-audio").trim() || css.getPropertyValue("--accent").trim() || "#9be15d";
    const mid = h / 2, amp = h / 2 - 3, rate = wave.perSecond, peaks = wave.peaks;
    // waktu hasil -> waktu mentah per piksel (segmen terurut; dicari maju karena x naik)
    let si = 0;
    for (let x = 0; x < w; x++) {
      const tA = (sc.scrollLeft + x) / pps;
      if (tA >= duration) break;
      const fA = tA * fps;
      if (frameSegs.length) { while (si < frameSegs.length - 1 && fA >= frameSegs[si].at + frameSegs[si].length) si++; }
      const seg = frameSegs[si];
      const srcA = seg ? (seg.srcFrom + (fA - seg.at)) / fps : tA;
      const srcB = Math.min(seg ? seg.srcTo / fps : Infinity, srcA + 1 / pps);
      let max = 0;
      for (let i = Math.floor(srcA * rate), end = Math.max(i + 1, Math.ceil(srcB * rate)); i < end && i < peaks.length; i++) if (peaks[i] > max) max = peaks[i];
      const bar = Math.max(gain > 0 ? 1 : 0.5, Math.min(amp, (max / 255) * amp * gain));
      g.fillRect(x, mid - bar, 1, bar * 2);
    }
    // garis tengah tipis agar bagian hening tetap terbaca sebagai "ada audio"
    g.globalAlpha = 0.35;
    g.fillRect(0, mid - 0.5, Math.min(w, duration * pps - sc.scrollLeft), 1);
    g.globalAlpha = 1;
  }, [scrollRef, pps, duration, frameSegs, fps, wave, height, gain]);

  useEffect(() => {
    draw();
    const sc = scrollRef.current;
    if (!sc) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    sc.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(sc);
    return () => { sc.removeEventListener("scroll", onScroll); ro.disconnect(); cancelAnimationFrame(raf); };
  }, [draw, scrollRef]);

  return (
    <div className={s.lane} style={{ height, position: "relative" }} onClick={onClick} title="Gelombang audio hasil: jeda terlihat datar, kata terlihat tinggi. Klik untuk menuju waktu itu.">
      <canvas ref={canvasRef} className={s.waveCanvas} style={{ height }} aria-hidden />
      {!wave && <span className={s.trackHint}>Memuat gelombang audio…</span>}
    </div>
  );
}
