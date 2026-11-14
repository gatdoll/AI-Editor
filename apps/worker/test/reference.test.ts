import assert from "node:assert/strict";
import { referenceUrl, referenceSampleTimes, ReferenceInput } from "@app/shared/reference";
import { referenceDir, loadReference, saveReference } from "@app/shared/reference-store";
import { visualStyleOps } from "../src/prompt/reference-analysis.ts";
import { buildOpsPrompt } from "../src/prompt/translate.ts";
import { normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { planEffects } from "../src/prompt/effects.ts";
import { rm } from "node:fs/promises";

assert.equal(referenceUrl("https://youtu.be/jNQXAC9IVRw?si=secret").url, "https://www.youtube.com/watch?v=jNQXAC9IVRw");
assert.equal(referenceUrl("https://www.youtube.com/shorts/jNQXAC9IVRw?feature=share").platform, "YouTube");
assert.equal(referenceUrl("https://www.instagram.com/reels/ABCD_123/?igsh=token").url, "https://www.instagram.com/reel/ABCD_123/");
assert.equal(referenceUrl("https://www.tiktok.com/@demo/video/123456789?is_from_webapp=1").url, "https://www.tiktok.com/@demo/video/123456789");
assert.equal(referenceUrl("https://vt.tiktok.com/ZTEST123/").platform, "TikTok");
for (const bad of ["http://127.0.0.1/video", "https://localhost/video", "https://youtube.com.evil.test/watch?v=jNQXAC9IVRw", "https://user:pw@youtube.com/watch?v=jNQXAC9IVRw", "file:///etc/passwd", "https://youtube.com:8443/watch?v=jNQXAC9IVRw", "https://www.youtube.com/playlist?list=test", "https://www.instagram.com/account/", "https://www.tiktok.com/@demo", "https://www.youtube.com/redirect?q=http://localhost"]) assert.throws(() => referenceUrl(bad));
assert.equal(ReferenceInput.safeParse({ kind: "upload", id: "../../file" }).success, false);
assert.throws(() => referenceDir("../other", crypto.randomUUID()));
for (const [duration, start] of [[1, 0], [18, 0], [600, 45], [20, 19.99]]) {
  const times = referenceSampleTimes(duration, start);
  assert.ok(times.length > 0 && times.length <= 16);
  assert.ok(times.every((t, i) => t >= start && t < duration && t <= start + 30 && (i === 0 || t >= times[i - 1])));
}
assert.throws(() => referenceSampleTimes(15, 15));
assert.throws(() => referenceSampleTimes(Infinity, 0));

const report = { summary: "Teks kapital lime dan panel bergerak.", confident: true, limitations: ["Audio tidak dianalisis."], styleId: "motion", camera: true, captions: true, effects: null, settings: [
  { paramId: "teks.animasi", value: "blur-slide" }, { paramId: "warna.aksen", value: "#B6F500" },
  { paramId: "render", value: "true" }, { paramId: "__proto__", value: "evil" },
  { paramId: "kamera.pola", value: "sinematik" },
] };
const parsed = visualStyleOps(report);
assert.ok(parsed.ops.every((o) => ["set_style", "set_param"].includes(o.type)), "Reference cannot create cuts, titles, renders or arbitrary operations");
assert.equal(parsed.ops.length, 4);
assert.equal(parsed.limitations.length, 3);
// Sampel kurang jelas: pengaturan yang tetap disebut (terlihat jelas) diterapkan, dengan catatan; tanpa pengaturan = tidak ada yang diterapkan
const unsure = visualStyleOps({ ...report, confident: false });
assert.equal(unsure.ops.length, 4);
assert.ok(unsure.limitations.some((l) => l.includes("Sampel kurang jelas")));
const empty = visualStyleOps({ ...report, confident: false, styleId: null, camera: null, captions: null, settings: [] });
assert.deepEqual(empty.ops, []);
assert.ok(empty.limitations.some((l) => l.includes("Tidak ada gaya referensi")));
const original = normalizeStyle({ aspect: "9:16", cameraOverrides: [{ startS: 2, endS: 4, preset: "pan" }], titles: [{ text: "KEEP", startS: 0, endS: 2, animation: "kinetik", position: "atas" }] });
const fx = await planEffects(parsed.ops, { words: [], durationS: 25, style: original, existing: [], getSilences: async () => [] });
assert.deepEqual(fx.suggestions, []); assert.deepEqual(fx.wordFixes, []); assert.equal(fx.render, null);
assert.equal(fx.style?.aspect, "9:16"); assert.deepEqual(fx.style?.titles, original.titles); assert.deepEqual(fx.style?.cameraOverrides, original.cameraOverrides);
const prompt = buildOpsPrompt("ikuti referensi", { referenceApplied: true, durationS: 25, wordCount: 0, pending: 0, approved: 0, style: { ...original, cameraOverrides: 1 } });
assert.ok(prompt.includes("jangan menimpa dengan preset generik"));

const projectId = crypto.randomUUID(), refId = crypto.randomUUID();
try {
  await saveReference({ id: refId, projectId, kind: "upload", label: "clip.mp4", file: "source.mp4", size: 100 });
  assert.equal((await loadReference(projectId, refId)).label, "clip.mp4");
  await assert.rejects(loadReference(crypto.randomUUID(), refId), "Attachment cannot be read under another project");
} finally { await rm(referenceDir(projectId, refId), { recursive: true, force: true }); }
console.log("reference.test: canonical social URLs, private/invalid URL rejection, bounded temporal samples, isolated storage and style-only reference operations passed");
