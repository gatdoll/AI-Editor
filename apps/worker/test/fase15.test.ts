// Fase 15: gambar/logo di prompt Kreatif. Peran logo (file samping, tanpa migrasi), aset untuk kode AI (video dan motion),
// props komposisi Edited, pemeriksaan "logo digambar ulang", dan kontrak. Jalankan: node apps/worker/test/fase15.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { STYLES } from "../../../config/index.ts";
import { defaultRole, loadRoles, roleOf, setRole } from "../../../packages/shared/src/material-roles.ts";
import { buildMotionProps, materialAssets, type MaterialInfo } from "../../../packages/remotion/src/motion-props.ts";
import { buildEditedProps, DEFAULT_STYLE } from "../../../packages/remotion/src/build-props.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import type { CreativeData } from "../../../packages/remotion/src/creative/contract.ts";
import { logoErrors } from "../src/creative/loop.ts";

// ---- peran: bawaan dari nama berkas, pilihan pengguna di roles.json
assert.equal(defaultRole("Logo-Mantiq.png"), "logo");
assert.equal(defaultRole("foto produk.jpg"), "gambar");
assert.equal(defaultRole(null), "gambar");
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "fase15-"));
  const prev = process.env.MEDIA_DIR;
  process.env.MEDIA_DIR = tmp;
  try {
    const pid = "00000000-0000-4000-8000-000000000001";
    assert.deepEqual(loadRoles(pid), {}, "belum ada pilihan");
    await setRole(pid, "a", "logo");
    await setRole(pid, "b", "gambar");
    assert.deepEqual(loadRoles(pid), { a: "logo", b: "gambar" });
    assert.equal(roleOf(loadRoles(pid), { id: "b", label: "logo-b.png" }), "gambar", "pilihan pengguna menang atas nama berkas");
    assert.equal(roleOf(loadRoles(pid), { id: "c", label: "logo-c.png" }), "logo");
    await setRole(pid, "a", null);
    assert.deepEqual(loadRoles(pid), { b: "gambar" }, "hapus pilihan");
    assert.ok(readFileSync(path.join(tmp, "projects", pid, "materials", "roles.json"), "utf8").includes("gambar"), "file samping di folder bahan project");
  } finally {
    if (prev === undefined) delete process.env.MEDIA_DIR; else process.env.MEDIA_DIR = prev;
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- aset untuk kode AI
const mats: MaterialInfo[] = [
  { id: "logo1", label: "logo.png", mime: "image/png", width: 800, height: 200, role: "logo" },
  { id: "foto", label: "produk.jpg", mime: "image/jpeg", width: 1000, height: 1000, role: "gambar" },
  { id: "musik", label: "lagu.mp3", mime: "audio/mpeg", duration_s: 30, role: "logo" },
  { id: "doc", label: "brief.pdf", mime: "application/pdf" },
];
{
  const all = materialAssets(mats, (id) => `/a/${id}`);
  assert.deepEqual(all.map((a) => a.id), ["logo1", "foto", "musik"], "knowledge tidak jadi aset");
  assert.equal(all.find((a) => a.id === "musik")!.role, undefined, "peran hanya untuk gambar");
  const imgs = materialAssets(mats, (id) => `/a/${id}`, (m) => `assets/${m.id}`, { imagesOnly: true });
  assert.deepEqual(imgs.map((a) => [a.id, a.role, a.src, a.file, a.width]), [["logo1", "logo", "/a/logo1", "assets/logo1", 800], ["foto", "gambar", "/a/foto", "assets/foto", 1000]]);
  const motion = buildMotionProps({ aspect: "16:9", settings: { durationS: 4 }, colors: STYLES.bersih.colors, materials: mats, srcFor: (id) => id });
  assert.equal(motion.assets.find((a) => a.id === "logo1")!.role, "logo", "motion ikut membawa peran");
}

// ---- Edited: aset ikut lapisan kreatif saja
{
  const base = { segments: [{ start: 0, end: 3 }], source: { width: 1920, height: 1080, fps: 30, durationS: 3 }, words: [{ text: "halo", start: 0.2, end: 0.6 }], style: DEFAULT_STYLE, seed: 1 };
  const creativeAssets = materialAssets(mats, (id) => `/api/assets/${id}/file`, undefined, { imagesOnly: true });
  const withCode = buildEditedProps({ ...base, creative: { overlay: "export default () => null", replacesCaptions: false }, creativeAssets });
  assert.deepEqual(withCode.props.creative?.assets?.map((a) => a.id), ["logo1", "foto"]);
  assert.equal(buildEditedProps({ ...base, creativeAssets }).props.creative, undefined, "tanpa kode kreatif tidak ada lapisan");
  assert.equal(buildEditedProps({ ...base, creative: { overlay: "x", replacesCaptions: false } }).props.creative?.assets, undefined, "tanpa lampiran = tanpa aset");
}

// ---- logo digambar ulang -> dikembalikan ke AI
{
  const data = { assets: materialAssets(mats, () => "", undefined, { imagesOnly: true }) } as CreativeData;
  const drawn = { overlay: "export default () => <svg><circle/></svg>", notes: "", replacesCaptions: false };
  const used = { overlay: "export default ({ data }) => <Img src={data.assets.find((a) => a.role === 'logo').src} />", notes: "", replacesCaptions: false };
  assert.match(logoErrors("taruh logo di pojok kanan atas", drawn, data)[0], /logo\.png/);
  assert.deepEqual(logoErrors("taruh logo di pojok kanan atas", used, data), []);
  assert.deepEqual(logoErrors("judul besar di awal", drawn, data), [], "prompt tanpa logo tidak diperiksa");
  assert.deepEqual(logoErrors("pakai logo", drawn, { assets: data.assets!.filter((a) => a.role !== "logo") } as CreativeData), [], "tanpa lampiran logo tidak diperiksa");
}

// ---- kontrak
{
  const video = buildContract();
  assert.match(video, /## Gambar dan logo pengguna/);
  assert.match(video, /JANGAN menggambar ulang logo/);
  assert.match(video, /role\?: "logo" \| "gambar"/);
  const motion = buildContract({ motion: true });
  assert.match(motion, /LOGO ASLI/);
  assert.doesNotMatch(motion, /## Gambar dan logo pengguna/, "motion memakai bagian bahannya sendiri");
}

console.log("fase15: semua tes lolos");
