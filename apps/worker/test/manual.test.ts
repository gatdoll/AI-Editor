import assert from "node:assert/strict";
import { applyManualEdl, extendLimits, ManualSchema, manualSegments, normalizeManual, restoreRange, snapTime, transformAt } from "@app/shared/manual";
import { buildEdl } from "@app/shared/edl";
import { buildEditedProps, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { planEffects } from "../src/prompt/effects.ts";

const base = buildEdl(20, [{ start: 3, end: 5 }], 0);
const manual = normalizeManual({ cuts: [{ start: 10, end: 12 }], splits: [8, 8, 15] });
assert.deepEqual(applyManualEdl(base, manual, 20).segments, [{ start: 0, end: 3 }, { start: 5, end: 8 }, { start: 8, end: 10 }, { start: 12, end: 15 }, { start: 15, end: 20 }]);
assert.equal(applyManualEdl(base, manual, 20).keptS, 16);
assert.deepEqual(manualSegments([{ start: 0, end: 10 }], { cuts: [{ start: 2, end: 7 }, { start: 4, end: 9 }] }), [{ start: 0, end: 2 }, { start: 9, end: 10 }]);
assert.equal(ManualSchema.safeParse({ cuts: [{ start: 5, end: 4 }] }).success, false);
assert.equal(ManualSchema.safeParse({ splits: [Infinity] }).success, false);
const a = { time: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
const b = { time: 2, x: 20, y: -10, scale: 2, rotation: 90, opacity: 0.5 };
assert.equal(transformAt([a, b], 1).scale, 1.5);
assert.equal(transformAt([a, b], 1).x, 10);
assert.equal(transformAt([a, b], 10).rotation, 90);
assert.equal(transformAt([a, b], -10).scale, 1);
assert.equal(snapTime(1.08, 30, [1]), 1);
assert.equal(snapTime(1.08, 30, [1], false), 32 / 30);
// Split alone must not change camera, title lifetime, speech pages or audio joins.
const style = normalizeStyle({ manual, titles: [{ text: "Across split", startS: 6, endS: 10, animation: "kinetik", position: "atas" }], params: { "audio.volume": 0.4, "video.skala": 1.5 } });
const args = { source: { width: 1920, height: 1080, durationS: 20, fps: 30 }, words: [{ text: "testing", start: 6, end: 7 }], style, seed: 1 };
const one = buildEditedProps({ ...args, segments: [{ start: 0, end: 20 }] });
const split = buildEditedProps({ ...args, segments: [{ start: 0, end: 8 }, { start: 8, end: 20 }] });
assert.deepEqual(one, split);
const acrossCut = buildEditedProps({ ...args, segments: [{ start: 0, end: 7 }, { start: 9, end: 20 }] });
assert.equal(acrossCut.props.titles?.[0].startS, 6);
assert.equal(acrossCut.props.titles?.[0].endS, 8, "title midpoint inside a cut must not drop the whole title");
assert.equal(split.props.videoEdit?.volume, 0.4);
assert.equal(split.props.videoEdit?.transform.scale, 1.5);
// New AI style commands retain manual decisions and keyframes.
const changed = await planEffects([{ type: "set_style", styleId: "motion" }, { type: "set_param", paramId: "audio.volume", value: "0.7" }], { durationS: 20, words: [], style, existing: [], getSilences: async () => [] });
assert.deepEqual(changed.style?.manual, manual);
assert.equal(changed.style?.params["audio.volume"], 0.7);
assert.equal(changed.suggestions.length, 0);
// Deterministic stress: overlap and order never duplicate source frames.
for (let seed = 1; seed <= 100; seed++) {
  const cuts = Array.from({ length: 8 }, (_, i) => { const start = ((seed * 31 + i * 7) % 190) / 10; return { start, end: Math.min(20, start + 0.8) }; });
  const out = applyManualEdl(base, { cuts, splits: [1, 6, 9, 16] }, 20);
  assert.ok(Math.abs(out.keptS + out.removedS - 20) < 1e-7);
  out.segments.forEach((s, i) => { assert.ok(s.end > s.start); if (i) assert.ok(s.start >= out.segments[i - 1].end); });
}
// ---- Fase 10: perpanjang klip ke bagian terpotong (keeps)
// AI memotong 3–5. Memulihkan 4–5 memperpanjang klip kedua ke kiri; memulihkan seluruh celah menyatukan klip.
assert.deepEqual(manualSegments(base.segments, { keeps: [{ start: 4, end: 5 }] }), [{ start: 0, end: 3 }, { start: 4, end: 20 }]);
assert.deepEqual(manualSegments(base.segments, { keeps: [{ start: 3, end: 5 }] }), [{ start: 0, end: 20 }]);
// Cut manual diterapkan sesudah keeps, jadi cut yang dibuat setelahnya tetap memotong
assert.deepEqual(manualSegments(base.segments, { keeps: [{ start: 3, end: 5 }], cuts: [{ start: 3.5, end: 4 }] }), [{ start: 0, end: 3.5 }, { start: 4, end: 20 }]);
// restoreRange: menambah keeps dan membuang cut manual yang tumpang tindih (memulihkan trim sendiri juga)
const trimmed = normalizeManual({ cuts: [{ start: 10, end: 12 }] });
const restored = restoreRange(trimmed, { start: 11, end: 12 })!;
assert.deepEqual(restored.cuts, [{ start: 10, end: 11 }]);
assert.deepEqual(applyManualEdl(base, restored, 20).segments, [{ start: 0, end: 3 }, { start: 5, end: 10 }, { start: 11, end: 20 }]);
assert.deepEqual(restoreRange(restored, { start: 10, end: 11 })!.cuts, [], "trim dipulihkan seluruhnya");
assert.deepEqual(normalizeManual({ keeps: [{ start: 4, end: 5 }, { start: 3, end: 4.5 }] }).keeps, [{ start: 3, end: 5 }], "keeps dirapikan");
assert.deepEqual(normalizeManual({ cuts: [] }).keeps, [], "gaya lama tanpa keeps tetap sah");
// Batas perpanjangan: sampai tepi klip tetangga, tidak melewati
const segs = [{ start: 0, end: 3 }, { start: 5, end: 10 }, { start: 12, end: 20 }];
assert.deepEqual(extendLimits(segs, segs[1], 20), { minStart: 3, maxEnd: 12 });
assert.deepEqual(extendLimits(segs, segs[0], 20), { minStart: 0, maxEnd: 5 });
assert.deepEqual(extendLimits([{ start: 2, end: 8 }], { start: 2, end: 8 }, 10), { minStart: 0, maxEnd: 10 }, "awal dan akhir video yang terpotong bisa dipulihkan");
assert.deepEqual(extendLimits([{ start: 0, end: 4 }, { start: 4, end: 9 }], { start: 4, end: 9 }, 10), { minStart: 4, maxEnd: 10 }, "split tidak punya celah");
// Stres: keeps + cuts acak tidak pernah menggandakan atau membalik frame sumber
for (let seed = 1; seed <= 100; seed++) {
  const keeps = Array.from({ length: 4 }, (_, i) => { const start = ((seed * 17 + i * 11) % 190) / 10; return { start, end: Math.min(20, start + 1.3) }; });
  const cuts = Array.from({ length: 4 }, (_, i) => { const start = ((seed * 29 + i * 5) % 190) / 10; return { start, end: Math.min(20, start + 0.6) }; });
  const out = applyManualEdl(base, { keeps, cuts, splits: [2, 7] }, 20);
  assert.ok(Math.abs(out.keptS + out.removedS - 20) < 1e-7);
  out.segments.forEach((s, i) => { assert.ok(s.end > s.start); if (i) assert.ok(s.start >= out.segments[i - 1].end); });
}
console.log("manual.test: cuts, splits, keeps (perpanjang ke bagian terpotong), frame preservation, shared render props, keyframes and AI coexistence passed");
