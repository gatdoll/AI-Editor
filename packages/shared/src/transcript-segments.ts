// Fase 12: transkrip dari video yang sudah dipotong. Audio bagian yang dipertahankan digabung lalu ditranskrip;
// waktu kata dipetakan kembali ke video mentah. Murni, aman di browser dan Node.
import type { Interval } from "./edl.ts";
import { unionRanges } from "./manual.ts";

/** Rentang yang ditranskrip: segmen dipertahankan, yang bersentuhan (split) digabung, yang terlalu pendek dibuang. */
export function transcriptSegments(segments: Interval[]): Interval[] {
  return unionRanges(segments.filter((s) => s.end - s.start > 0.05));
}

/** Waktu pada audio gabungan -> waktu video mentah. Waktu tepat di sambungan masuk ke segmen sesudahnya. */
export function concatToSource(t: number, segments: Interval[]): number {
  let acc = 0;
  for (const s of segments) {
    const len = s.end - s.start;
    if (t < acc + len) return s.start + Math.max(0, t - acc);
    acc += len;
  }
  const last = segments[segments.length - 1];
  return last ? last.end : t;
}

/**
 * Petakan kata hasil Whisper (waktu audio gabungan) ke video mentah. Kata yang melintasi sambungan dijepit ke segmen
 * titik tengahnya, jadi tidak pernah membentang di atas bagian yang dipotong.
 */
export function mapWordsFromConcat<W extends { start: number; end: number }>(words: W[], segments: Interval[]): W[] {
  return words.map((w) => {
    const mid = concatToSource((w.start + w.end) / 2, segments);
    const seg = segments.find((s) => mid >= s.start && mid <= s.end) ?? segments[0];
    const start = Math.max(seg.start, concatToSource(w.start, segments));
    const end = Math.min(seg.end, Math.max(start + 0.02, concatToSource(Math.max(w.start, w.end - 1e-6), segments)));
    return { ...w, start, end: Math.max(end, start + 0.02) };
  });
}

/** Apakah transkrip (rentang `coverage`, null = seluruh video) sudah mencakup semua segmen yang dipertahankan sekarang. */
export function coversSegments(coverage: Interval[] | null | undefined, segments: Interval[], tol = 0.15): boolean {
  if (!coverage) return true;
  const cov = unionRanges(coverage);
  return transcriptSegments(segments).every((s) => {
    // bagian segmen yang tidak tertutup coverage harus sangat kecil (padding sambungan)
    let missing = s.end - s.start;
    for (const c of cov) missing -= Math.max(0, Math.min(c.end, s.end) - Math.max(c.start, s.start));
    return missing <= tol;
  });
}
