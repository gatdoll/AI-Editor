// Fase 25: rig karakter (validasi rig, pose murni, kontrak, compile modul character). Jalankan: node apps/worker/test/fase25.test.ts
import assert from "node:assert/strict";
import { parseRig } from "../../../packages/shared/src/rig.ts";
import { blinkAt, characterPose, CHARACTER_ACTIONS } from "../../../packages/remotion/src/creative/character.ts";
import { checkScope, compileCreative } from "../../../packages/remotion/src/creative/compile.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { materialAssets } from "../../../packages/remotion/src/motion-props.ts";
import { characterErrors, characterInstruction } from "../src/creative/loop.ts";

const rig = { version: 1, width: 1122, height: 1402, box: { x: 300, y: 20, w: 500, h: 1300 }, neck: { y: 560, l: 500, r: 640, cx: 570 }, legs: { hip: 1050, split: 560 },
  eyes: [{ x: 500, y: 370, rx: 40, ry: 44 }, { x: 650, y: 370, rx: 40, ry: 44 }], mouth: { x: 575, y: 495, w: 120 }, skin: "#fecfa5", mask: "data:image/png;base64,AAAA", notes: [] };

// ---- validasi rig
assert.ok(parseRig(rig));
assert.equal(parseRig({ ...rig, mask: "https://contoh/mask.png" }), null, "topeng hanya data URL (tanpa unduhan)");
assert.equal(parseRig({ ...rig, version: 2 }), null);
assert.ok(parseRig({ ...rig, legs: null, eyes: null, mouth: null, skin: null }), "bagian tak terdeteksi = null, bukan ditebak");

// ---- pose murni dan deterministik
for (const a of CHARACTER_ACTIONS) assert.deepEqual(characterPose(a, 1.3, 0.4, 7, true), characterPose(a, 1.3, 0.4, 7, true), a);
const jumpMid = characterPose("jump", 0, 0.375, 1, false), jumpBefore = characterPose("jump", 0, -0.5, 1, false);
assert.ok(jumpMid.y < -0.1 && jumpBefore.y === 0, "lompat hanya sesudah `from`");
const walk = [0.1, 0.6].map((t) => characterPose("walk", t, t, 1, false));
assert.ok(walk.some((p) => p.legL < 0) && walk.some((p) => p.legR < 0), "kaki bergantian terangkat saat jalan");
assert.equal(characterPose("idle", 1, 1, 1, false).mouth, 0, "tanpa bicara mulut tertutup");
assert.ok([0, 1, 2, 3].some((t) => characterPose("idle", t + 0.05, 0, 1, true).mouth > 0.3), "bicara = mulut terbuka");
assert.ok(Array.from({ length: 200 }, (_, i) => blinkAt(i / 30, 3)).some((b) => b > 0.9), "berkedip dalam ±7 dtk");

// ---- compile: modul character diizinkan, modul lain tetap ditolak
const code = `import React from "react";\nimport { Character } from "character";\nexport default function O({ data }: CreativeProps) { const a = data.assets![0]; return <Character asset={a} height={400} action="walk" />; }`;
assert.deepEqual(checkScope(code), []);
assert.ok(compileCreative(code).ok);
assert.ok(checkScope(code.replace('"character"', '"lodash"')).some((i) => i.rule === "modul"));

// ---- kontrak + pemeriksaan kode
const doc = buildContract({ motion: true });
assert.match(doc, /## Karakter ber-rig/);
assert.match(doc, /import \{ Character \} from "character"/);
const data = { assets: [{ rig }] };
assert.equal(characterErrors({ overlay: "<Img src={a.src} />" }, data).length, 1, "karakter ber-rig ditampilkan diam = ditolak");
assert.deepEqual(characterErrors({ overlay: code }, data), []);
assert.deepEqual(characterErrors({ overlay: "<Img />" }, { assets: [{}] }), [], "tanpa rig tidak diwajibkan");
assert.match(characterInstruction({ names: ["prof.png"] }), /prof\.png/);

// ---- rig ikut ke data.assets (bukan logo)
const mats = [{ id: "a", label: "a.png", mime: "image/png", rig: parseRig(rig)! }, { id: "b", label: "logo.png", mime: "image/png", role: "logo" as const, rig: parseRig(rig)! }];
const assets = materialAssets(mats, (id) => `/f/${id}`, undefined, { imagesOnly: true });
assert.ok(assets[0].rig && !assets[1].rig, "logo tidak pernah di-rig");

console.log("fase25: semua tes lulus");
