// Fase 12: transkrip dari video yang sudah dipotong. Waktu pada audio gabungan dipetakan kembali ke video mentah.
import assert from "node:assert/strict";
import { concatToSource, coversSegments, mapWordsFromConcat, transcriptSegments } from "../../../packages/shared/src/transcript-segments.ts";

// Segmen dipertahankan: 2–5 dan 9–12 (bagian 5–9 = take salah yang dipotong). Split (bersentuhan) digabung.
const segs = transcriptSegments([{ start: 2, end: 4 }, { start: 4, end: 5 }, { start: 9, end: 12 }, { start: 13, end: 13.02 }]);
assert.deepEqual(segs, [{ start: 2, end: 5 }, { start: 9, end: 12 }], "split digabung, potongan sangat pendek dibuang");

assert.equal(concatToSource(0, segs), 2);
assert.equal(concatToSource(2.5, segs), 4.5);
assert.equal(concatToSource(3, segs), 9, "tepat di sambungan = awal segmen berikutnya");
assert.equal(concatToSource(4, segs), 10);
assert.equal(concatToSource(99, segs), 12, "di luar = akhir segmen terakhir");

// Kata Whisper (waktu gabungan) -> waktu mentah; kata yang melintasi sambungan dijepit ke segmen titik tengahnya
const words = mapWordsFromConcat([
  { text: "halo", start: 0.2, end: 0.6 },
  { text: "lintas", start: 2.8, end: 3.4 }, // tengah 3.1 -> segmen kedua
  { text: "akhir", start: 5.5, end: 5.9 },
], segs);
assert.deepEqual(words.map((w) => [w.text, +w.start.toFixed(3), +w.end.toFixed(3)]), [["halo", 2.2, 2.6], ["lintas", 9, 9.4], ["akhir", 11.5, 11.9]]);
assert.ok(words.every((w) => segs.some((s) => w.start >= s.start - 1e-9 && w.end <= s.end + 1e-9)), "tidak ada kata di bagian yang dipotong");

// Cakupan: transkrip lama (null) dianggap seluruh video; bagian yang dipulihkan sesudahnya terdeteksi
assert.equal(coversSegments(null, segs), true);
assert.equal(coversSegments(segs, [{ start: 2, end: 5 }]), true, "trim lebih banyak = tetap tercakup");
assert.equal(coversSegments(segs, [{ start: 2, end: 5.05 }, { start: 9, end: 12 }]), true, "selisih padding sambungan diabaikan");
assert.equal(coversSegments(segs, [{ start: 2, end: 12 }]), false, "take yang dipulihkan belum ditranskrip");

console.log("fase12.test: transkrip dari potongan (gabung segmen, peta waktu kembali ke video mentah, kata lintas sambungan, cakupan untuk perbarui transkrip) passed");
