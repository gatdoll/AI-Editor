// Fase 11: salinan pratinjau (format yang tidak bisa diputar browser), reduksi noise, dan menghapus gerakan kamera.
import assert from "node:assert/strict";
import { CAMERA } from "../../../config/index.ts";
import { denoiseLevel, denoisePath, isBrowserPlayable, previewPath } from "../../../packages/shared/src/derived-media.ts";
import { PARAM_BY_ID } from "../../../packages/shared/src/params.ts";
import { buildEditedProps, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { isCovered } from "../../../packages/remotion/src/camera-plan.ts";

// ---- pratinjau: hanya codec/format piksel yang pasti diputar Chrome
assert.equal(isBrowserPlayable("hevc", "yuv420p"), false, "MOV HEVC iPhone butuh salinan");
assert.equal(isBrowserPlayable("h264", "yuv420p"), true);
assert.equal(isBrowserPlayable("h264", "yuvj420p"), true);
assert.equal(isBrowserPlayable("h264", "yuv420p10le"), false, "10-bit tidak andal");
assert.equal(isBrowserPlayable("prores", "yuv422p10le"), false);
assert.equal(isBrowserPlayable(null, null), false);
assert.equal(previewPath("p", "a"), "projects/p/preview/a.mp4");

// ---- reduksi noise: kekuatan dibulatkan per langkah (satu file per langkah), 0 = mati
assert.equal(denoiseLevel(0), 0);
assert.equal(denoiseLevel(undefined), 0);
assert.equal(denoiseLevel(0.77), 75);
assert.equal(denoiseLevel(0.5), 50);
assert.equal(denoiseLevel(1.4), 100);
assert.equal(denoiseLevel("abc"), 0);
assert.equal(denoisePath("p", "a", 75), "projects/p/audio/a-nr75.m4a");
assert.ok(PARAM_BY_ID["audio.kurangiNoise"], "pengaturan ada di registri (panel + katalog AI)");
assert.ok(PARAM_BY_ID["kamera.otomatis"]);

// ---- kamera: hapus semua gerakan otomatis / sebagian; gerakan yang diminta tetap
const source = { width: 1920, height: 1080, fps: 30, durationS: 40 };
const words = Array.from({ length: 60 }, (_, i) => ({ text: i % 7 === 6 ? "kata." : "kata", start: i * 0.6, end: i * 0.6 + 0.4 }));
const base = { segments: [{ start: 0, end: 20 }, { start: 22, end: 40 }], source, words, seed: 7 };
const still = (m: { from: Record<string, number>; to: Record<string, number> }) => ["scale", "x", "y", "rot"].every((k) => m.from[k] === m.to[k]);
const covered = (m: { from: Parameters<typeof isCovered>[0]; to: Parameters<typeof isCovered>[0] }) => [0, 0.25, 0.5, 0.75, 1].every((t) => isCovered({ scale: m.from.scale + (m.to.scale - m.from.scale) * t, x: m.from.x + (m.to.x - m.from.x) * t, y: m.from.y + (m.to.y - m.from.y) * t, rot: m.from.rot + (m.to.rot - m.from.rot) * t }, 1920, 1080));
const noJumps = (moves: Array<{ continuous: boolean; from: Record<string, number>; to: Record<string, number> }>) => moves.every((m, i) => !m.continuous || i === 0 || ["scale", "x", "y", "rot"].every((k) => Math.abs(m.from[k] - moves[i - 1].to[k]) < 1e-9));

const auto = buildEditedProps({ ...base, style: normalizeStyle({ aspect: "16:9" }) });
assert.ok(auto.props.camera.some((m) => !still(m)), "bawaan: kamera bergerak");

const req = { startS: 5, endS: 9, preset: "push-in" as const };
const off = buildEditedProps({ ...base, style: normalizeStyle({ aspect: "16:9", params: { "kamera.otomatis": false }, cameraOverrides: [req] }) });
assert.equal(off.cameraErrors.length, 0);
const forced = off.props.camera.filter((m) => m.start <= 5.5 && m.end >= 8.5);
assert.ok(forced.length === 1 && !still(forced[0]) && forced[0].preset === "push-in", "gerakan yang diminta tetap bergerak");
assert.ok(off.props.camera.filter((m) => m !== forced[0]).every(still), "semua gerakan otomatis jadi diam");
assert.ok(noJumps(off.props.camera), "tanpa lompatan di tengah segmen");
assert.ok(off.props.camera.every(covered), "tanpa tepi hitam");
// Diam di awal segmen = netral, KECUALI deretan diam tepat sebelum gerakan yang diminta: menahan posisi awal gerakan itu
const fi = off.props.camera.indexOf(forced[0]);
off.props.camera.forEach((m, i) => {
  if (m.continuous || i >= fi) return;
  const lead = off.props.camera.slice(i + 1, fi).every((x) => x.continuous);
  assert.equal(m.from.scale, lead ? forced[0].from.scale : CAMERA.baseScale, `diam ${i}`);
});
// pull-back yang diminta setelah deretan diam tetap bergerak (perlu mulai dari zoom)
const pb = buildEditedProps({ ...base, style: normalizeStyle({ aspect: "16:9", params: { "kamera.otomatis": false }, cameraOverrides: [{ startS: 3, endS: 7, preset: "pull-back" }] }) });
const pbMove = pb.props.camera.find((m) => m.preset === "pull-back" && m.start <= 3.5 && m.end >= 6.5)!;
assert.ok(pbMove && pbMove.from.scale > pbMove.to.scale + 0.01, "pull-back yang diminta benar-benar menjauh");
assert.ok(noJumps(pb.props.camera) && pb.props.camera.every(covered));

// Hapus satu gerakan (rentang mentah): hanya gerakan yang titik tengahnya di sana yang diam
const target = auto.props.camera.find((m) => !still(m) && m.start > 1)!;
const muted = buildEditedProps({ ...base, style: normalizeStyle({ aspect: "16:9", cameraMuted: [{ start: target.start + 0.01, end: target.end - 0.01 }] }) });
const mi = muted.props.camera.findIndex((m) => Math.abs(m.start - target.start) < 1e-6);
assert.ok(mi >= 0 && still(muted.props.camera[mi]), "gerakan yang dihapus jadi diam");
assert.ok(muted.props.camera.some((m) => !still(m)), "gerakan lain tetap");
assert.ok(noJumps(muted.props.camera) && muted.props.camera.every(covered));
assert.equal("cameraMuted" in normalizeStyle({}), false, "project lama tidak berubah");

console.log("fase11.test: salinan pratinjau hanya untuk codec yang tidak bisa diputar, level reduksi noise, hapus gerakan kamera (semua/sebagian) tanpa lompatan/tepi hitam, gerakan diminta tetap passed");
