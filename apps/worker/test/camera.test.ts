// Uji properti perencana kamera, termasuk override pengguna. Jalankan: npm test
import { cameraStateAt, driftAt, easeCamera, isCovered, maxScaleFor, meaningfulThreshold, normalizeOverrides, planCamera, validatePlan, type CameraOverride } from "../../../packages/remotion/src/camera-plan.ts";
import { CAMERA } from "@app/config";

let ok = 0, bad = 0;
const t = (n: string, c: boolean, i = "") => { c ? ok++ : bad++; if (!c) console.log("GAGAL ", n, i); };
function rnd(seed: number) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

// easing bukan linear
const xs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const ys = xs.map(easeCamera);
t("easing non-linear, monoton, 0->0, 1->1, awal lambat", xs.filter((x, i) => Math.abs(ys[i] - x) > 0.05).length >= 6 && ys.every((v, i) => i === 0 || v > ys[i - 1]) && easeCamera(0) === 0 && easeCamera(1) === 1 && ys[0] < 0.05);
// cakupan
t("cakupan: skala 1.0 + drift tidak tertutup; 1.01 tertutup", !isCovered({ scale: 1.0, x: 0, y: 0, rot: 0 }, 1920, 1080) && isCovered({ scale: 1.01, x: 0, y: 0, rot: 0 }, 1920, 1080));
t("cakupan: rotasi 1 derajat butuh skala lebih besar", !isCovered({ scale: 1.01, x: 0, y: 0, rot: 1 }, 1920, 1080) && isCovered({ scale: 1.06, x: 0, y: 0, rot: 1 }, 1920, 1080));
let maxD = 0;
for (let i = 0; i < 3000; i++) { const d = driftAt(i / 30); maxD = Math.max(maxD, Math.abs(d.dx), Math.abs(d.dy)); }
t("drift <= 2px", maxD <= CAMERA.driftPx + 1e-9 && maxD > 0.5);
t("batas zoom per kasus", maxScaleFor(1080, 1920, 1920, 1080) === 1.2 && maxScaleFor(2160, 3840, 1920, 1080) === 1.6 && maxScaleFor(1080, 1920, 1080, 1920) === 1.08 && maxScaleFor(1920, 1080, 1080, 1920) === 1.2);

// normalizeOverrides
let o = normalizeOverrides([{ start: 5, end: 5.2, preset: "zoom-point" }], 60, []);
t("override pendek diperpanjang", o.length === 1 && o[0].end - o[0].start >= CAMERA.overrideMinSec - 1e-9);
o = normalizeOverrides([{ start: 9, end: 12, preset: "zoom-point" }], 60, [10]);
t("override tidak melintasi sambungan", o.length === 1 && (o[0].end <= 10 + 1e-9 || o[0].start >= 10 - 1e-9));
t("tumpang tindih sama digabung", normalizeOverrides([{ start: 5, end: 8, preset: "zoom-point" }, { start: 7, end: 10, preset: "zoom-point" }], 60, []).length === 1);
o = normalizeOverrides([{ start: 5, end: 8, preset: "zoom-point" }, { start: 7, end: 10, preset: "push-in" }], 60, []);
t("tumpang tindih beda: tidak saling menimpa", o.length === 2 && o[1].start >= o[0].end - 1e-9);
t("jumlah dibatasi", normalizeOverrides(Array.from({ length: 500 }, (_, i) => ({ start: i * 3, end: i * 3 + 2, preset: (i % 2 ? "push-in" : "zoom-point") as CameraOverride["preset"] })), 2000, []).length <= CAMERA.overrideMax);

// properti: tanpa dan dengan override
const cfgs = [{ W: 1920, H: 1080, max: 1.2 }, { W: 1080, H: 1920, max: 1.08 }, { W: 1080, H: 1920, max: 1.2 }, { W: 1920, H: 1080, max: 1.6 }];
let plans = 0, samples = 0, ovTotal = 0, honored = 0, sparseN = 0, sparseM = 0;
const viol: string[] = [];
for (const cfg of cfgs) for (let seed = 1; seed <= 300; seed++) {
  const r = rnd(seed * 7919 + cfg.W);
  const D = 0.5 + r() * 140;
  const joins = Array.from({ length: Math.floor(r() * 10) }, () => r() * D);
  const sentenceEnds = Array.from({ length: Math.floor(r() * 30) }, () => r() * D);
  const withOv = seed % 4 !== 0; // seperempat tanpa override
  const overrides: CameraOverride[] = withOv ? Array.from({ length: Math.floor(r() * 7) }, () => { const s = r() * D; return { start: s, end: s + 0.3 + r() * 3, preset: r() < 0.7 ? "zoom-point" : "push-in" }; }) : [];
  const inp = { durationS: D, joins, sentenceEnds, width: cfg.W, height: cfg.H, maxScale: cfg.max, seed, overrides };
  const plan = planCamera(inp);
  plans++;
  const errs = validatePlan(plan, inp);
  if (errs.length) viol.push(`${cfg.W}x${cfg.H}/${cfg.max} seed=${seed}: ${errs[0]}`);
  for (let f = 0; f < Math.floor(D * 30); f += 3) { samples++; const st = cameraStateAt(plan, f / 30); if (!isCovered(st, cfg.W, cfg.H) || st.scale > cfg.max + 1e-9) { viol.push(`seed=${seed} t=${(f / 30).toFixed(2)} tepi hitam`); break; } }
  const norm = normalizeOverrides(overrides, D, joins);
  for (const n of norm) {
    ovTotal++;
    const cover = plan.filter((m) => m.preset === n.preset).reduce((a, m) => a + Math.max(0, Math.min(m.end, n.end) - Math.max(m.start, n.start)), 0);
    if (cover >= 0.8 * (n.end - n.start)) honored++;
    const m = plan.find((x) => x.preset === n.preset && Math.abs(x.start - n.start) < 1e-6);
    if (m && m.end - m.start >= CAMERA.minMoveSec && !norm.some((x) => x !== n && Math.abs(x.start - n.start) < 10)) { sparseN++; if (Math.abs(m.to.scale - m.from.scale) >= meaningfulThreshold(n.preset, cfg.max) - 1e-9) sparseM++; }
  }
}
t(`${plans} rencana, ${samples} sampel: nol pelanggaran invarian (tepi hitam, preset berulang, lompatan, batas zoom)`, viol.length === 0, viol.slice(0, 3).join(" | "));
t(`override dihormati >= 97% (${honored}/${ovTotal})`, honored / ovTotal >= 0.97);
t(`zoom diminta yang jarang bermakna >= 90% (${sparseM}/${sparseN})`, sparseM / Math.max(1, sparseN) >= 0.9);
const a = planCamera({ durationS: 40, joins: [10, 25], sentenceEnds: [4, 8, 14], width: 1920, height: 1080, maxScale: 1.2, seed: 3, overrides: [{ start: 5, end: 7, preset: "zoom-point" }] });
const b = planCamera({ durationS: 40, joins: [10, 25], sentenceEnds: [4, 8, 14], width: 1920, height: 1080, maxScale: 1.2, seed: 3, overrides: [{ start: 5, end: 7, preset: "zoom-point" }] });
t("deterministik + override muncul", JSON.stringify(a) === JSON.stringify(b) && a.some((m) => m.preset === "zoom-point" && m.start <= 5.01 && m.end >= 6.9));
const c0 = planCamera({ durationS: 40, joins: [10], sentenceEnds: [4, 8], width: 1920, height: 1080, maxScale: 1.2, seed: 9 });
const c1 = planCamera({ durationS: 40, joins: [10], sentenceEnds: [4, 8], width: 1920, height: 1080, maxScale: 1.2, seed: 9, overrides: [] });
t("override kosong = tanpa override", JSON.stringify(c0) === JSON.stringify(c1));
t("video 0.5 dtk valid", validatePlan(planCamera({ durationS: 0.5, joins: [], sentenceEnds: [], width: 1920, height: 1080, maxScale: 1.2, seed: 1 }), { durationS: 0.5, joins: [], sentenceEnds: [], width: 1920, height: 1080, maxScale: 1.2, seed: 1 }).length === 0);

console.log(`camera.test: ${ok} lolos, ${bad} gagal`);
process.exit(bad ? 1 : 0);
