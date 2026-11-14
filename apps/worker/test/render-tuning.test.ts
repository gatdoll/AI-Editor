import assert from "node:assert/strict";
import { VIDEO } from "@app/config";
import { renderTuning } from "../src/render-tuning.ts";

const GB = 1024 ** 3;
const { minBytes, maxBytes } = VIDEO.renderCache;

assert.equal(renderTuning({ freeBytes: 2.8 * GB }).offthreadVideoCacheSizeInBytes, minBytes, "RAM bebas sedikit: batas bawah");
assert.equal(renderTuning({ freeBytes: 8 * GB }).offthreadVideoCacheSizeInBytes, 4 * GB, "separuh RAM bebas");
assert.equal(renderTuning({ freeBytes: 64 * GB }).offthreadVideoCacheSizeInBytes, maxBytes, "batas atas");

assert.equal("concurrency" in renderTuning({ freeBytes: 8 * GB }), false, "percobaan pertama: bawaan Remotion");
assert.equal(renderTuning({ freeBytes: 8 * GB, envConcurrency: "6" }).concurrency, 6, "RENDER_CONCURRENCY dihormati");
assert.equal(renderTuning({ freeBytes: 8 * GB, retry: true }).concurrency, VIDEO.retryConcurrency, "percobaan ulang lebih rendah");
assert.equal(renderTuning({ freeBytes: 8 * GB, retry: true, envConcurrency: "6" }).concurrency, VIDEO.retryConcurrency, "percobaan ulang tidak naik karena env");
assert.equal(renderTuning({ freeBytes: 8 * GB, retry: true, envConcurrency: "1" }).concurrency, 1, "env lebih rendah tetap menang");

console.log("render-tuning.test: cache frame dibatasi, concurrency percobaan ulang");
