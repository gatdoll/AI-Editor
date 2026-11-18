import { MOTION, SUBTITLE, safeAreaOf, TITLE_ANIMS, type AspectId } from "@app/config";
import type { CaptionPage } from "./captions.ts";

export type MotionTitle = { text: string; subtext?: string; startS: number; endS: number; animation: (typeof TITLE_ANIMS)[number]; position: "atas" | "tengah" };

/** Conservative word wrapping fit: long titles stay within their own vertical zone. */
export function titleScale(text: string, width: number, height: number, aspect: AspectId): number {
  const base = SUBTITLE.fontSizePx[aspect] * height / SUBTITLE.referenceHeight[aspect] * MOTION.captionScale;
  const maxWidth = width * MOTION.captionMaxWidth;
  const words = text.trim().split(/\s+/);
  const fits = (scale: number) => {
    const font = base * scale;
    let lines = 1, used = 0;
    for (const word of words) {
      const wordWidth = word.length * font;
      if (wordWidth > maxWidth) return false;
      const gap = used ? font * MOTION.captionGapEm : 0;
      if (used + gap + wordWidth > maxWidth) { lines++; used = wordWidth; }
      else used += gap + wordWidth;
    }
    return lines * font * (MOTION.captionLineHeight + MOTION.captionGapEm + MOTION.underlineOffsetEm) <= height * MOTION.title.maxHeight;
  };
  if (fits(MOTION.title.scale)) return MOTION.title.scale;
  let lo: number = 0, hi: number = MOTION.title.scale;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}

export function normalizeTitles(value: unknown): MotionTitle[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is MotionTitle => v && typeof v.text === "string" && v.text.trim().length > 0 && v.text.length <= MOTION.title.maxChars
    && Number.isFinite(v.startS) && Number.isFinite(v.endS) && v.startS >= 0 && v.endS > v.startS
    && v.endS - v.startS <= MOTION.title.maxDurationSec
    && (TITLE_ANIMS as readonly string[]).includes(v.animation) && ["atas", "tengah"].includes(v.position))
    .slice(0, MOTION.title.maxCount).map((v) => ({ text: v.text.trim(), ...(typeof v.subtext === "string" && v.subtext.trim() ? { subtext: v.subtext.trim().slice(0, MOTION.title.maxChars) } : {}), startS: v.startS, endS: v.endS, animation: v.animation, position: v.position }));
}

export function titlePage(title: MotionTitle): CaptionPage {
  const words = title.text.split(/\s+/);
  const step = Math.min(MOTION.title.wordStaggerSec, (title.endS - title.startS) / (words.length + 2));
  return {
    start: title.startS, end: title.endS, lineStarts: [0],
    tokens: words.map((text, i) => ({ text, startMs: (title.startS + i * step) * 1000, endMs: Math.min(title.endS, title.startS + (i + 1) * step) * 1000, timestampMs: null, confidence: null })),
  };
}

/**
 * Jarak dasar judul dari bawah (pecahan tinggi). Judul "atas" setinggi maks MOTION.title.maxHeight tidak boleh masuk safe area
 * atas (9:16: nama akun / tab Reels), jadi dasarnya diturunkan bila perlu.
 */
export function titleBottom(position: string | undefined, aspect: AspectId, follow = true): number {
  if (position !== "atas") return MOTION.title.centerBottom;
  return Math.min(MOTION.title.topBottom, 1 - safeAreaOf(aspect, follow).top - MOTION.title.maxHeight);
}
