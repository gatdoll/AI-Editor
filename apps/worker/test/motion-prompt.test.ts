import assert from "node:assert/strict";
import { CAMERA_PATTERNS, LIMITS } from "@app/config";
import { normalizeOps } from "@app/shared/ops";
import { planEffects } from "../src/prompt/effects.ts";
import { buildOpsPrompt } from "../src/prompt/translate.ts";
import { buildEditedProps, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { cameraStateAt, isCovered } from "../../../packages/remotion/src/camera-plan.ts";
import { blurSlideProgress, spatialMotionAt } from "../../../packages/remotion/src/motion-plan.ts";
import { titleScale } from "../../../packages/remotion/src/title-plan.ts";

// Reproduce the user's long brief: camera and film controls used to be discarded after #12.
const requested = {
  "teks.animasi": "kinetik", "teks.kataPerHalaman": "3", "teks.hurufBesar": "true", "teks.tebal": "true",
  "teks.ukuran": "1.2", "warna.teks": "#FFF4E0", "warna.aksen": "#B6F500", "teks.redup": "0.35",
  "motion.bingkai": "true", "motion.kekuatan": "1.1", "motion.jeda": "5", "kamera.energi": "energik",
  "kamera.kekuatanZoom": "1.3", "kamera.zoomMaks": "1.2", "kamera.gerakanMin": "2", "kamera.gerakanMaks": "4",
  "efek.vinyet": "0.15", "efek.grain": "0", "motion.ruang": "orbit", "kamera.pola": "sinematik",
};
const flat = [{ type: "set_style", styleId: "motion" }, ...Object.entries(requested).map(([paramId, value]) => ({ type: "set_param", paramId, value }))];
const normalized = normalizeOps(flat);
assert.equal(normalized.ops.length, 21);
assert.deepEqual(normalized.rejected, []);
const words = Array.from({ length: 120 }, (_, i) => ({ text: `kata${i}`, start: i * 0.4, end: i * 0.4 + 0.3, confidence: 1 }));
const context = { durationS: 48, words, style: normalizeStyle({ aspect: "9:16" }), existing: [], getSilences: async () => [] };
const effects = await planEffects(normalized.ops, context);
assert.ok(effects.style);
assert.equal(effects.style.aspect, "9:16");
for (const [id, value] of Object.entries(requested)) assert.equal(String(effects.style.params[id]), value, `${id} must reach the final style`);
assert.deepEqual(effects.suggestions, []);

const segments = [{ start: 0, end: 20 }, { start: 24, end: 48 }];
for (const aspect of ["16:9", "9:16"] as const) for (const pattern of Object.keys(CAMERA_PATTERNS)) {
  const style = normalizeStyle({ ...effects.style, aspect, params: { ...effects.style.params, "kamera.pola": pattern } });
  const built = buildEditedProps({ segments, words, style, seed: 7, source: { width: 1920, height: 1080, durationS: 48, fps: 30 } });
  assert.equal(built.durationInFrames, 44 * 30);
  assert.deepEqual(built.cameraErrors, [], `${aspect}/${pattern}`);
  for (let f = 0; f < built.durationInFrames; f += 3) {
    const state = cameraStateAt(built.props.camera, f / 30);
    assert.ok(state.scale <= 1.2 + 1e-9);
    assert.ok(isCovered(state, built.props.width, built.props.height));
  }
  const scene = built.props.motion!.scenes[0];
  const spatial = spatialMotionAt(built.props.motion, scene.start + 1);
  assert.ok(Math.abs(spatial.rotX) + Math.abs(spatial.rotY) > 0);
  assert.equal(spatialMotionAt(built.props.motion, scene.end).amount, 0);
}

const titleOps = normalizeOps([
  { type: "add_title", text: "IDE JADI GERAK", startS: 26, endS: 30, animation: "blur-slide", position: "tengah" },
  { type: "camera_at", startS: 2, endS: 5, preset: "pan" },
  { type: "camera_at", startS: 6, endS: 9, preset: "pull-back" },
]);
assert.deepEqual(titleOps.rejected, []);
const titles = await planEffects(titleOps.ops, context);
assert.equal(titles.style?.titles?.[0].text, "IDE JADI GERAK");
assert.equal(titles.style?.cameraOverrides[0].preset, "pan");
const rendered = buildEditedProps({ segments, words, style: titles.style!, seed: 5, source: { width: 1920, height: 1080, durationS: 48, fps: 30 } });
assert.equal(rendered.props.titles?.[0].startS, 22, "Title timing follows approved cut mapping");
assert.deepEqual(titles.suggestions, []);
const repeated = await planEffects(titleOps.ops, { ...context, style: titles.style! });
assert.equal(repeated.style, null, "Repeated request must not duplicate overlays/overrides");
const clear = await planEffects([{ type: "clear_titles" }], { ...context, style: titles.style! });
assert.deepEqual(clear.style?.titles, []);
assert.equal(clear.style?.cameraOverrides.length, 2);
assert.equal(normalizeOps([{ type: "add_title", text: "a", startS: 5, endS: 4, animation: "blur-slide", position: "atas" }]).ops.length, 0);
assert.equal(blurSlideProgress(-0.1), 0);
assert.ok(blurSlideProgress(0.1) > 0 && blurSlideProgress(0.1) < 1);
assert.equal(blurSlideProgress(1), 1);
for (const [aspect, width, height] of [["16:9", 1920, 1080], ["9:16", 1080, 1920]] as const) {
  const short = titleScale("IDE JADI GERAK", width, height, aspect);
  const long = titleScale("W".repeat(120), width, height, aspect);
  assert.ok(long > 0 && long < short, "Long title must shrink within the title area");
}
const prompt = buildOpsPrompt("buat motion", { durationS: 48, wordCount: 120, style: { ...context.style, cameraOverrides: 0 }, pending: 0, approved: 0 });
assert.ok(prompt.includes(String(LIMITS.promptOperations)) && prompt.includes("camera_at") && prompt.includes("motion.ruang") && prompt.includes("blur-slide"));
console.log("motion-prompt.test: full 21-operation brief, 8 camera plans, timed camera/title, deduplication and cut mapping passed");
