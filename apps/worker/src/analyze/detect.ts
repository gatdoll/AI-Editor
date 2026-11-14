import { ANALYSIS } from "@app/config";
import type { Word } from "@app/shared";

export type WordRange = { startWord: number; endWord: number };

export function normalizeToken(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Filler satu kata dari daftar di config. Filler berurutan digabung jadi satu rentang. */
export function detectFillers(words: Word[]): WordRange[] {
  const fillers = new Set<string>(ANALYSIS.fillers);
  const out: WordRange[] = [];
  for (let i = 0; i < words.length; i++) {
    if (!fillers.has(normalizeToken(words[i].text))) continue;
    const last = out[out.length - 1];
    if (last && last.endWord === i - 1) last.endWord = i;
    else out.push({ startWord: i, endWord: i });
  }
  return out;
}

/** Aturan 7: rangkaian kata ber-confidence rendah ditandai "tidak bisa dinilai", bukan ditebak. */
export function detectUnclear(words: Word[]): WordRange[] {
  const out: WordRange[] = [];
  let runStart = -1;
  const flush = (end: number) => {
    if (runStart >= 0 && end - runStart + 1 >= ANALYSIS.unclearMinRun) {
      out.push({ startWord: runStart, endWord: end });
    }
    runStart = -1;
  };
  for (let i = 0; i < words.length; i++) {
    const low = words[i].confidence != null && words[i].confidence! < ANALYSIS.unclearConfidence;
    if (low) {
      if (runStart < 0) runStart = i;
    } else flush(i - 1);
  }
  flush(words.length - 1);
  return out;
}

/**
 * Waktu potong untuk rentang kata [a..b]: batas dipasang di tengah celah antar kata,
 * bukan di tepi kata, karena timestamp Whisper per kata tidak presisi.
 */
export function spanTimes(words: Word[], a: number, b: number): { start: number; end: number } {
  const first = words[a];
  const last = words[b];
  const prev = a > 0 ? words[a - 1] : null;
  const next = b < words.length - 1 ? words[b + 1] : null;
  // Potongan yang memuat kata pertama/terakhir video diperluas sampai tepi file: diam di ujung
  // ikut hilang, dan tidak ada sisa kata karena padding.
  let start = prev ? (prev.end + first.start) / 2 : 0;
  let end = next ? (last.end + next.start) / 2 : last.end + 0.5;
  if (!(end > start)) {
    start = first.start;
    end = Math.max(last.end, first.start + 0.05);
  }
  return { start: Math.max(0, start), end };
}

export function quoteOf(words: Word[], a: number, b: number, max = 240): string {
  const text = words.slice(a, b + 1).map((w) => w.text).join(" ");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
