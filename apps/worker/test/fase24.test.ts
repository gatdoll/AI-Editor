// Fase 24: talent (teks di belakang talent, blur wajah, teks di depan wajah) dan font tambahan (pustaka + unggahan).
// Bagian murni + berkas sementara. Jalankan: node apps/worker/test/fase24.test.ts
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { coverBox, faceAt, parseFaces, type FaceSample } from "../../../packages/shared/src/talent.ts";
import { creativeFaces, DEFAULT_STYLE, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { compileCreative, creativeExport } from "../../../packages/remotion/src/creative/compile.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { talentInstruction } from "../src/creative/loop.ts";
import { fontInstruction, readChosenFonts } from "../src/creative/fonts.ts";
import { uploadedFamily, isFontFile, type FontRef } from "../../../packages/shared/src/font-library.ts";

// ---- kotak wajah: interpolasi antar sampel, celah tanpa wajah = null
const samples: FaceSample[] = [[0, 0.4, 0.3, 0.2, 0.2, 0.9], [0.2, 0.5, 0.3, 0.2, 0.2, 0.9], [0.4, null, null, null, null, 0], [2, 0.1, 0.1, 0.1, 0.1, 0.8]];
assert.deepEqual(faceAt(samples, 0.1), { x: 0.45, y: 0.3, w: 0.2, h: 0.2 }, "interpolasi linear");
assert.deepEqual(faceAt(samples, 0.25), { x: 0.5, y: 0.3, w: 0.2, h: 0.2 }, "sesudah sampel terakhir berwajah");
assert.equal(faceAt(samples, 1.2), null, "jauh dari sampel berwajah = tidak ditebak");
assert.equal(faceAt([], 1), null);
assert.equal(parseFaces({ version: 2 }), null);
assert.ok(parseFaces({ version: 1, fps: 30, width: 1080, height: 1920, frames: 1, every: 6, samples }));

// ---- objectFit cover + fokus: 16:9 sumber di kanvas 9:16 (fokus tengah)
const b = coverBox({ x: 0.5, y: 0.25, w: 0.1, h: 0.2 }, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }, 0.5, 0.5);
assert.ok(Math.abs(b.x - (1080 - 1920 * 1920 / 1080) / 2 - 0.5 * 1920 * 1920 / 1080) < 1e-6, "x mengikuti potongan tengah");
assert.equal(Math.round(b.y), 480);

// ---- data.faces mengikuti cut: detik hasil -> detik sumber
{
  // Sampel tiap 0,2 dtk (seperti talent.py): wajah di x 0,4 sebelum detik 5, x 0,6 sesudahnya
  const dense: FaceSample[] = Array.from({ length: 50 }, (_, i) => [Math.round(i * 0.2 * 10) / 10, i * 0.2 < 5 ? 0.4 : 0.6, 0.3, 0.2, 0.2, 0.9]);
  const talent = { v1: { width: 1080, height: 1920, samples: dense } };
  const style = normalizeStyle({ ...DEFAULT_STYLE, aspect: "9:16" } as never);
  const faces = creativeFaces({ segments: [{ start: 0, end: 1 }, { start: 6, end: 7 }], source: { width: 1080, height: 1920, fps: 30, durationS: 10 }, clips: [{ id: "v1", offset: 0, duration: 10 } as never], talent, style, out: { width: 1080, height: 1920 } });
  assert.ok(faces.length >= 9, "satu sampel tiap ±0,2 dtk");
  assert.equal(faces[0].x, 432, "awal: wajah di x 0,4");
  assert.equal(faces.find((f) => f.t >= 1.2)!.x, 648, "sesudah cut (sumber 6 dtk): wajah di x 0,6");
  assert.equal(creativeFaces({ segments: [{ start: 0, end: 1 }], source: { width: 1, height: 1, fps: 30, durationS: 1 }, style, out: { width: 1, height: 1 } }).length, 0, "tanpa talent = kosong");
}

// ---- export bernama kode AI: Behind + faceBlur
{
  const code = `import React from "react";
export function Behind() { return <div>B</div>; }
export function faceBlur(frame: number) { return frame > 10 ? 20 : 0; }
export default function O() { return null; }`;
  assert.equal(compileCreative(code).ok, true);
  assert.equal(typeof creativeExport(code, "Behind"), "function");
  assert.equal(creativeExport<(f: number) => number>(code, "faceBlur")!(12), 20);
  assert.equal(creativeExport("export default 1", "Behind"), null);
  assert.equal(creativeExport(undefined, "Behind"), null);
  assert.equal(creativeExport("fetch('x'); export default 1", "Behind"), null, "kode yang ditolak scope tidak punya export");
}

// ---- instruksi talent (talent hanya disiapkan bila pengguna mencentang "Pisahkan talent")
assert.match(talentInstruction({ faces: 30 }), /export function Behind/);
assert.match(talentInstruction({ faces: 30 }), /export function faceBlur/);
assert.match(buildContract(), /## Talent/);
assert.match(buildContract(), /fonts\.json/);

// ---- font: pilihan AI divalidasi terhadap katalog
const tmp = await mkdtemp(path.join(os.tmpdir(), "fase24-"));
try {
  const choices: FontRef[] = [
    { id: "anton-400", family: "Anton", weight: 400, file: "fonts/library/anton-400.ttf", source: "pustaka" },
    { id: "poppins-400", family: "Poppins", weight: 400, file: "fonts/library/poppins-400.ttf", source: "pustaka" },
    { id: "poppins-900", family: "Poppins", weight: 900, file: "fonts/library/poppins-900.ttf", source: "pustaka" },
    { id: "u-11111111-1111-4111-8111-111111111111", family: "Brand Sans", weight: 400, file: "projects/p/materials/x.ttf", source: "unggahan" },
  ];
  assert.deepEqual(await readChosenFonts(tmp, choices), { fonts: [], errors: [] }, "tanpa fonts.json = tanpa font tambahan");
  await writeFile(path.join(tmp, "fonts.json"), JSON.stringify([{ family: "anton", weight: 400 }, { family: "Poppins", weight: 900 }, "Brand Sans"]));
  const ok = await readChosenFonts(tmp, choices);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.fonts.map((f) => f.id), ["anton-400", "poppins-900", "u-11111111-1111-4111-8111-111111111111"]);
  await writeFile(path.join(tmp, "fonts.json"), JSON.stringify([{ family: "Comic Neue", weight: 400 }, { family: "Anton", weight: 900 }]));
  const bad = await readChosenFonts(tmp, choices);
  assert.equal(bad.errors.length, 2, "font tak dikenal dan ketebalan tak ada ditolak");
  await writeFile(path.join(tmp, "fonts.json"), "{ bukan json");
  assert.match((await readChosenFonts(tmp, choices)).errors[0], /bukan JSON/);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
assert.equal(uploadedFamily("Brand_Sans-Bold.otf"), "Brand_Sans-Bold");
assert.equal(uploadedFamily("../../x<y>.ttf"), "x y");
assert.ok(isFontFile("a.WOFF2") && !isFontFile("a.png"));
assert.match(fontInstruction({ families: 52, reference: true }), /HARUS meniru font referensi/);
assert.equal(fontInstruction({ families: 0, reference: true }), "", "tanpa katalog tidak ada instruksi");

console.log("fase24: semua tes lulus");
