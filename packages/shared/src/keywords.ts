// Pemilih kata kunci otomatis dari transkrip (murni, deterministik, tanpa AI).
// Skor: angka/bilangan, kata panjang bermakna, kata di akhir kalimat. Kata fungsi dan kata yang mungkin salah dengar dilewati (aturan 7).
import { AUTO_KEYWORDS } from "@app/config";
import { normalizeToken, type TWord } from "./phrase.ts";

export type KeywordDensity = keyof typeof AUTO_KEYWORDS.gapSec;
export type KeywordPick = { index: number; text: string; start: number; end: number; score: number; effect: "aksen" | "slam" };

const STOP = new Set<string>(AUTO_KEYWORDS.stopwords);
const NUMBERS = new Set<string>(AUTO_KEYWORDS.numberWords);

export function keywordScore(words: Array<TWord & { confidence?: number | null }>, i: number, counts: Map<string, number>): number {
  const w = words[i];
  const t = normalizeToken(w.text);
  if (!t || STOP.has(t)) return 0;
  if (typeof w.confidence === "number" && w.confidence < AUTO_KEYWORDS.minConfidence) return 0;
  const isNumber = /^\d/.test(t) || NUMBERS.has(t);
  if (!isNumber && t.replace(/\d/g, "").length < AUTO_KEYWORDS.minLetters) return 0;
  let score = isNumber ? 4 : 0;
  score += t.length >= 8 ? 2.5 : t.length >= 6 ? 1.5 : 0.5;
  if (/[.!?]["')\]]*$/.test(w.text.trim())) score += 1; // penekanan alami di akhir kalimat
  if (/!$/.test(w.text.trim())) score += 1;
  // Kata yang sama berulang (mis. topik utama) sedikit diutamakan, tapi tidak mendominasi
  if ((counts.get(t) ?? 0) >= 2) score += 0.5;
  return score;
}

/** Pilih kata kunci: maksimal satu per jendela waktu sesuai kepadatan; slam untuk skor tertinggi yang berjauhan. */
export function pickKeywords(
  words: Array<TWord & { confidence?: number | null }>,
  opts: { density: KeywordDensity; slamCount: number; max: number; skip?: Array<{ start: number; end: number }> },
): KeywordPick[] {
  const gap = AUTO_KEYWORDS.gapSec[opts.density];
  const counts = new Map<string, number>();
  for (const w of words) { const t = normalizeToken(w.text); counts.set(t, (counts.get(t) ?? 0) + 1); }
  const scored = words
    .map((w, i) => ({ index: i, text: w.text.trim(), start: w.start, end: w.end, score: keywordScore(words, i, counts) }))
    .filter((c) => c.score > 0 && !(opts.skip ?? []).some((s) => c.start < s.end && c.end > s.start));
  // Rakus menurut skor, lalu jaga jarak waktu; urutan asli dipakai sebagai pemutus seri agar deterministik
  scored.sort((a, b) => b.score - a.score || a.start - b.start);
  const chosen: typeof scored = [];
  for (const c of scored) {
    if (chosen.length >= opts.max) break;
    if (chosen.some((x) => Math.abs(x.start - c.start) < gap)) continue;
    const key = normalizeToken(c.text);
    if (chosen.filter((x) => normalizeToken(x.text) === key).length >= AUTO_KEYWORDS.maxRepeats) continue;
    chosen.push(c);
  }
  const slams: typeof scored = [];
  for (const c of chosen) {
    if (slams.length >= Math.min(opts.slamCount, AUTO_KEYWORDS.slamMax)) break;
    if (slams.some((x) => Math.abs(x.start - c.start) < AUTO_KEYWORDS.slamGapSec || normalizeToken(x.text) === normalizeToken(c.text))) continue;
    slams.push(c);
  }
  return chosen
    .map((c) => ({ ...c, effect: slams.includes(c) ? ("slam" as const) : ("aksen" as const) }))
    .sort((a, b) => a.start - b.start);
}
