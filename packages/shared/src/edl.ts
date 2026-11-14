// Logika murni (tanpa Node/Supabase) sehingga aman dipakai di browser maupun server.

export type Interval = { start: number; end: number };

export type EdlResult = {
  /** Segmen yang DIPERTAHANKAN, urut, tidak tumpang tindih. */
  segments: Interval[];
  /** Potongan yang benar-benar diterapkan (setelah digabung dan diberi padding). */
  appliedCuts: Interval[];
  /** Potongan yang diabaikan karena terlalu pendek setelah padding. */
  skippedTooShort: number;
  removedS: number;
  keptS: number;
};

const MIN_CUT_SEC = 0.05;

/** Potongan + batas aman padding di tiap sisi (detik). Infinity = tidak dibatasi. */
export type CutInput = Interval & { maxPadStart?: number; maxPadEnd?: number };

type TimedWord = { start: number; end: number };

/**
 * Jarak aman dari batas potongan ke kata yang dipotong. Padding yang lebih besar dari ini akan
 * membawa serpihan kata yang seharusnya hilang. Potongan tanpa kata (mis. jeda diam) tidak dibatasi.
 * Kata dianggap ikut dipotong bila titik tengahnya berada di dalam potongan.
 */
export function cutSlack(words: TimedWord[], cut: Interval): { maxPadStart: number; maxPadEnd: number } {
  let first: TimedWord | null = null;
  let last: TimedWord | null = null;
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    if (mid >= cut.start && mid <= cut.end) {
      first ??= w;
      last = w;
    }
  }
  if (!first || !last) return { maxPadStart: Infinity, maxPadEnd: Infinity };
  return {
    maxPadStart: Math.max(0, first.start - cut.start),
    maxPadEnd: Math.max(0, cut.end - last.end),
  };
}

/**
 * Susun EDL dari potongan yang DISETUJUI pengguna.
 * Aturan 5: di tiap sambungan, sisakan hingga `padSec` dari materi yang dipotong di kedua sisi,
 * supaya sambungan tidak terasa patah. Padding dibatasi `maxPadStart/maxPadEnd` agar tidak
 * membawa serpihan kata yang dipotong. Potongan yang habis oleh padding diabaikan.
 */
export function buildEdl(durationS: number, cuts: CutInput[], padSec: number): EdlResult {
  const clamped = cuts
    .map((c) => ({
      start: Math.max(0, c.start),
      end: Math.min(durationS, c.end),
      maxPadStart: c.maxPadStart ?? Infinity,
      maxPadEnd: c.maxPadEnd ?? Infinity,
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);

  // Gabungkan yang tumpang tindih; batas aman sisi awal dari potongan pertama, sisi akhir dari yang terakhir.
  const merged: typeof clamped = [];
  for (const c of clamped) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end) {
      if (c.end > last.end) {
        last.end = c.end;
        last.maxPadEnd = c.maxPadEnd;
      }
    } else merged.push({ ...c });
  }

  const applied: Interval[] = [];
  let skipped = 0;
  for (const m of merged) {
    const start = m.start > 0 ? m.start + Math.min(padSec, m.maxPadStart) : 0;
    const end = m.end < durationS ? m.end - Math.min(padSec, m.maxPadEnd) : durationS;
    if (end - start < MIN_CUT_SEC) skipped++;
    else applied.push({ start, end });
  }

  const segments: Interval[] = [];
  let cursor = 0;
  for (const c of applied) {
    if (c.start > cursor) segments.push({ start: cursor, end: c.start });
    cursor = c.end;
  }
  if (cursor < durationS) segments.push({ start: cursor, end: durationS });

  const removedS = applied.reduce((n, c) => n + (c.end - c.start), 0);
  return { segments, appliedCuts: applied, skippedTooShort: skipped, removedS, keptS: durationS - removedS };
}
