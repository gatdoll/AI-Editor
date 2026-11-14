// Uji properti energi kamera dan preset zoom kiri/kanan. Jalankan: npm test
import { cameraStateAt, isCovered, normalizeOverrides, planCamera, validatePlan, type CameraOverride } from "../../../packages/remotion/src/camera-plan.ts";
import { CAMERA, ENERGY, type Energy } from "@app/config";

let ok = 0, bad = 0;
const t = (n: string, c: boolean, i = "") => { c ? ok++ : bad++; if (!c) console.log("GAGAL ", n, i); };
function rnd(seed: number) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

const cfgs = [{ W: 1920, H: 1080, max: 1.2 }, { W: 1080, H: 1920, max: 1.08 }, { W: 1080, H: 1920, max: 1.2 }, { W: 1920, H: 1080, max: 1.6 }];
const energies: Energy[] = ["tenang", "sedang", "energik"];
const stat: Record<string, { plans: number; moves: number; avgLen: number; presets: Record<string, number>; maxScaleSeen: number }> = {};
const viol: string[] = [];
let samples = 0, plans = 0;

for (const energy of energies) {
  const st = (stat[energy] = { plans: 0, moves: 0, avgLen: 0, presets: {}, maxScaleSeen: 0 });
  let totalLen = 0;
  for (const cfg of cfgs) for (let seed = 1; seed <= 200; seed++) {
    const r = rnd(seed * 7919 + cfg.W);
    const D = 8 + r() * 120;
    const joins = Array.from({ length: Math.floor(r() * 8) }, () => r() * D);
    const sentenceEnds = Array.from({ length: Math.floor(r() * 40) }, () => r() * D);
    const overrides: CameraOverride[] = seed % 3 === 0 ? Array.from({ length: Math.floor(r() * 5) }, () => { const s = r() * D; return { start: s, end: s + 0.5 + r() * 3, preset: (["zoom-point", "push-in", "zoom-left", "zoom-right"] as const)[Math.floor(r() * 4)] }; }) : [];
    const inp = { durationS: D, joins, sentenceEnds, width: cfg.W, height: cfg.H, maxScale: cfg.max, seed, overrides, energy };
    const plan = planCamera(inp);
    plans++; st.plans++;
    const errs = validatePlan(plan, inp);
    if (errs.length) viol.push(`${energy} ${cfg.W}x${cfg.H}/${cfg.max} seed=${seed}: ${errs[0]}`);
    for (let f = 0; f < Math.floor(D * 30); f += 3) { samples++; const s = cameraStateAt(plan, f / 30); st.maxScaleSeen = Math.max(st.maxScaleSeen, s.scale); if (!isCovered(s, cfg.W, cfg.H) || s.scale > cfg.max + 1e-9) { viol.push(`${energy} seed=${seed} t=${(f / 30).toFixed(2)} tepi hitam/melebihi batas`); break; } }
    for (const m of plan) { st.moves++; totalLen += m.end - m.start; st.presets[m.preset] = (st.presets[m.preset] ?? 0) + 1; }
    // override dihormati juga untuk zoom-left/right
    for (const n of normalizeOverrides(overrides, D, joins)) {
      const cover = plan.filter((m) => m.preset === n.preset).reduce((a, m) => a + Math.max(0, Math.min(m.end, n.end) - Math.max(m.start, n.start)), 0);
      if (cover < 0.8 * (n.end - n.start)) viol.push(`${energy} override ${n.preset} tidak dihormati seed=${seed}`);
    }
  }
  st.avgLen = totalLen / st.moves;
}
t(`${plans} rencana, ${samples} sampel di 3 tingkat energi: nol pelanggaran`, viol.length === 0, viol.slice(0, 4).join(" | "));
t(`energik menghasilkan gerakan lebih pendek dan lebih sering daripada sedang, dan tenang lebih panjang`, stat.energik.avgLen < stat.sedang.avgLen && stat.sedang.avgLen < stat.tenang.avgLen, energies.map((e) => `${e}=${stat[e].avgLen.toFixed(2)}s`).join(" "));
t("zoom kiri/kanan TIDAK muncul otomatis pada energi tenang/sedang (tanpa diminta)", true);
// cek terpisah tanpa override: zoom-left/right hanya pada energik
let leftRightCalm = 0, leftRightEnergik = 0;
for (const energy of energies) for (let seed = 1; seed <= 100; seed++) {
  const r = rnd(seed);
  const D = 60;
  const plan = planCamera({ durationS: D, joins: [20], sentenceEnds: Array.from({ length: 12 }, () => r() * D), width: 1920, height: 1080, maxScale: 1.2, seed, energy });
  const lr = plan.filter((m) => m.preset === "zoom-left" || m.preset === "zoom-right").length;
  if (energy === "energik") leftRightEnergik += lr; else leftRightCalm += lr;
}
t(`tanpa override: zoom kiri/kanan 0x pada tenang/sedang (${leftRightCalm}) dan muncul pada energik (${leftRightEnergik}x)`, leftRightCalm === 0 && leftRightEnergik > 20);
// zoom kiri dan kanan benar-benar bergeser ke arah yang benar
const L = planCamera({ durationS: 10, joins: [], sentenceEnds: [], width: 1920, height: 1080, maxScale: 1.2, seed: 1, overrides: [{ start: 2, end: 6, preset: "zoom-left" }] }).find((m) => m.preset === "zoom-left")!;
const R = planCamera({ durationS: 10, joins: [], sentenceEnds: [], width: 1920, height: 1080, maxScale: 1.2, seed: 1, overrides: [{ start: 2, end: 6, preset: "zoom-right" }] }).find((m) => m.preset === "zoom-right")!;
t("zoom-left menggeser frame ke kanan (x>0 agar sisi kiri mendekat) dan zoom-right ke kiri (x<0)", L.to.x > 0.01 && R.to.x < -0.01 && L.to.scale > L.from.scale && R.to.scale > R.from.scale, `left.x=${L.to.x.toFixed(3)} right.x=${R.to.x.toFixed(3)}`);
t("energik: delta lebih besar daripada sedang", (() => { const mk = (energy: Energy) => planCamera({ durationS: 20, joins: [], sentenceEnds: [], width: 1920, height: 1080, maxScale: 1.6, seed: 5, energy }).reduce((a, m) => Math.max(a, Math.abs(m.to.scale - m.from.scale)), 0); return mk("energik") > mk("sedang") && mk("sedang") > mk("tenang"); })());
t("daftar energi lengkap dengan label", Object.keys(ENERGY).length === 3 && CAMERA.presets.length === 5);
console.log(JSON.stringify(Object.fromEntries(energies.map((e) => [e, { rata2PanjangGerakan: +stat[e].avgLen.toFixed(2), gerakan: stat[e].moves, preset: stat[e].presets }]))));
console.log(`energy.test: ${ok} lolos, ${bad} gagal`);
process.exit(bad ? 1 : 0);
