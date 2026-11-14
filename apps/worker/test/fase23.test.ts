// Fase 23: safe area platform (9:16 Reels/TikTok: atas, bawah, kolom tombol kanan). Satu konstanta untuk subtitle, judul,
// data.safeArea kode AI, dan garis bantu pratinjau. Jalankan: node apps/worker/test/fase23.test.ts
import assert from "node:assert/strict";
import { ASPECT_IDS, MOTION, SAFE_AREA, SUBTITLE } from "../../../config/index.ts";
import { safeAreaPx } from "../../../packages/remotion/src/creative/contract.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { titleBottom } from "../../../packages/remotion/src/title-plan.ts";
import { buildMotionProps, motionCreativeData } from "../../../packages/remotion/src/motion-props.ts";
import { safeAreaErrors, safeAreaInstruction, subtitleZoneInstruction } from "../src/creative/loop.ts";

// ---- konstanta: semua rasio ada, kotak aman tidak kosong, 9:16 menghindari kolom tombol kanan
for (const a of ASPECT_IDS) {
  const z = SAFE_AREA[a];
  assert.ok(z.top + z.bottom < 0.6 && z.left + z.right < 0.4, `${a}: kotak aman masih cukup luas`);
  assert.equal(SUBTITLE.safeZone[a].bottom, z.bottom, `${a}: subtitle duduk tepat di atas safe area bawah`);
  assert.ok(SUBTITLE.safeZone[a].right >= SUBTITLE.safeZone[a].side - 1e-9);
}
assert.ok(SAFE_AREA["9:16"].right > SAFE_AREA["9:16"].left, "9:16: kolom like/komentar di kanan");
assert.equal(SUBTITLE.safeZone["9:16"].right, SAFE_AREA["9:16"].right, "subtitle 9:16 tidak tertimpa tombol kanan");

// ---- piksel untuk kode AI
assert.deepEqual(safeAreaPx("9:16", 1080, 1920), { top: 230, bottom: 461, left: 65, right: 151 });
const data = motionCreativeData(buildMotionProps({ aspect: "9:16", settings: { durationS: 4 }, colors: { text: "#fff", accent: "#f00", dark: "#000" }, materials: [], srcFor: (id) => id }));
assert.deepEqual(data.safeArea, safeAreaPx("9:16", data.width, data.height), "brief motion membawa safe area");

// ---- judul "atas" tidak masuk safe area atas
for (const a of ASPECT_IDS) assert.ok(titleBottom("atas", a) + MOTION.title.maxHeight <= 1 - SAFE_AREA[a].top + 1e-9, `${a}: judul atas di bawah safe area atas`);
assert.equal(titleBottom("tengah", "9:16"), MOTION.title.centerBottom);

// ---- instruksi dan pemeriksaan kode AI
const ins = safeAreaInstruction({ aspect: "9:16", width: 1080, height: 1920 });
assert.match(ins, /Reels\/TikTok\/Shorts/);
assert.match(ins, /kanan 151px \(kolom like/);
assert.match(ins, /x 65–929, y 230–1459/);
assert.match(ins, /data\.safeArea/);
assert.match(safeAreaInstruction({ aspect: "16:9", width: 1920, height: 1080 }), /rasio 16:9/);
assert.equal(safeAreaErrors({ overlay: "export default () => <div style={{ top: 40 }}>Halo</div>" }, "9:16").length, 1, "9:16 tanpa safeArea ditolak");
assert.equal(safeAreaErrors({ overlay: "const p = data.safeArea.top;" }, "9:16").length, 0);
assert.equal(safeAreaErrors({ overlay: "export default () => null" }, "16:9").length, 0, "rasio lain tidak diwajibkan");
assert.equal(safeAreaErrors({ overlay: "" }, "9:16").length, 0, "hanya gerak video (tanpa overlay) tidak diwajibkan");
assert.match(subtitleZoneInstruction(), /safe area bawah/);
assert.match(buildContract(), /## Safe area/);
assert.match(buildContract(), /safeArea: \{ top: number; bottom: number; left: number; right: number \}/);

console.log("fase23: semua tes lulus");
