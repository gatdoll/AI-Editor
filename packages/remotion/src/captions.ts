// Logika subtitle murni (tanpa React). Timing berasal dari transkrip Whisper, bukan tebakan,
// dan dipetakan ulang ke timeline HASIL mengikuti EDL (kata yang dipotong tidak ikut).
import type { Caption } from "@remotion/captions";
import { SUBTITLE, type AspectId } from "@app/config";
import { toFrameSegments, type TimeSegment } from "./frames.ts";

export type SrcWord = { text: string; start: number; end: number };
export type TimelineWord = { text: string; start: number; end: number };

export type Highlight = "aksen" | "slam";
export type CaptionToken = Caption & { hl?: Highlight };

export type CaptionPage = {
  /** Detik pada timeline hasil. */
  start: number;
  end: number;
  /** Token dalam format @remotion/captions (milidetik pada timeline hasil). hl = kata kunci yang disorot. */
  tokens: CaptionToken[];
  /** Indeks token tempat baris baru dimulai (selalu dimulai dengan 0). */
  lineStarts: number[];
};

/**
 * whisper.cpp kadang "memeras" sebuah kata menjadi hampir nol detik sementara kata sebelumnya
 * melar menelan jeda (mis. "videos" 1,26 dtk lalu "quickly." 0,05 dtk). Kata yang terlalu pendek untuk
 * panjang hurufnya diberi waktu layak dengan meminjam dari ujung kata sebelumnya (hanya bila ada kelebihan).
 * Ini heuristik: BUKAN pengganti forced alignment. Mengembalikan salinan.
 */
export function repairWordTimes(words: SrcWord[]): SrcWord[] {
  const out = words.map((w) => ({ ...w }));
  const need = (w: SrcWord) => Math.max(0.08, 0.04 * w.text.replace(/[^\p{L}\p{N}]/gu, "").length);
  for (let i = 1; i < out.length; i++) {
    const w = out[i];
    const p = out[i - 1];
    const dur = w.end - w.start;
    const want = need(w);
    if (dur >= want * 0.5) continue;
    const deficit = want - dur;
    const surplus = p.end - p.start - need(p);
    if (surplus <= 0 || Math.abs(p.end - w.start) > 0.05) continue; // hanya bila bersambung langsung
    const take = Math.min(deficit, surplus);
    p.end -= take;
    w.start -= take;
  }
  return out;
}

/**
 * Petakan kata sumber ke timeline hasil memakai pembulatan frame yang SAMA dengan komposisi,
 * supaya subtitle tidak bergeser dari suara. Kata yang titik tengahnya berada di bagian
 * yang dipotong dibuang; kata di tepi segmen dipangkas ke segmen.
 */
export function mapWordsToTimeline(
  words: SrcWord[],
  segments: TimeSegment[],
  fps: number,
  sourceSeconds: number,
): TimelineWord[] {
  const frames = toFrameSegments(segments, fps, sourceSeconds);
  const out: TimelineWord[] = [];
  for (const w of repairWordTimes(words)) {
    const mid = (w.start + w.end) / 2;
    const seg = frames.find((s) => mid >= s.srcFrom / fps && mid < s.srcTo / fps);
    if (!seg) continue;
    const segStart = seg.srcFrom / fps;
    const segEnd = seg.srcTo / fps;
    const base = seg.at / fps;
    const start = base + (Math.max(w.start, segStart) - segStart);
    const end = base + (Math.min(w.end, segEnd) - segStart);
    out.push({ text: w.text, start, end: Math.max(end, start + 0.02) });
  }
  // Fase 16: urutan video bisa diubah, jadi urutan kata sumber tidak selalu sama dengan urutan tampil
  return out.sort((a, b) => a.start - b.start);
}

const SENTENCE_END = /[.!?…]["')\]]*$/;

/** Titik waktu (timeline hasil) di akhir kalimat atau sebelum jeda panjang: tempat alami ganti gerakan kamera. */
export function sentenceEndsOf(words: TimelineWord[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    if (SENTENCE_END.test(words[i].text) || (next && next.start - words[i].end > 0.5)) out.push(words[i].end);
  }
  return out;
}

/** Waktu sambungan cut pada timeline hasil: awal tiap segmen kecuali yang pertama. */
export function joinTimes(segments: TimeSegment[], fps: number, sourceSeconds: number): number[] {
  return toFrameSegments(segments, fps, sourceSeconds)
    .slice(1)
    .map((s) => s.at / fps);
}

export type PageOptions = {
  /** Maksimal kata per halaman (mis. 3 untuk animasi "pendek"). Tanpa ini hanya dibatasi baris dan jeda. */
  maxWords?: number;
  /** Maksimal baris per halaman (bawaan SUBTITLE.maxLines). */
  maxLines?: number;
  /** Teks lebih besar: kurangi karakter per baris sebesar faktor ini (>= 1). */
  fontScale?: number;
  aspect: AspectId;
  /** Teks huruf besar lebih lebar: kurangi karakter per baris. */
  uppercase: boolean;
  /** Klip subtitle buatan pengguna: jangan pecah di jeda/kalimat/durasi, hanya bila baris penuh atau maxWords. */
  keepTogether?: boolean;
};

/**
 * Susun halaman subtitle: maksimal `maxLines` baris, tiap baris <= maxChars (kecuali satu kata sangat panjang).
 * Halaman baru bila: baris penuh, ada jeda panjang, halaman terlalu lama, atau kalimat selesai (jika sudah >= 3 kata).
 */
export function buildPages(words: TimelineWord[], opt: PageOptions): CaptionPage[] {
  const maxLines = Math.max(1, opt.maxLines ?? SUBTITLE.maxLines);
  const maxChars = Math.max(8, Math.floor((SUBTITLE.maxCharsPerLine[opt.aspect] * (opt.uppercase ? 0.88 : 1)) / Math.max(1, opt.fontScale ?? 1)));
  type Draft = { words: TimelineWord[]; lineStarts: number[]; lineLen: number };
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  const fresh = (): Draft => ({ words: [], lineStarts: [0], lineLen: 0 });

  const closePage = () => {
    if (cur && cur.words.length) drafts.push(cur);
    cur = null;
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = words[i - 1];
    if (cur) {
      const pause = prev ? w.start - prev.end : 0;
      const pageSpan = w.end - cur.words[0].start;
      const endedSentence = prev && SENTENCE_END.test(prev.text) && cur.words.length >= 3;
      const full = opt.maxWords != null && cur.words.length >= opt.maxWords;
      if ((!opt.keepTogether && (pause > SUBTITLE.maxPauseSec || pageSpan > SUBTITLE.maxPageSec || endedSentence)) || full) closePage();
    }
    if (!cur) cur = fresh();

    const len = w.text.length;
    const sep = cur.lineLen === 0 ? 0 : 1;
    if (cur.lineLen + sep + len > maxChars && cur.lineLen > 0) {
      // baris penuh: baris baru, atau halaman baru bila sudah di baris terakhir
      if (cur.lineStarts.length >= maxLines) {
        closePage();
        cur = fresh();
      } else {
        cur.lineStarts.push(cur.words.length);
        cur.lineLen = 0;
      }
    }
    cur.lineLen += (cur.lineLen === 0 ? 0 : 1) + len;
    cur.words.push(w);
  }
  closePage();

  // Hindari halaman berisi satu kata saja: gabungkan ke halaman sebelumnya bila muat.
  for (let i = 1; i < drafts.length; i++) {
    const d = drafts[i];
    const p = drafts[i - 1];
    if (d.words.length !== 1) continue;
    const gap = d.words[0].start - p.words[p.words.length - 1].end;
    if (gap > SUBTITLE.maxPauseSec) continue;
    const lastLineLen = p.words.slice(p.lineStarts[p.lineStarts.length - 1]).reduce((n, w, k) => n + w.text.length + (k ? 1 : 0), 0);
    if (lastLineLen + 1 + d.words[0].text.length <= maxChars) {
      p.words.push(d.words[0]);
      drafts.splice(i, 1);
      i--;
    } else if (p.lineStarts.length < maxLines) {
      p.lineStarts.push(p.words.length);
      p.words.push(d.words[0]);
      drafts.splice(i, 1);
      i--;
    }
  }

  const pages: CaptionPage[] = drafts.map((d) => {
    const tokens: Caption[] = d.words.map((w, k) => ({
      text: (k === 0 || d.lineStarts.includes(k) ? "" : " ") + w.text,
      startMs: Math.round(w.start * 1000),
      endMs: Math.round(w.end * 1000),
      timestampMs: Math.round(((w.start + w.end) / 2) * 1000),
      confidence: null,
    }));
    return {
      start: Math.max(0, d.words[0].start - SUBTITLE.leadSec),
      end: d.words[d.words.length - 1].end + SUBTITLE.lingerSec,
      tokens,
      lineStarts: d.lineStarts,
    };
  });

  // Halaman tidak boleh saling tumpang tindih
  for (let i = 0; i < pages.length - 1; i++) {
    if (pages[i].end > pages[i + 1].start) pages[i].end = Math.max(pages[i].start + 0.05, pages[i + 1].start);
  }
  return pages;
}

/** Baris-baris halaman sebagai kumpulan token. */
export function pageLines(page: CaptionPage): Caption[][] {
  return page.lineStarts.map((s, i) => page.tokens.slice(s, page.lineStarts[i + 1] ?? page.tokens.length));
}

/** Halaman yang aktif pada waktu t (detik), atau null. */
export function pageAt(pages: CaptionPage[], t: number): CaptionPage | null {
  for (const p of pages) if (t >= p.start && t < p.end) return p;
  return null;
}

/** Indeks token aktif pada t: kata terakhir yang sudah mulai diucapkan (tetap aktif sampai kata berikutnya mulai). */
export function activeTokenIndex(page: CaptionPage, t: number): number {
  const ms = t * 1000;
  let idx = -1;
  for (let i = 0; i < page.tokens.length; i++) if (page.tokens[i].startMs <= ms) idx = i;
  return idx;
}
