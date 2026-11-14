import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { FFMPEG } from "../src/media.ts";
import { extractReferenceFrames } from "../src/prompt/reference.ts";
import { GRAIN_PNG } from "../../../packages/remotion/src/grain-data.ts";

const cache = path.resolve(".cache");
const dir = path.join(cache, `reference-media-test-${crypto.randomUUID()}`);
await mkdir(dir, { recursive: true });
try {
  const file = path.join(dir, "reference.mp4");
  const fixture = path.join(dir, "fixture.png");
  await writeFile(fixture, Buffer.from(GRAIN_PNG.split(",")[1], "base64"));
  // Limited-range YUV at 15fps + audio longer than video reproduces the real YouTube failure.
  const r = spawnSync(FFMPEG, ["-y", "-v", "error", "-loop", "1", "-framerate", "15", "-t", "2", "-i", fixture, "-f", "lavfi", "-i", "sine=frequency=440:duration=2.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file], { windowsHide: true, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const result = await extractReferenceFrames(file, path.join(dir, "frames"), 0);
  assert.equal(result.images.length, 16);
  assert.equal(result.sampledSeconds, 2, "Sampling must follow video duration, not longer audio");
  for (const image of result.images) assert.ok((await stat(image)).size > 0);
  const bad = path.join(dir, "bad.mp4");
  await writeFile(bad, "not a video");
  await assert.rejects(extractReferenceFrames(bad, path.join(dir, "bad-frames"), 0));
  await assert.rejects(extractReferenceFrames(file, path.join(dir, "late-frames"), 10));
} finally {
  const relative = path.relative(cache, path.resolve(dir));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  await rm(dir, { recursive: true, force: true });
}
console.log("reference-media.test: 16 PNG frames from 15fps YUV, audio/video duration mismatch, invalid video and out-of-range time passed");
