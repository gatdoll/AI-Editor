// Subtitle sebagai klip mandiri (Fase 10). Murni, aman di browser dan Node.
// Waktu dalam detik VIDEO MENTAH (sama dengan cut, judul, kamera), sehingga subtitle tetap menempel pada ucapan
// walaupun cut berubah. Tiap klip menyimpan kata + waktunya untuk sorotan kata aktif.
import { MANUAL } from "@app/config";
import { z } from "zod";

const C = MANUAL.subtitles;
const Time = z.number().finite().min(0).max(86400);
const WordSchema = z.object({ text: z.string().min(1).max(C.maxChars), start: Time, end: Time });
export const SubtitleClipSchema = z.object({
  id: z.string().min(1).max(32),
  start: Time,
  end: Time,
  words: z.array(WordSchema).min(1).max(C.maxWords),
}).refine((c) => c.end > c.start, "akhir subtitle harus setelah awal");
export const SubtitlesSchema = z.object({ clips: z.array(SubtitleClipSchema).max(C.maxClips) });

export type SubWord = z.infer<typeof WordSchema>;
export type SubtitleClip = z.infer<typeof SubtitleClipSchema>;
export type Subtitles = z.infer<typeof SubtitlesSchema>;

/** Data tidak sah = undefined (subtitle otomatis), bukan dibuang sebagian diam-diam. Klip diurutkan dan dijaga tidak tumpang tindih. */
export function normalizeSubtitles(raw: unknown): Subtitles | undefined {
  if (raw == null) return undefined;
  const parsed = SubtitlesSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const clips = [...parsed.data.clips].sort((a, b) => a.start - b.start);
  for (let i = 0; i < clips.length - 1; i++) if (clips[i].end > clips[i + 1].start) clips[i] = { ...clips[i], end: clips[i + 1].start };
  return { clips: clips.filter((c) => c.end - c.start > 1e-6) };
}

/**
 * Koreksi kata transkrip ikut ke subtitle yang sudah dibekukan. Dicocokkan dengan teks lama + waktu terdekat (waktu kata
 * beku bisa sedikit bergeser oleh perbaikan waktu Whisper). Kata yang sudah diubah pengguna di subtitle tidak tersentuh.
 */
export function applyWordFixes(subs: Subtitles | undefined, fixes: Array<{ start: number; end: number; before: string; after: string }>): Subtitles | undefined {
  if (!subs || !fixes.length) return subs;
  let changed = false;
  const clips = subs.clips.map((c) => {
    let words = c.words;
    for (const f of fixes) {
      const mid = (f.start + f.end) / 2;
      let best = -1, dist = 0.5;
      words.forEach((w, i) => { const d = Math.abs((w.start + w.end) / 2 - mid); if (w.text === f.before && d < dist) { best = i; dist = d; } });
      if (best >= 0 && f.after.trim()) { words = words.map((w, i) => (i === best ? { ...w, text: f.after.trim() } : w)); changed = true; }
    }
    return words === c.words ? c : { ...c, words };
  });
  return changed ? { clips } : subs;
}

export const clipText =(c: SubtitleClip) => c.words.map((w) => w.text).join(" ");

function nextId(clips: SubtitleClip[]): string {
  const n = clips.reduce((m, c) => Math.max(m, Number(/^s(\d+)$/.exec(c.id)?.[1] ?? -1)), -1);
  return `s${n + 1}`;
}

/** Waktu kata dijepit ke dalam klip (setiap kata tetap punya durasi). */
function clampWords(words: SubWord[], start: number, end: number): SubWord[] {
  const min = Math.min(0.02, (end - start) / Math.max(1, words.length));
  return words.map((w) => {
    const s = Math.min(Math.max(w.start, start), end - min);
    return { ...w, start: s, end: Math.max(s + min, Math.min(Math.max(w.end, start), end)) };
  });
}

export type SubResult = { ok: true; clips: SubtitleClip[] } | { ok: false; error: string };
const fail = (error: string): SubResult => ({ ok: false, error });

/**
 * Ganti teks klip. Jumlah kata sama = waktu tiap kata dipertahankan (koreksi typo). Berbeda = waktu dibagi rata di
 * rentang ucapan lama, karena kata baru tidak punya waktu dari transkrip.
 */
/**
 * `kept` = segmen yang dipertahankan (waktu mentah). Bila jumlah kata berubah, kata baru dibagi rata menurut waktu yang
 * TERLIHAT di dalam klip, jadi tidak ada kata yang jatuh di bagian terpotong (sebelumnya kata tengah bisa hilang dari hasil).
 */
export function setClipText(clips: SubtitleClip[], id: string, text: string, visible: (w: SubWord) => boolean = () => true, kept?: Array<{ start: number; end: number }>): SubResult {
  const c = clips.find((x) => x.id === id);
  if (!c) return fail("Subtitle tidak ditemukan");
  const parts = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!parts.length) return fail("Teks kosong. Untuk membuang subtitle ini, pakai Hapus.");
  // Kata yang sedang terpotong (tidak terlihat) tidak ikut diedit dan tetap disimpan untuk saat dipulihkan
  const shown = c.words.filter(visible);
  let hidden = c.words.filter((w) => !visible(w));
  if (!shown.length) return fail("Subtitle ini sedang terpotong seluruhnya.");
  // Batas berlaku untuk teks yang diketik. Kata tersembunyi yang membuat klip melewati batas dibuang dari klip ini
  // (tidak pernah tampil di hasil; bila bagian itu dipulihkan, bagian itu tanpa subtitle dari klip ini).
  const fits = (ws: string[]) => ws.length <= C.maxWords && ws.join(" ").length <= C.maxChars;
  if (!fits(parts)) return fail(`Subtitle maksimal ${C.maxWords} kata / ${C.maxChars} karakter. Pecah dulu jadi dua.`);
  if (!fits([...parts, ...hidden.map((w) => w.text)])) hidden = [];
  let next: SubWord[];
  if (parts.length === shown.length) next = shown.map((w, i) => ({ ...w, text: parts[i] }));
  else {
    const a = shown[0].start, b = shown[shown.length - 1].end;
    const pieces = (kept ?? []).map((k) => ({ start: Math.max(a, k.start), end: Math.min(b, k.end) })).filter((p) => p.end - p.start > 1e-6).sort((x, y) => x.start - y.start);
    const total = pieces.reduce((n, p) => n + p.end - p.start, 0);
    if (pieces.length > 1 && total > 0) {
      // Waktu terlihat digabung -> tiap kata mendapat bagian sama, dipetakan kembali ke potongan yang memuat titik tengahnya
      const step = total / parts.length;
      next = parts.map((t, i) => {
        const cs = i * step, ce = (i + 1) * step, mid = (cs + ce) / 2;
        let acc = 0, p = pieces[pieces.length - 1], at = total - (p.end - p.start);
        for (const q of pieces) { const len = q.end - q.start; if (mid < acc + len) { p = q; at = acc; break; } acc += len; }
        const len = p.end - p.start;
        const start = p.start + Math.max(0, cs - at), end = p.start + Math.min(len, ce - at);
        return { text: t, start, end: Math.max(end, Math.min(p.end, start + 0.02)) };
      });
    } else {
      const span = Math.max(b - a, 0.05 * parts.length), step = span / parts.length;
      next = clampWords(parts.map((t, i) => ({ text: t, start: a + i * step, end: a + (i + 1) * step })), c.start, c.end);
    }
  }
  const words = [...next, ...hidden].sort((x, y) => x.start - y.start);
  return { ok: true, clips: clips.map((x) => (x.id === id ? { ...x, words } : x)) };
}

export function removeClip(clips: SubtitleClip[], id: string): SubResult {
  if (!clips.some((x) => x.id === id)) return fail("Subtitle tidak ditemukan");
  return { ok: true, clips: clips.filter((x) => x.id !== id) };
}

/** Batas geser/trim: tidak boleh menimpa klip tetangga dan tidak keluar dari video. */
export function clipLimits(clips: SubtitleClip[], id: string, duration: number): { min: number; max: number } {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const i = sorted.findIndex((x) => x.id === id);
  return { min: i > 0 ? sorted[i - 1].end : 0, max: i >= 0 && i < sorted.length - 1 ? sorted[i + 1].start : duration };
}

/** Trim (ubah tepi) klip. Kata yang keluar rentang dijepit ke tepi, teks tidak berubah. */
export function setClipRange(clips: SubtitleClip[], id: string, start: number, end: number, duration: number): SubResult {
  const c = clips.find((x) => x.id === id);
  if (!c) return fail("Subtitle tidak ditemukan");
  const lim = clipLimits(clips, id, duration);
  const a = Math.max(lim.min, start), b = Math.min(lim.max, end);
  if (b - a < C.minSec) return fail(`Subtitle minimal ${C.minSec} detik dan tidak boleh menimpa subtitle lain.`);
  return { ok: true, clips: clips.map((x) => (x.id === id ? { ...x, start: a, end: b, words: clampWords(x.words, a, b) } : x)) };
}

/** Geser klip utuh (teks dan waktu kata ikut). Berhenti di tetangga. */
export function moveClip(clips: SubtitleClip[], id: string, delta: number, duration: number): SubResult {
  const c = clips.find((x) => x.id === id);
  if (!c) return fail("Subtitle tidak ditemukan");
  const lim = clipLimits(clips, id, duration);
  const d = Math.min(Math.max(delta, lim.min - c.start), lim.max - c.end);
  const shift = (t: number) => t + d;
  return { ok: true, clips: clips.map((x) => (x.id === id ? { ...x, start: shift(x.start), end: shift(x.end), words: x.words.map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) })) } : x)) };
}

/** Pecah klip di waktu t: kata yang titik tengahnya sebelum t ke kiri. Kedua sisi harus punya kata. */
export function splitClip(clips: SubtitleClip[], id: string, t: number): SubResult {
  const c = clips.find((x) => x.id === id);
  if (!c) return fail("Subtitle tidak ditemukan");
  if (t - c.start < C.minSec || c.end - t < C.minSec) return fail("Letakkan playhead di tengah subtitle untuk memecahnya.");
  const left = c.words.filter((w) => (w.start + w.end) / 2 < t), right = c.words.filter((w) => (w.start + w.end) / 2 >= t);
  if (!left.length || !right.length) return fail("Tidak ada kata di salah satu sisi playhead. Geser playhead ke antara dua kata.");
  const second: SubtitleClip = { id: nextId(clips), start: t, end: c.end, words: clampWords(right, t, c.end) };
  if (clips.length + 1 > C.maxClips) return fail("Batas jumlah subtitle tercapai.");
  return { ok: true, clips: clips.flatMap((x) => (x.id === id ? [{ ...x, end: t, words: clampWords(left, x.start, t) }, second] : [x])) };
}

/** Gabung klip dengan klip sesudahnya. Celah di antaranya ikut tertutup. */
export function mergeWithNext(clips: SubtitleClip[], id: string): SubResult {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const i = sorted.findIndex((x) => x.id === id);
  if (i < 0) return fail("Subtitle tidak ditemukan");
  const a = sorted[i], b = sorted[i + 1];
  if (!b) return fail("Tidak ada subtitle sesudahnya untuk digabung.");
  const words = [...a.words, ...b.words];
  if (words.length > C.maxWords || words.map((w) => w.text).join(" ").length > C.maxChars) return fail(`Hasil gabungan melebihi ${C.maxWords} kata / ${C.maxChars} karakter.`);
  return { ok: true, clips: sorted.flatMap((x, k) => (k === i ? [{ ...a, end: b.end, words }] : k === i + 1 ? [] : [x])) };
}

/**
 * Tambah subtitle buatan sendiri (Fase 12) mulai dari `at`, sepanjang `len` detik, tanpa menimpa klip lain
 * (dipendekkan sampai klip berikutnya). Waktu kata dibagi rata karena tidak berasal dari transkrip.
 */
export function addClip(clips: SubtitleClip[], at: number, len: number, text: string, duration: number): SubResult {
  const parts = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!parts.length) return fail("Teks subtitle kosong.");
  if (parts.length > C.maxWords || parts.join(" ").length > C.maxChars) return fail(`Subtitle maksimal ${C.maxWords} kata / ${C.maxChars} karakter.`);
  if (clips.length + 1 > C.maxClips) return fail("Batas jumlah subtitle tercapai.");
  if (clips.some((c) => at >= c.start && at < c.end)) return fail("Di posisi playhead sudah ada subtitle. Geser playhead ke bagian kosong, atau edit subtitle itu.");
  const next = clips.filter((c) => c.start > at).sort((a, b) => a.start - b.start)[0];
  const start = Math.max(0, at), end = Math.min(duration, next ? next.start : Infinity, start + len);
  if (end - start < C.minSec) return fail("Tidak ada ruang di posisi ini: subtitle berikutnya terlalu dekat.");
  const step = (end - start) / parts.length;
  const clip: SubtitleClip = { id: nextId(clips), start, end, words: parts.map((t, i) => ({ text: t, start: start + i * step, end: start + (i + 1) * step })) };
  return { ok: true, clips: [...clips, clip].sort((a, b) => a.start - b.start) };
}
