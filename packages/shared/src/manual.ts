import { MANUAL } from "@app/config";
import { z } from "zod";
import type { Interval } from "./edl.ts";

const Time = z.number().finite().min(0).max(86400);
const Range = z.object({ start: Time, end: Time }).refine((r) => r.end > r.start);
export const TransformSchema = z.object({
  x: z.number().finite().min(-100).max(100), y: z.number().finite().min(-100).max(100),
  scale: z.number().finite().min(0.1).max(4), rotation: z.number().finite().min(-180).max(180),
  opacity: z.number().finite().min(0).max(1),
});
export type Transform = z.infer<typeof TransformSchema>;
export const ManualSchema = z.object({
  cuts: z.array(Range).max(MANUAL.maxCuts).default([]),
  splits: z.array(Time).max(MANUAL.maxSplits).default([]),
  /** Bagian video mentah yang dipulihkan pengguna, termasuk bagian yang dipotong AI dan disetujui. */
  keeps: z.array(Range).max(MANUAL.maxKeeps).default([]),
  keyframes: z.array(TransformSchema.extend({ time: Time })).max(MANUAL.maxKeyframes).default([]),
});
export type ManualEdit = z.infer<typeof ManualSchema>;
export function normalizeManual(raw: unknown): ManualEdit {
  const parsed = ManualSchema.safeParse(raw ?? {});
  if (!parsed.success) return { cuts: [], splits: [], keeps: [], keyframes: [] };
  return {
    cuts: parsed.data.cuts,
    splits: [...new Set(parsed.data.splits)].sort((a, b) => a - b),
    keeps: unionRanges(parsed.data.keeps),
    keyframes: [...new Map(parsed.data.keyframes.map((k) => [k.time, k])).values()].sort((a, b) => a.time - b.time),
  };
}

/** Gabungan rentang: urut, yang tumpang tindih atau bersentuhan disatukan. */
export function unionRanges(ranges: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

/** Rentang dikurangi satu rentang lain. */
export function subtractRange(ranges: Interval[], cut: Interval): Interval[] {
  return ranges.flatMap((s) => {
    if (cut.end <= s.start || cut.start >= s.end) return [s];
    return [...(cut.start > s.start ? [{ start: s.start, end: cut.start }] : []), ...(cut.end < s.end ? [{ start: cut.end, end: s.end }] : [])];
  });
}

/** Apply manual edits AFTER approved AI cuts: restored parts (keeps) first, then manual cuts. Split never removes a frame.
 * Source coordinates keep subtitles, AI cuts, titles and camera requests in sync. */
export function manualSegments(segments: Interval[], raw: unknown): Interval[] {
  const manual = normalizeManual(raw);
  // Bagian yang dipulihkan menyatu dengan klip di sebelahnya. Sambungan hilang bila celahnya pulih seluruhnya.
  let result = manual.keeps.length ? unionRanges([...segments, ...manual.keeps]) : segments.map((s) => ({ ...s }));
  for (const cut of manual.cuts) result = subtractRange(result, cut);
  return result.flatMap((s) => {
    const times = [s.start, ...manual.splits.filter((t) => t > s.start && t < s.end), s.end];
    return times.slice(1).map((end, i) => ({ start: times[i], end }));
  });
}

/**
 * Pulihkan rentang video mentah (perpanjang klip ke bagian terpotong). Rentang dimasukkan ke `keeps`, dan cut manual yang
 * tumpang tindih dibuang, karena cut manual diterapkan sesudah keeps. Mengembalikan null bila batas `keeps` terlampaui.
 */
export function restoreRange(raw: unknown, range: Interval): ManualEdit | null {
  const manual = normalizeManual(raw);
  if (!(range.end > range.start)) return manual;
  const keeps = unionRanges([...manual.keeps, range]);
  if (keeps.length > MANUAL.maxKeeps) return null;
  return { ...manual, keeps, cuts: manual.cuts.flatMap((c) => subtractRange([c], range)) };
}

/**
 * Seberapa jauh klip boleh diperpanjang: sampai tepi klip tetangga di video mentah (urutan ucapan tidak pernah tertukar).
 * Bila mencapai tepi tetangga, keduanya menyatu.
 */
export function extendLimits(segments: Interval[], clip: Interval, duration: number, bounds?: Interval): { minStart: number; maxEnd: number } {
  // Fase 16: segmen bisa dalam urutan tampil (tidak urut sumber), dan klip tidak boleh melewati tepi videonya sendiri
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const before = sorted.filter((s) => s.end <= clip.start + 1e-9).at(-1);
  const after = sorted.find((s) => s.start >= clip.end - 1e-9);
  const lo = bounds?.start ?? 0, hi = bounds?.end ?? duration;
  return { minStart: Math.max(lo, before ? before.end : 0), maxEnd: Math.min(hi, after ? after.start : duration) };
}

export function applyManualEdl<T extends { segments: Interval[]; appliedCuts: Interval[]; keptS: number; removedS: number }>(edl: T, raw: unknown, duration: number): T {
  const segments = manualSegments(edl.segments, raw);
  const appliedCuts: Interval[] = [];
  let cursor = 0;
  for (const s of segments) { if (s.start > cursor) appliedCuts.push({ start: cursor, end: s.start }); cursor = s.end; }
  if (cursor < duration) appliedCuts.push({ start: cursor, end: duration });
  const keptS = segments.reduce((n, s) => n + s.end - s.start, 0);
  return { ...edl, segments, appliedCuts, keptS, removedS: duration - keptS };
}

export function transformFromParams(p: Record<string, unknown>): Transform {
  return { x: Number(p["video.x"] ?? 0), y: Number(p["video.y"] ?? 0), scale: Number(p["video.skala"] ?? 1), rotation: Number(p["video.rotasi"] ?? 0), opacity: Number(p["video.opacity"] ?? 1) };
}

/** Deterministic smoothstep keyframes, shared by preview and render. */
export function transformAt(keys: ManualEdit["keyframes"], time: number, fallback: Transform = MANUAL.transform): Transform {
  if (!keys.length) return fallback;
  if (time <= keys[0].time) return keys[0];
  const next = keys.findIndex((k) => k.time > time);
  if (next === -1) return keys[keys.length - 1];
  const a = keys[next - 1], b = keys[next];
  const t = (time - a.time) / (b.time - a.time), eased = t * t * (3 - 2 * t);
  const out = { ...fallback };
  for (const k of Object.keys(out) as (keyof Transform)[]) out[k] = a[k] + (b[k] - a[k]) * eased;
  return out;
}

export function snapTime(time: number, fps: number, anchors: number[] = [], snap = true): number {
  let t = Math.round(time * fps) / fps;
  if (snap) {
    const closest = anchors.reduce((a, b) => Math.abs(b - t) < Math.abs(a - t) ? b : a, Infinity);
    if (Math.abs(closest - t) <= MANUAL.snapSeconds) t = Math.round(closest * fps) / fps;
  }
  return t;
}

export type Focus = { x: number; y: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Titik fokus baru setelah video digeser `dx`/`dy` piksel komposisi. Video di-cover ke canvas lalu diskala `scale`
 * dengan poros di titik fokus, sehingga rentang geser = lebar tampil video − lebar canvas (lihat Edited.tsx).
 * Sumbu tanpa sisa (video pas di canvas) tidak berubah.
 */
export function panFocus(start: Focus, dx: number, dy: number, dims: { compW: number; compH: number; srcW: number; srcH: number; scale: number }): Focus {
  const cover = Math.max(dims.compW / dims.srcW, dims.compH / dims.srcH);
  const ox = dims.scale * dims.srcW * cover - dims.compW, oy = dims.scale * dims.srcH * cover - dims.compH;
  return { x: ox > 0.5 ? clamp01(start.x - dx / ox) : start.x, y: oy > 0.5 ? clamp01(start.y - dy / oy) : start.y };
}
