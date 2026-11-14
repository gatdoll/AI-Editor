// Pencarian frasa di transkrip (murni, aman di browser dan Node).
// Dipakai prompt: "potong bagian saat aku bilang X", "zoom saat aku bilang harga".
// Rule 7: bila tidak ketemu, kembalikan kosong. Jangan menebak.

export type TWord = { text: string; start: number; end: number };

export type PhraseMatch = {
  /** Indeks kata pertama dan terakhir (inklusif) pada transkrip. */
  startWord: number;
  endWord: number;
  /** Waktu mentah kata pertama/terakhir (detik). */
  start: number;
  end: number;
  /** true bila semua kata cocok persis (setelah normalisasi); false bila ada kata yang hanya mirip (beda 1 huruf). */
  exact: boolean;
};

/** Huruf kecil, tanpa aksen, tanpa tanda baca. "Premiere." -> "premiere". */
export function normalizeToken(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Jarak edit Levenshtein, berhenti lebih awal bila > limit. */
function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Kata mirip? Toleransi ejaan Whisper hanya untuk kata panjang (>= 6 huruf): beda 1 huruf.
 * Kata pendek harus persis, karena beda 1 huruf pada kata pendek biasanya kata lain ("buka" vs "buku").
 */
function tokensMatch(a: string, b: string, fuzzy: boolean): "exact" | "fuzzy" | null {
  if (a === b) return "exact";
  if (fuzzy && a.length >= 6 && b.length >= 6 && editDistance(a, b, 1) <= 1) return "fuzzy";
  return null;
}

export function findPhrase(words: TWord[], phrase: string, opts: { fuzzy?: boolean; maxResults?: number } = {}): PhraseMatch[] {
  const fuzzy = opts.fuzzy ?? true;
  const max = opts.maxResults ?? 200;
  const target = phrase.split(/\s+/).map(normalizeToken).filter(Boolean);
  if (target.length === 0 || target.length > words.length) return [];

  const norm = words.map((w) => normalizeToken(w.text));
  const out: PhraseMatch[] = [];
  for (let i = 0; i + target.length <= words.length && out.length < max; ) {
    let exact = true;
    let ok = true;
    for (let k = 0; k < target.length; k++) {
      // kata tanpa huruf/angka (mis. "-") dilewati oleh normalisasi: anggap tidak cocok
      const m = norm[i + k] ? tokensMatch(norm[i + k], target[k], fuzzy) : null;
      if (!m) {
        ok = false;
        break;
      }
      if (m === "fuzzy") exact = false;
    }
    if (ok) {
      out.push({ startWord: i, endWord: i + target.length - 1, start: words[i].start, end: words[i + target.length - 1].end, exact });
      i += target.length; // tidak tumpang tindih
    } else i++;
  }
  return out;
}

const SENTENCE_END = /[.!?…]["')\]]*$/;

/** Perluas rentang kata ke batas kalimat (setelah titik/tanda tanya sebelumnya sampai titik berikutnya). */
export function expandToSentence(words: TWord[], startWord: number, endWord: number): { startWord: number; endWord: number } {
  let s = startWord;
  while (s > 0 && !SENTENCE_END.test(words[s - 1].text)) s--;
  let e = endWord;
  while (e < words.length - 1 && !SENTENCE_END.test(words[e].text)) e++;
  return { startWord: s, endWord: e };
}
