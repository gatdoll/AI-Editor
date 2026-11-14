// Fase 10.1: subtitle sebagai klip mandiri (bekukan, edit, susun halaman) dan rentang lapisan kreatif.
import assert from "node:assert/strict";
import { addClip, applyWordFixes, mergeWithNext, moveClip, normalizeSubtitles, removeClip, setClipRange, setClipText, splitClip, clipLimits, clipText, type SubtitleClip } from "../../../packages/shared/src/subtitles.ts";
import { autoSubtitleClips, buildEditedProps, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { SAMPLE_OVERLAY } from "../../../packages/remotion/src/creative/sample.ts";

const ok = <T,>(r: { ok: true; clips: T } | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r.clips; };
const w = (text: string, start: number, end: number) => ({ text, start, end });
const clips: SubtitleClip[] = [
  { id: "s0", start: 0.9, end: 2.2, words: [w("halo", 1, 1.4), w("semua", 1.5, 2)] },
  { id: "s1", start: 3, end: 5, words: [w("apa", 3.1, 3.4), w("kabar", 3.5, 4), w("kalian", 4.1, 4.8)] },
];

// ---- edit teks: jumlah kata sama = waktu dipertahankan (typo); berbeda = dibagi rata di rentang ucapan
const typo = ok(setClipText(clips, "s0", "Halo  semuanya"));
assert.deepEqual(typo[0].words.map((x) => [x.text, x.start, x.end]), [["Halo", 1, 1.4], ["semuanya", 1.5, 2]]);
const more = ok(setClipText(clips, "s0", "halo teman teman semua"))[0];
assert.equal(more.words.length, 4);
assert.ok(more.words.every((x, i) => x.end > x.start && x.start >= more.start && x.end <= more.end && (i === 0 || x.start >= more.words[i - 1].start)));
assert.equal(setClipText(clips, "s0", "   ").ok, false, "teks kosong ditolak, bukan klip tanpa kata");
assert.equal(clipText(clips[1]), "apa kabar kalian");
// Kata yang sedang terpotong tidak ikut diedit dan tetap ada untuk saat dipulihkan
const hiddenEdit = ok(setClipText(clips, "s1", "APA KALIAN", (x) => x.text !== "kabar"))[1];
assert.deepEqual(hiddenEdit.words.map((x) => x.text), ["APA", "kabar", "KALIAN"]);
// Bug 31 Okt: klip melintasi bagian terpotong, jumlah kata berubah -> kata baru harus jatuh di bagian yang terlihat
{
  const kept = [{ start: 0, end: 2 }, { start: 8, end: 10 }];
  const vis = (x: { start: number; end: number }) => { const m = (x.start + x.end) / 2; return kept.some((k) => m >= k.start && m < k.end); };
  const across: SubtitleClip[] = [{ id: "x", start: 1, end: 9.5, words: [
    { text: "dan", start: 1.2, end: 1.6 }, { text: "potong1", start: 3, end: 3.5 }, { text: "potong2", start: 5, end: 5.5 }, { text: "279", start: 8.5, end: 9 },
  ] }];
  const w = ok(setClipText(across, "x", "dan ini totalnya 279", vis, kept))[0].words;
  assert.deepEqual(w.filter(vis).map((x) => x.text), ["dan", "ini", "totalnya", "279"], "semua kata baru terlihat");
  assert.deepEqual(w.filter((x) => !vis(x)).map((x) => x.text), ["potong1", "potong2"], "kata di bagian terpotong tetap disimpan");
  for (const x of w) assert.ok(x.end > x.start && x.start >= 1 && x.end <= 9.5, `waktu kata sah ${JSON.stringify(x)}`);
  const visTexts = w.filter(vis).sort((p, q) => p.start - q.start).map((x) => x.text);
  assert.deepEqual(visTexts, ["dan", "ini", "totalnya", "279"], "urutan kata terjaga");
  assert.ok(ok(setClipText(across, "x", "dan ini totalnya 279", vis))[0].words.filter(vis).length < 4, "tanpa segmen = perilaku lama: sebagian kata hilang (bug ini)");
  // Bug 31 Okt (2): 34 kata tersembunyi + teks baru melewati batas -> edit tetap tersimpan, kata tersembunyi dibuang
  const many: SubtitleClip[] = [{ id: "y", start: 1, end: 9.5, words: [
    { text: "dan", start: 1.2, end: 1.6 },
    ...Array.from({ length: 34 }, (_, i) => ({ text: `kata-panjang-terpotong${i}`, start: 2.1 + i * 0.15, end: 2.2 + i * 0.15 })),
    { text: "279", start: 8.5, end: 9 },
  ] }];
  const r = setClipText(many, "y", "dan ini totalnya 279", vis, kept);
  assert.ok(r.ok, "edit tidak ditolak karena kata yang tidak terlihat");
  assert.deepEqual(ok(r)[0].words.map((x) => x.text), ["dan", "ini", "totalnya", "279"]);
  assert.ok(normalizeSubtitles({ clips: ok(r) }), "hasil lolos skema simpan");
  assert.equal(setClipText(many, "y", Array.from({ length: 41 }, () => "a").join(" "), vis, kept).ok, false, "teks yang diketik tetap dibatasi");
}

// ---- hapus, trim, geser: tidak pernah menimpa tetangga
assert.deepEqual(ok(removeClip(clips, "s0")).map((c) => c.id), ["s1"]);
assert.deepEqual(clipLimits(clips, "s1", 10), { min: 2.2, max: 10 });
const trimmed = ok(setClipRange(clips, "s1", 1, 4.5, 10))[1];
assert.deepEqual([trimmed.start, trimmed.end], [2.2, 4.5], "trim ke kiri berhenti di subtitle sebelumnya");
assert.ok(trimmed.words.every((x) => x.start >= 2.2 && x.end <= 4.5), "waktu kata dijepit ke rentang baru");
assert.equal(setClipRange(clips, "s1", 3, 3.05, 10).ok, false, "terlalu pendek ditolak");
const moved = ok(moveClip(clips, "s1", -5, 10))[1];
assert.deepEqual([moved.start, moved.end], [2.2, 4.2], "geser berhenti di tetangga");
assert.ok(Math.abs(moved.words[0].start - 2.3) < 1e-9, "kata ikut bergeser");

// ---- split dan gabung
const split = ok(splitClip(clips, "s1", 3.45));
assert.deepEqual(split.map((c) => [c.id, c.start, c.end, clipText(c)]), [["s0", 0.9, 2.2, "halo semua"], ["s1", 3, 3.45, "apa"], ["s2", 3.45, 5, "kabar kalian"]]);
assert.equal(splitClip(clips, "s1", 3.05).ok, false, "di tepi ditolak");
assert.equal(splitClip(clips, "s1", 4.9).ok, false, "sisi tanpa kata ditolak");
const merged = ok(mergeWithNext(split, "s1"));
assert.deepEqual(merged.map((c) => [c.start, c.end, clipText(c)]), [[0.9, 2.2, "halo semua"], [3, 5, "apa kabar kalian"]]);
assert.equal(mergeWithNext(clips, "s1").ok, false, "tidak ada sesudahnya");

// ---- subtitle buatan sendiri (Fase 12): tanpa transkrip, tidak menimpa klip lain
const added = ok(addClip(clips, 2.5, 2, "teks saya sendiri", 10));
assert.deepEqual(added.map((c) => [c.start, c.end, clipText(c)]), [[0.9, 2.2, "halo semua"], [2.5, 3, "teks saya sendiri"], [3, 5, "apa kabar kalian"]], "dipendekkan sampai klip berikutnya");
assert.equal(addClip(clips, 1, 2, "x", 10).ok, false, "di atas klip yang ada ditolak");
assert.equal(addClip([], 0, 2, "  ", 10).ok, false);
assert.deepEqual(ok(addClip([], 9.5, 2, "akhir", 10)).map((c) => [c.start, c.end]), [[9.5, 10]], "tidak melewati durasi");

// ---- normalisasi: tidak sah = subtitle otomatis; tumpang tindih dipangkas
assert.equal(normalizeSubtitles({ clips: [{ id: "x", start: 2, end: 1, words: [w("a", 1, 2)] }] }), undefined);
assert.equal(normalizeSubtitles(null), undefined);
assert.equal(normalizeSubtitles({ clips: [{ ...clips[0], end: 3.5 }, clips[1]] })!.clips[0].end, 3);
assert.equal("subtitles" in normalizeStyle({}), false, "project lama tidak berubah");
assert.equal("creativeRanges" in normalizeStyle({}), false);

// ---- bekukan: apa yang tampil = apa yang dibekukan; kata di bagian terpotong tetap dapat klip
const words = "Halo semua selamat datang. Hari ini kita akan membahas cara mengedit video dengan cepat dan mudah sekali ya.".split(" ")
  .map((x, i) => w(x, 0.5 + i * 0.42, 0.5 + i * 0.42 + 0.35));
const source = { width: 1920, height: 1080, fps: 30, durationS: 10 };
const segments = [{ start: 0, end: 3.2 }, { start: 4.4, end: 10 }];
const style = normalizeStyle({ aspect: "9:16" });
const auto = buildEditedProps({ segments, source, words, style, seed: 1 });
const frozen = autoSubtitleClips({ segments, source, words, style });
assert.deepEqual(frozen.flatMap((c) => c.words.map((x) => x.text)), words.map((x) => x.text), "setiap kata tepat sekali, termasuk yang terpotong");
frozen.forEach((c, i) => { assert.ok(c.end > c.start); if (i) assert.ok(c.start >= frozen[i - 1].end - 1e-9, "tidak tumpang tindih"); });
const viaClips = buildEditedProps({ segments, source, words, style: normalizeStyle({ ...style, subtitles: { clips: frozen } }), seed: 1 });
const shape = (pages: typeof auto.props.pages) => pages.map((p) => p.tokens.map((t) => t.text.trim()).join(" "));
assert.deepEqual(shape(viaClips.props.pages), shape(auto.props.pages), "pengelompokan sama dengan subtitle otomatis");
viaClips.props.pages.forEach((p, i) => {
  assert.ok(Math.abs(p.start - auto.props.pages[i].start) < 0.05 && Math.abs(p.end - auto.props.pages[i].end) < 0.05, `waktu halaman ${i} sama`);
});
// Edit teks muncul di pratinjau/render; memulihkan bagian terpotong memunculkan subtitle-nya
const edited = ok(setClipText(frozen, frozen[0].id, "HALO SEMUA"));
const ep = buildEditedProps({ segments, source, words, style: normalizeStyle({ ...style, subtitles: { clips: edited } }), seed: 1 });
assert.equal(ep.props.pages[0].tokens.map((t) => t.text.trim()).join(" "), "HALO SEMUA");
const restored = buildEditedProps({ segments: [{ start: 0, end: 10 }], source, words, style: normalizeStyle({ ...style, subtitles: { clips: frozen } }), seed: 1 });
assert.equal(shape(restored.props.pages).join(" "), words.map((x) => x.text).join(" "), "semua kata tampil saat cut dipulihkan");
// Subtitle dihapus = hilang dari props
const removed = buildEditedProps({ segments, source, words, style: normalizeStyle({ ...style, subtitles: { clips: ok(removeClip(frozen, frozen[0].id)) } }), seed: 1 });
assert.equal(removed.props.pages.length, auto.props.pages.length - 1);

// ---- koreksi transkrip ikut ke subtitle beku (waktu terdekat + teks lama); kata yang sudah diubah pengguna aman
const fixed = applyWordFixes({ clips }, [{ start: 3.52, end: 3.98, before: "kabar", after: "kabarnya" }])!;
assert.equal(clipText(fixed.clips[1]), "apa kabarnya kalian");
const userEdited = { clips: ok(setClipText(clips, "s1", "apa KABAR kalian")) };
assert.equal(applyWordFixes(userEdited, [{ start: 3.5, end: 4, before: "kabar", after: "kabarnya" }]), userEdited, "tidak menimpa edit pengguna");
assert.equal(applyWordFixes(undefined, [{ start: 3.5, end: 4, before: "kabar", after: "x" }]), undefined);

// ---- rentang lapisan kreatif (detik mentah -> hasil); subtitle bawaan kembali di luar rentang bila digantikan
const creative = { overlay: SAMPLE_OVERLAY, replacesCaptions: true };
const all = buildEditedProps({ segments, source, words, style, seed: 1, creative });
assert.deepEqual(all.props.creative!.ranges, [{ start: 0, end: all.durationInFrames / 30 }], "bawaan: seluruh video");
assert.equal(all.props.pages.length, 0, "digantikan di seluruh video");
const part = buildEditedProps({ segments, source, words, style: normalizeStyle({ ...style, creativeRanges: [{ start: 5, end: 7 }] }), seed: 1, creative });
assert.ok(Math.abs(part.props.creative!.ranges![0].start - 3.8) < 0.04 && Math.abs(part.props.creative!.ranges![0].end - 5.8) < 0.04, "dipetakan melewati cut");
assert.ok(part.props.pages.length > 0 && part.props.pages.every((p) => p.end <= 3.8 + 1e-6 || p.start >= 5.8 - 1e-6), "subtitle bawaan hanya di luar rentang kreatif");
const none = buildEditedProps({ segments, source, words, style: normalizeStyle({ ...style, creativeRanges: [] }), seed: 1, creative });
assert.deepEqual(none.props.creative!.ranges, []);
assert.equal(shape(none.props.pages).join(" "), shape(auto.props.pages).join(" "), "kreatif dimatikan di semua bagian = subtitle bawaan utuh");
assert.deepEqual(normalizeStyle({ creativeRanges: [{ start: 2, end: 3 }, { start: 2.5, end: 4 }, { start: 5, end: 4 } as never] }).creativeRanges, [{ start: 2, end: 4 }]);

console.log("subtitles.test: klip subtitle (teks/hapus/trim/geser/split/gabung), bekukan = sama dengan otomatis, kata terpotong tetap punya klip, rentang kreatif + subtitle bawaan kembali passed");
