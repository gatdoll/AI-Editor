// Explicit disposable project only: node apps/worker/test/manual-api.e2e.mjs PROJECT_UUID
import assert from "node:assert/strict";
import fs from "node:fs";
const id = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) throw new Error("Pass a disposable test project UUID");
const url = `http://localhost:3000/api/projects/${id}`;
const detail = await (await fetch(url)).json();
const original = detail.project.style;
const suggestions = await (await fetch(url + "/suggestions")).json();
const put = async (style, baseStyle) => { const r = await fetch(url + "/style", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ style, baseStyle }) }); return { status: r.status, body: await r.json() }; };
let lastSaved = original;
try {
  const manual = { cuts: [{ start: 15, end: 16 }], splits: [7], keyframes: [{ time: 5, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, { time: 9, x: 5, y: -3, scale: 1.2, rotation: 2, opacity: 1 }] };
  const saved = await put({ ...original, manual }, original);
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); lastSaved = saved.body.style;
  assert.deepEqual((await (await fetch(url)).json()).project.style.manual, manual);
  assert.equal((await put({ ...original, camera: false }, original)).status, 409, "stale writer rejected");
  assert.equal((await put({ ...lastSaved, manual: { ...manual, cuts: [{ start: 10, end: 2 }] } }, lastSaved)).status, 400);
  assert.equal((await put({ ...lastSaved, manual: { ...manual, splits: [99999] } }, lastSaved)).status, 400);
  assert.equal((await put({ ...lastSaved, manual: { ...manual, cuts: [{ start: 0, end: Number(detail.asset.duration_s) }] } }, lastSaved)).status, 400);
  const edlResponse = await fetch(url + "/edl", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  assert.equal(edlResponse.status, 201);
  const edl = (await edlResponse.json()).edl;
  assert.ok(edl.segments.every((s) => s.end <= 15 || s.start >= 16));
  assert.ok(edl.segments.some((s) => s.end === 7));
  assert.deepEqual(edl.params.style.manual, manual);
  assert.deepEqual((await (await fetch(url + "/suggestions")).json()).suggestions, suggestions.suggestions, "AI decisions unchanged");
  fs.writeFileSync(".cache/manual-api-result.json", JSON.stringify({ id, edlVersion: edl.version, status: "passed", checks: ["save", "reload", "conflict", "invalid bounds", "empty cut guard", "EDL", "AI decisions unchanged"] }));
  console.log("manual-api.e2e: persisted edits, stale writer rejection, bounds, EDL and AI decisions passed");
} finally {
  const restored = await put(original, lastSaved);
  assert.equal(restored.status, 200, "Do not overwrite concurrent changes during test restore");
  await fetch(url + "/edl", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
}
