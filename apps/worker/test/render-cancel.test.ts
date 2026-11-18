// Pembatalan render: penjaga status job (tanpa DB, status disuntik). Jalankan: node apps/worker/test/render-cancel.test.ts
// Pembatalan render Remotion sungguhan: RENDER_CANCEL_E2E=1 node apps/worker/test/render-cancel.test.ts (butuh bundel, ±1 menit).
import assert from "node:assert/strict";
import { RENDER_CANCELLED, watchRenderCancel } from "../src/render-cancel.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- belum dibatalkan: sinyal diam
{
  const w = watchRenderCancel(null, "j", async () => false, 20);
  await sleep(70);
  assert.equal(w.cancelled(), false);
  assert.equal(await w.check(), false);
  w.stop();
}
// ---- dibatalkan di tengah: polling menangkapnya, pendengar cancelSignal terpanggil sekali
{
  let flag = false, heard = 0;
  const w = watchRenderCancel(null, "j", async () => flag, 20);
  w.cancelSignal(() => heard++);
  await sleep(50);
  assert.equal(heard, 0);
  flag = true;
  await sleep(80);
  assert.equal(w.cancelled(), true);
  assert.equal(heard, 1, "renderMedia dihentikan tepat sekali");
  w.stop();
}
// ---- DB sesaat error: tidak dianggap batal, tidak melempar
{
  const w = watchRenderCancel(null, "j", async () => { throw new Error("jaringan"); }, 20);
  assert.equal(await w.check(), false);
  w.stop();
}
// ---- check() langsung (sebelum mulai / sebelum hasil dicatat) tanpa menunggu polling
{
  const w = watchRenderCancel(null, "j", async () => true, 60_000);
  assert.equal(await w.check(), true);
  w.stop();
}
assert.match(RENDER_CANCELLED, /dibatalkan/);

if (process.env.RENDER_CANCEL_E2E) {
  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const os = await import("node:os"), path = await import("node:path"), { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serveUrl = await bundle({ entryPoint: path.resolve(here, "../../../packages/remotion/src/index.ts") });
  // Motion 30 detik: cukup panjang agar pembatalan pasti terjadi di tengah
  const composition = { ...(await selectComposition({ serveUrl, id: "Motion" })), durationInFrames: 900 };
  const dir = await mkdtemp(path.join(os.tmpdir(), "render-cancel-"));
  let flag = false, progress = 0;
  const w = watchRenderCancel(null, "j", async () => flag, 200);
  const t0 = Date.now();
  const run = renderMedia({ composition, serveUrl, codec: "h264", outputLocation: path.join(dir, "x.mp4"), cancelSignal: w.cancelSignal,
    onProgress: (p) => { progress = p.progress; if (p.progress > 0.05) flag = true; } });
  await assert.rejects(run, "render yang dibatalkan harus berhenti dengan error");
  w.stop();
  const s = (Date.now() - t0) / 1000;
  assert.ok(progress < 0.9, `berhenti di tengah (progres ${Math.round(progress * 100)}%)`);
  console.log(`render-cancel e2e: berhenti di ${Math.round(progress * 100)}% sesudah ${s.toFixed(1)} dtk; file ada: ${existsSync(path.join(dir, "x.mp4"))}`);
  await rm(dir, { recursive: true, force: true });
}

console.log("render-cancel.test: penjaga pembatalan (polling, sekali henti, DB error aman, cek langsung) passed");
