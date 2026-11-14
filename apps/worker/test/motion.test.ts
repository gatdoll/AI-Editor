import assert from "node:assert/strict";
import { buildEditedProps, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { motionAt, wordMotion } from "../../../packages/remotion/src/motion-plan.ts";

// Exercise editorial invariants with cuts, missing speech, seeking, and both formats.
const words = Array.from({ length: 90 }, (_, i) => ({ text: i === 30 ? "pertanggungjawaban" : `kata${i}`, start: i * 0.4, end: i * 0.4 + 0.3 }));
const segments = [{ start: 0, end: 8 }, { start: 14, end: 36 }];
let cases = 0;
for (const aspect of ["16:9", "9:16"] as const) for (const fps of [24, 30, 60]) {
  const input = { segments, words, seed: 42, source: { width: 1920, height: 1080, durationS: 36, fps } };
  const baseline = buildEditedProps({ ...input, style: normalizeStyle({ aspect }) });
  const motion = buildEditedProps({ ...input, style: normalizeStyle({ aspect, styleId: "motion" }) });
  assert.equal(motion.durationInFrames, baseline.durationInFrames, "Motion must preserve approved edit duration");
  assert.deepEqual(motion.props.segments, segments, "Motion must preserve approved cuts");
  assert.deepEqual(motion.cameraErrors, []);
  assert.equal(motion.props.captionAnim, "kinetik");
  const design = motion.props.motion!;
  assert.ok(design.enabled && design.scenes.length > 1);
  assert.deepEqual(motion, buildEditedProps({ ...input, style: normalizeStyle({ aspect, styleId: "motion" }) }));
  for (const s of design.scenes) {
    assert.ok(s.start >= 0 && s.end <= motion.durationInFrames / fps);
    assert.equal(motionAt(design.scenes, s.start).amount, 0);
    assert.equal(motionAt(design.scenes, s.end).amount, 0);
    assert.equal(motionAt(design.scenes, (s.start + s.end) / 2).amount, 1);
  }
  const forward = Array.from({ length: motion.durationInFrames }, (_, f) => motionAt(design.scenes, f / fps));
  for (let f = forward.length - 1; f >= 0; f--) assert.deepEqual(motionAt(design.scenes, f / fps), forward[f], "Scrubbing must match linear playback");
  const captions = motion.props.pages.flatMap((p) => p.tokens);
  for (let i = 20; i < 35; i++) assert.ok(!captions.some((c) => c.text.trim().toUpperCase() === `KATA${i}`), "Words in removed footage must not appear");
  const disabled = buildEditedProps({ ...input, style: normalizeStyle({ aspect, styleId: "motion", params: { "motion.bingkai": false } }) });
  assert.equal(disabled.props.motion?.enabled, false);
  assert.deepEqual(disabled.props.motion?.scenes, []);
  const noCaptions = buildEditedProps({ ...input, style: normalizeStyle({ aspect, styleId: "motion", captions: false }) });
  assert.deepEqual(noCaptions.props.pages, []);
  assert.deepEqual(noCaptions.props.motion, design, "Hiding captions must not change framing");
  const silence = buildEditedProps({ ...input, words: [], style: normalizeStyle({ aspect, styleId: "motion" }) });
  assert.deepEqual(silence.props.motion?.scenes, []);
  cases++;
}
assert.equal(wordMotion(1.99, 2, 2.6, 3).opacity, 0, "Do not reveal words early");
assert.equal(wordMotion(2.6, 2, 2.6, 3).opacity, 1, "Do not fade before speech finishes");
assert.equal(wordMotion(3, 2, 2.6, 3).opacity, 0);
assert.equal(wordMotion(2.6, 2, 2.6, 2.6).opacity, 1, "No premature exit for a word at page end");
console.log(`motion.test: ${cases} format/fps combinations and speech timing passed`);
