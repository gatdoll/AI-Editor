// Fase 16: banyak video dalam satu project. Murni (browser dan Node).
//
// Semua video project disusun di SATU sumbu waktu sumber ("reel"): video punya `offset` tetap (detik) yang diberikan saat
// ingest dan tidak pernah berubah, dengan jarak VIDEO.reelGapSec antar video. Karena itu semua data yang memakai "waktu
// video mentah" (kata, usulan cut, cut manual, subtitle, judul, kamera, SFX) tetap benar untuk project lama (satu video,
// offset 0) maupun baru, tanpa dihitung ulang.
//
// Urutan TAMPIL di hasil video terpisah dari reel: `style.reelOrder` (id video). EDL disusun per video menurut urutan itu;
// di dalam satu video tetap urut waktu. Video di `style.reelHidden` tidak tampil (seluruh rentangnya dianggap terpotong).
import type { Interval } from "./edl.ts";

export type ReelClip = {
  /** id aset video mentah. */
  id: string;
  /** Awal video ini pada sumbu reel (detik). */
  offset: number;
  duration: number;
  label?: string;
};

export const reelEnd = (c: ReelClip) => c.offset + c.duration;

/** Panjang sumbu reel (akhir video terakhir). Lubang antar video ikut terhitung. */
export function reelDuration(clips: ReelClip[]): number {
  return clips.reduce((m, c) => Math.max(m, reelEnd(c)), 0);
}

/** Jumlah durasi semua video (tanpa lubang): dasar "durasi dipotong" di UI. */
export function reelMediaSeconds(clips: ReelClip[]): number {
  return clips.reduce((n, c) => n + c.duration, 0);
}

/** Video yang memuat waktu reel `t` (awal inklusif, akhir eksklusif kecuali video terakhir). */
export function clipAt(clips: ReelClip[], t: number): ReelClip | undefined {
  return clips.find((c) => t >= c.offset - 1e-9 && t < reelEnd(c) - 1e-9) ?? clips.find((c) => Math.abs(t - reelEnd(c)) < 1e-6);
}

/** Urutan tampil yang sah: id dari `order` yang masih ada, lalu video sisanya menurut offset (urutan unggah). */
export function normalizeOrder(order: readonly string[] | undefined, clips: ReelClip[]): string[] {
  const ids = new Set(clips.map((c) => c.id));
  const head = [...new Set((order ?? []).filter((id) => ids.has(id)))];
  const rest = [...clips].sort((a, b) => a.offset - b.offset).map((c) => c.id).filter((id) => !head.includes(id));
  return [...head, ...rest];
}

/**
 * Segmen yang dipertahankan (waktu reel, urut naik) -> segmen dalam URUTAN TAMPIL: dipotong di batas video, dibuang yang
 * jatuh di lubang atau di video tersembunyi, lalu dikelompokkan per video menurut `order`. Tanpa `clips` (data lama tanpa
 * reel) segmen dikembalikan apa adanya.
 */
export function arrangeSegments(segments: Interval[], clips: ReelClip[], order?: readonly string[], hidden?: readonly string[]): Interval[] {
  if (!clips.length) return segments.map((s) => ({ ...s }));
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const id of normalizeOrder(order, clips)) {
    if (hidden?.includes(id)) continue;
    const c = clips.find((x) => x.id === id)!;
    for (const s of sorted) {
      const a = Math.max(s.start, c.offset), b = Math.min(s.end, reelEnd(c));
      if (b - a > 1e-6) out.push({ start: a, end: b });
    }
  }
  return out;
}

/** EDL tersusun: segmen dalam urutan tampil + angka dipertahankan/dipotong dihitung dari video (bukan dari lubang reel). */
export function arrangeEdl<T extends { segments: Interval[]; keptS: number; removedS: number }>(edl: T, clips: ReelClip[], order?: readonly string[], hidden?: readonly string[]): T {
  if (!clips.length) return edl;
  const segments = arrangeSegments(edl.segments, clips, order, hidden);
  const keptS = segments.reduce((n, s) => n + s.end - s.start, 0);
  return { ...edl, segments, keptS, removedS: Math.max(0, reelMediaSeconds(clips) - keptS) };
}

/** Offset untuk video baru: setelah video terakhir + jarak. Video pertama mulai di 0. */
export function nextOffset(clips: ReelClip[], gapSec: number): number {
  return clips.length ? reelDuration(clips) + gapSec : 0;
}

/** Normalisasi `style.reelOrder` / `style.reelHidden` / `style.focusBy` (id = uuid). */
export function normalizeIdList(raw: unknown, max = 200): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = [...new Set(raw.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).map((x) => x.toLowerCase()))].slice(0, max);
  return ids.length ? ids : undefined;
}

export function normalizeFocusBy(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (/^[0-9a-f-]{36}$/i.test(k) && typeof v === "number" && Number.isFinite(v)) out[k.toLowerCase()] = Math.min(1, Math.max(0, v));
  }
  return Object.keys(out).length ? out : undefined;
}
