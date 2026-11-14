// Pemetaan waktu antara video MENTAH (sumber) dan video HASIL (setelah potongan), serta tata letak timeline.
// Murni. Memakai pembulatan frame yang sama dengan komposisi (toFrameSegments), jadi playhead tidak bergeser.
import { toFrameSegments, type FrameSegment, type TimeSegment } from "./frames.ts";

export type SourceToOutput = { out: number; inCut: boolean };

/**
 * Waktu sumber -> waktu hasil. Bila titiknya berada di bagian yang dipotong, `inCut` true dan
 * `out` = awal bagian yang dipertahankan berikutnya (atau akhir hasil bila tidak ada lagi).
 */
export function sourceToOutput(frames: FrameSegment[], fps: number, tSrc: number): SourceToOutput {
  // Fase 16: segmen bisa tidak urut naik di waktu sumber (urutan video diubah). Cari segmen yang MEMUAT titiknya;
  // bila terpotong, pakai materi berikutnya di waktu sumber (sama dengan perilaku lama untuk segmen urut).
  let next: FrameSegment | undefined;
  for (const s of frames) {
    const a = s.srcFrom / fps;
    const b = s.srcTo / fps;
    if (tSrc >= a && tSrc < b) return { out: s.at / fps + (tSrc - a), inCut: false };
    if (a > tSrc && (!next || s.srcFrom < next.srcFrom)) next = s;
  }
  if (next) return { out: next.at / fps, inCut: true };
  const last = frames[frames.length - 1];
  return { out: last ? (last.at + last.length) / fps : 0, inCut: tSrc > 0 };
}

/** Waktu hasil -> waktu sumber. Di luar rentang dijepit. */
export function outputToSource(frames: FrameSegment[], fps: number, tOut: number): number {
  if (frames.length === 0) return 0;
  for (const s of frames) {
    const a = s.at / fps;
    const b = (s.at + s.length) / fps;
    if (tOut < b) return s.srcFrom / fps + Math.max(0, tOut - a);
  }
  const last = frames[frames.length - 1];
  return last.srcTo / fps;
}

/**
 * Petakan rentang sumber [a,b] ke timeline hasil, dijepit ke SATU segmen yang dipertahankan
 * (yang memuat titik tengahnya). null bila titik tengahnya berada di bagian yang dipotong.
 */
export function mapRangeToOutput(frames: FrameSegment[], fps: number, a: number, b: number): { start: number; end: number } | null {
  const mid = (a + b) / 2;
  const seg = frames.find((s) => mid >= s.srcFrom / fps && mid < s.srcTo / fps);
  if (!seg) return null;
  const segA = seg.srcFrom / fps;
  const segB = seg.srcTo / fps;
  const base = seg.at / fps;
  const start = base + (Math.max(a, segA) - segA);
  const end = base + (Math.min(b, segB) - segA);
  return end > start ? { start, end } : null;
}

export function framesOf(segments: TimeSegment[], fps: number, sourceSeconds: number): FrameSegment[] {
  return toFrameSegments(segments, fps, sourceSeconds);
}

// ------------------------------------------------------------------ tata letak
export const timeToX = (t: number, pxPerSec: number) => t * pxPerSec;
export const xToTime = (x: number, pxPerSec: number) => x / pxPerSec;

export function clampZoom(pxPerSec: number, durationS: number, viewportPx: number): number {
  // Paling jauh: seluruh video muat di layar. Paling dekat: 400 px per detik.
  const min = Math.max(0.5, viewportPx / Math.max(1, durationS));
  return Math.min(400, Math.max(min, pxPerSec));
}

export type Tick = { t: number; label: string | null; major: boolean };

/** Penanda penggaris: interval "bagus" (1/2/5/10/15/30/60...) menurut zoom, label mm:ss pada garis besar. */
export function rulerTicks(durationS: number, pxPerSec: number): Tick[] {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const minLabelPx = 70;
  const major = steps.find((s) => s * pxPerSec >= minLabelPx) ?? 3600;
  const minor = major / (major >= 10 ? 5 : major >= 1 ? 2 : 2);
  const out: Tick[] = [];
  const n = Math.floor(durationS / minor + 1e-9);
  for (let i = 0; i <= n; i++) {
    const t = Math.round(i * minor * 1000) / 1000;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    out.push({ t, major: isMajor, label: isMajor ? fmtClock(t, major < 1) : null });
  }
  return out;
}

export function fmtClock(t: number, withTenths = false): string {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = withTenths ? sec.toFixed(1).padStart(4, "0") : String(Math.floor(sec)).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export type Block = { id: string; start: number; end: number; x: number; width: number };

/** Posisi piksel sebuah blok; lebar minimal agar blok pendek tetap bisa diklik. */
export function layoutBlock(id: string, start: number, end: number, pxPerSec: number, minWidthPx = 3): Block {
  return { id, start, end, x: timeToX(start, pxPerSec), width: Math.max(minWidthPx, timeToX(end - start, pxPerSec)) };
}

export type LaneItem = { id: string; start: number; end: number };

/**
 * Tempatkan blok yang saling tumpang tindih ke jalur (lane) berbeda secara serakah.
 * Hasil: id -> nomor jalur (0 = paling atas). `gapSec` = jarak minimum antar blok pada jalur yang sama.
 */
export function assignLanes(items: LaneItem[], gapSec = 0): { lanes: Map<string, number>; laneCount: number } {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const it of sorted) {
    let lane = laneEnds.findIndex((e) => e + gapSec <= it.start + 1e-9);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else laneEnds[lane] = it.end;
    lanes.set(it.id, lane);
  }
  return { lanes, laneCount: Math.max(1, laneEnds.length) };
}
