// Folder sementara worker: di luar repo, TEMP diarahkan, pembersihan hanya nama yang dikenal dan yang sudah tua.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, existsSync, utimesSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "worker-tmp-test-"));
process.env.WORKER_TMP_DIR = root;
const { WORKER_TMP, cleanStaleTemp, reusableDir } = await import("../src/temp-dir.ts");
assert.equal(WORKER_TMP, path.resolve(root));
assert.equal(os.tmpdir(), path.resolve(root), "os.tmpdir() (dipakai Remotion) diarahkan");

const old = Date.now() - 10 * 3600_000;
const mk = (rel: string, mtime: number) => { const p = path.join(root, rel); mkdirSync(p, { recursive: true }); writeFileSync(path.join(p, "x"), "x"); utimesSync(p, mtime / 1000, mtime / 1000); return p; };
const staleAssets = mk("remotion-v4.0.539-assetsabc", old);
const staleBundle = mk("remotion-webpack-bundle-XYZ", old);
const freshAssets = mk("remotion-v4.0.539-assetsnew", Date.now());
const staleWork = mk("editing-video-creative/job1", old);
const foreign = mk("data-pengguna", old);
const r = cleanStaleTemp(6 * 3600_000);
assert.equal(r.removed, 3);
assert.ok(!existsSync(staleAssets) && !existsSync(staleBundle) && !existsSync(staleWork), "sisa lama dihapus");
assert.ok(existsSync(freshAssets), "render yang mungkin sedang berjalan tidak disentuh");
assert.ok(existsSync(foreign), "nama yang tidak dikenal tidak pernah dihapus");

// Bundel yang dipakai ulang: tidak ikut terhapus selama dipakai; bila tetap hilang dibuat ulang; build gagal bisa dicoba lagi
let builds = 0;
const getDir = reusableDir(async () => {
  builds++;
  const p = path.join(root, `remotion-webpack-bundle-${builds}`);
  mkdirSync(p, { recursive: true });
  writeFileSync(path.join(p, "index.html"), "x");
  return p;
}, "index.html");
const first = await getDir();
assert.equal(await getDir(), first);
assert.equal(builds, 1, "dibuat sekali");
utimesSync(first, old / 1000, old / 1000);
await getDir();
cleanStaleTemp(6 * 3600_000);
assert.ok(existsSync(first), "bundel yang masih dipakai tidak dianggap tua");
utimesSync(first, old / 1000, old / 1000);
cleanStaleTemp(6 * 3600_000);
assert.ok(!existsSync(first), "bundel menganggur dibersihkan");
const second = await getDir();
assert.notEqual(second, first);
assert.ok(existsSync(path.join(second, "index.html")), "bundel yang terhapus dibuat ulang, bukan menggagalkan render");
assert.equal(builds, 2);
let tries = 0;
const flaky = reusableDir(async () => { if (++tries === 1) throw new Error("gagal bundle"); return second; }, "index.html");
await assert.rejects(flaky(), /gagal bundle/);
assert.equal(await flaky(), second, "build gagal tidak diingat");

rmSync(root, { recursive: true, force: true });

// Tidak boleh diarahkan ke dalam repo (agen Claude akan membaca CLAUDE.md proyek)
const inside = await import("node:child_process").then(({ spawnSync }) =>
  spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(new URL("../src/temp-dir.ts", import.meta.url).href)})`], { env: { ...process.env, WORKER_TMP_DIR: path.resolve(import.meta.dirname, "../.cache/tmp") }, encoding: "utf8" }));
assert.notEqual(inside.status, 0);
assert.match(inside.stderr, /tidak boleh di dalam repo/);

console.log("temp-dir.test: TEMP diarahkan ke luar repo/drive sistem, pembersihan hanya sisa lama bernama dikenal, bundel dipakai ulang aman, folder di dalam repo ditolak passed");
