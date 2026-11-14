// Subtitle sebagai klip mandiri (Fase 10): membekukan subtitle otomatis menjadi klip, dan menyusun halaman dari klip.
// Klip disimpan dalam waktu video mentah; di sini dipetakan ke timeline hasil dengan rumus frame yang sama dengan
// subtitle otomatis, sehingga pratinjau dan render sama.
import { MANUAL } from "@app/config";
import { normalizeSubtitles, type SubtitleClip } from "../../shared/src/subtitles.ts";
import { buildPages, mapWordsToTimeline, repairWordTimes, type CaptionPage, type PageOptions, type SrcWord, type TimelineWord } from "./captions.ts";
import { toFrameSegments, type TimeSegment } from "./frames.ts";

/**
 * Rentang mentah -> timeline hasil. Rentang yang melintasi cut menjadi satu rentang dari potongan pertama sampai terakhir.
 * Fase 16: bila urutan video diubah, bagian-bagiannya bisa terpisah di hasil; dipakai bagian bersambung terpanjang.
 */
export function mapSpanToOutput(segments: TimeSegment[], fps: number, sourceSeconds: number, a: number, b: number): { start: number; end: number } | null {
  const pieces = toFrameSegments(segments, fps, sourceSeconds).flatMap((seg) => {
    const x = Math.max(a, seg.srcFrom / fps), y = Math.min(b, seg.srcTo / fps);
    return y > x ? [{ start: seg.at / fps + x - seg.srcFrom / fps, end: seg.at / fps + y - seg.srcFrom / fps }] : [];
  }).sort((p, q) => p.start - q.start);
  const runs: Array<{ start: number; end: number }> = [];
  for (const p of pieces) {
    const last = runs[runs.length - 1];
    if (last && p.start - last.end < 0.5 / fps) last.end = Math.max(last.end, p.end);
    else runs.push({ ...p });
  }
  return runs.reduce<{ start: number; end: number } | null>((best, r) => (!best || r.end - r.start > best.end - best.start + 1e-9 ? r : best), null);
}

/**
 * Bekukan subtitle otomatis yang sedang tampil menjadi klip (dipanggil pada edit subtitle pertama). Pengelompokan sama
 * dengan yang dilihat pengguna. Kata di bagian yang terpotong juga dibuatkan klip, agar tetap ada subtitle bila bagian
 * itu dipulihkan nanti.
 */
export function freezeSubtitleClips(a: { words: SrcWord[]; segments: TimeSegment[]; fps: number; sourceSeconds: number; options: PageOptions }): SubtitleClip[] {
  const frames = toFrameSegments(a.segments, a.fps, a.sourceSeconds);
  const kept: Array<{ src: SrcWord; out: TimelineWord; seg: number }> = [];
  // Kata terpotong, dikelompokkan per wilayah cut (tidak pernah satu klip melompati ucapan yang tampil)
  const cutRegions: SrcWord[][] = [];
  let lastWasCut = false;
  // Sama dengan mapWordsToTimeline, tetapi tetap tahu kata sumbernya
  for (const w of repairWordTimes(a.words)) {
    const mid = (w.start + w.end) / 2;
    const segIndex = frames.findIndex((s) => mid >= s.srcFrom / a.fps && mid < s.srcTo / a.fps);
    if (segIndex < 0) {
      if (!lastWasCut) cutRegions.push([]);
      cutRegions[cutRegions.length - 1].push(w);
      lastWasCut = true;
      continue;
    }
    lastWasCut = false;
    const seg = frames[segIndex];
    const segStart = seg.srcFrom / a.fps, segEnd = seg.srcTo / a.fps, base = seg.at / a.fps;
    const start = base + (Math.max(w.start, segStart) - segStart);
    kept.push({ src: w, seg: segIndex, out: { text: w.text, start, end: Math.max(base + (Math.min(w.end, segEnd) - segStart), start + 0.02) } });
  }
  // Fase 16: urutan tampil bisa berbeda dari urutan sumber (video ditukar); halaman disusun menurut waktu hasil
  kept.sort((x, y) => x.out.start - y.out.start);
  const maxWords = MANUAL.subtitles.maxWords;
  const word = (x: SrcWord) => ({ text: x.text, start: x.start, end: x.end });
  const clips: Omit<SubtitleClip, "id">[] = [];
  const absorbed = new Set<SrcWord>();
  let offset = 0;
  for (const page of buildPages(kept.map((k) => k.out), a.options)) {
    const group = kept.slice(offset, offset + page.tokens.length);
    offset += page.tokens.length;
    if (!group.length) continue;
    const first = group[0], last = group[group.length - 1];
    const start = Math.max(0, first.src.start - (first.out.start - page.start));
    const end = Math.min(a.sourceSeconds, last.src.end + (page.end - last.out.end));
    // Halaman yang melintasi sambungan cut mencakup kata yang terpotong di video mentah: kata itu masuk klip ini
    // (tersembunyi selama terpotong, muncul bila dipulihkan) agar klip tidak tumpang tindih.
    const inside = first.seg === last.seg ? [] : cutRegions.flat().filter((x) => x.start >= first.src.start && x.end <= last.src.end);
    if (group.length + inside.length <= maxWords) {
      inside.forEach((x) => absorbed.add(x));
      clips.push({ start, end, words: [...group.map((g) => word(g.src)), ...inside.map(word)].sort((x, y) => x.start - y.start) });
      continue;
    }
    // Terlalu banyak kata terpotong di tengah: pecah halaman di sambungan (satu klip per segmen)
    const runs = group.reduce<Array<typeof group>>((acc, g) => { const r = acc[acc.length - 1]; if (r && r[0].seg === g.seg) r.push(g); else acc.push([g]); return acc; }, []);
    runs.forEach((run, i) => clips.push({
      start: i === 0 ? start : run[0].src.start,
      end: i === runs.length - 1 ? end : run[run.length - 1].src.end,
      words: run.map((g) => word(g.src)),
    }));
  }
  for (const region of cutRegions) {
    const rest = region.filter((x) => !absorbed.has(x));
    let k = 0;
    for (const page of buildPages(rest, a.options)) {
      const group = rest.slice(k, k + page.tokens.length);
      k += page.tokens.length;
      if (group.length) clips.push({ start: group[0].start, end: group[group.length - 1].end, words: group.map(word) });
    }
  }
  const sorted = clips.sort((x, y) => x.start - y.start).map((c, i) => ({ id: `s${i}`, ...c }));
  return normalizeSubtitles({ clips: sorted })?.clips ?? [];
}

/** Halaman subtitle (timeline hasil) dari klip. Klip yang seluruhnya terpotong tidak tampil. */
export function clipPages(a: { clips: SubtitleClip[]; segments: TimeSegment[]; fps: number; sourceSeconds: number; options: PageOptions }): CaptionPage[] {
  const out: CaptionPage[] = [];
  for (const clip of a.clips) {
    const span = mapSpanToOutput(a.segments, a.fps, a.sourceSeconds, clip.start, clip.end);
    if (!span) continue;
    const tw = mapWordsToTimeline(clip.words, a.segments, a.fps, a.sourceSeconds);
    if (!tw.length) continue;
    const pages = buildPages(tw, { ...a.options, keepTogether: true });
    // Klip menentukan kapan teks tampil; pecahan karena baris penuh berganti tepat saat kata berikutnya mulai
    pages.forEach((p, i) => {
      p.start = i === 0 ? Math.min(span.start, p.tokens[0].startMs / 1000) : p.tokens[0].startMs / 1000;
      p.end = i === pages.length - 1 ? Math.max(span.end, p.start + 0.05) : pages[i + 1].tokens[0].startMs / 1000;
    });
    out.push(...pages);
  }
  out.sort((x, y) => x.start - y.start);
  for (let i = 0; i < out.length - 1; i++) if (out[i].end > out[i + 1].start) out[i].end = Math.max(out[i].start + 0.05, out[i + 1].start);
  return out;
}
