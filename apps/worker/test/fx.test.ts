// Efek editing video pendek: transisi sambungan, guncangan, dutch tilt, kata kunci, hook, lower third, font, teks keluar.
import assert from "node:assert/strict";
import { FX } from "@app/config";
import { LLM_OPS_SCHEMA, normalizeOps } from "@app/shared/ops";
import { PARAM_BY_ID, coerceParam } from "@app/shared/params";
import { planEffects } from "../src/prompt/effects.ts";
import { buildOpsPrompt } from "../src/prompt/translate.ts";
import { buildEditedProps, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { fxStateAt, planFx } from "../../../packages/remotion/src/fx-plan.ts";

const fps = 30, W = 1080, H = 1920;
const words = ["hari", "ini", "aku", "mau", "kasih", "rahasia", "editing", "yang", "bikin", "video", "viral", "banget"].map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4, confidence: 1 }));
const source = { width: 1920, height: 1080, fps, durationS: 12 };

// ---- parameter baru terdaftar dan tervalidasi
for (const id of ["teks.font", "teks.popDari", "teks.keluar", "transisi.jenis", "transisi.durasi", "kamera.guncang", "kamera.miring"]) assert.ok(PARAM_BY_ID[id], id);
assert.equal((coerceParam(PARAM_BY_ID["transisi.jenis"], "whip") as { value: string }).value, "whip");
assert.equal(coerceParam(PARAM_BY_ID["transisi.jenis"], "fade").ok, false);
assert.equal((coerceParam(PARAM_BY_ID["kamera.miring"], "20") as { value: number }).value, 8, "tilt dibatasi 8 derajat");

// ---- ops baru lolos skema; hook boleh tanpa teks, judul lain tidak
const n = normalizeOps([
  { type: "highlight_phrase", phrase: "rahasia", effect: "aksen" },
  { type: "highlight_phrase", phrase: "viral", effect: "slam" },
  { type: "add_title", text: "", startS: 0, endS: 3, animation: "hook", position: "tengah" },
  { type: "add_title", text: "Budi Santoso", subtext: "Video Editor", startS: 4, endS: 8, animation: "lower-third", position: "tengah" },
  { type: "add_title", text: "", startS: 0, endS: 3, animation: "kinetik", position: "atas" },
]);
assert.equal(n.ops.length, 4);
assert.equal(n.rejected.length, 1, "judul kinetik tanpa teks ditolak");
assert.ok((LLM_OPS_SCHEMA.required as readonly string[]).includes("unsupported"));

// ---- planEffects: kata kunci dari transkrip, hook dari ucapan nyata, lower third
const fx = await planEffects(n.ops, { words, durationS: 12, style: normalizeStyle({ aspect: "9:16", styleId: "modern" }), existing: [], getSilences: async () => [] });
const style = fx.style!;
assert.equal(style.highlights!.length, 2);
assert.deepEqual(style.highlights!.map((h) => h.effect), ["aksen", "slam"]);
const hook = style.titles!.find((t) => t.animation === "hook")!;
assert.equal(hook.text, "hari ini aku mau kasih rahasia", "hook memakai kata yang diucapkan pada 0–3 dtk, bukan karangan");
const lt = style.titles!.find((t) => t.animation === "lower-third")!;
assert.equal(lt.subtext, "Video Editor");
const missing = await planEffects(normalizeOps([{ type: "highlight_phrase", phrase: "tidakada", effect: "aksen" }]).ops, { words, durationS: 12, style, existing: [], getSilences: async () => [] });
assert.equal(missing.style, null);
assert.ok(missing.messages[0].includes("Tidak menemukan"), "kata kunci yang tidak ada dilaporkan (aturan 7)");

// ---- props: token ditandai, fx direncanakan, terpotong ikut hilang
// Subtitle disembunyikan selama judul hook tampil (kata yang sama tidak dobel)
const withHook = buildEditedProps({ segments: [{ start: 0, end: 12 }], source, words, style, seed: 1 });
assert.ok(withHook.props.pages.every((p) => p.start >= 3 - 0.05 || p.end <= 0), "tidak ada subtitle di 0–3 dtk saat hook");
const full = normalizeStyle({ ...style, titles: style.titles!.filter((t) => t.animation !== "hook"), params: { "transisi.jenis": "whip", "kamera.guncang": 0.5, "kamera.miring": 4, "teks.font": "montserrat", "teks.keluar": "geser", "teks.kataPerHalaman": 3 } });
const segments = [{ start: 0, end: 4.5 }, { start: 5, end: 12 }]; // satu cut -> satu sambungan
const built = buildEditedProps({ segments, source, words, style: full, seed: 1 });
const toks = built.props.pages.flatMap((p) => p.tokens);
assert.equal(toks.find((t) => t.text.trim() === "rahasia")?.hl, "aksen");
assert.equal(toks.find((t) => t.text.trim() === "viral")?.hl, "slam");
assert.equal(built.props.fx!.joins.length, 1);
assert.equal(built.props.fx!.transition.kind, "whip");
assert.ok(built.props.fx!.shakes.length >= 1, "slam menghasilkan guncangan");
assert.deepEqual(built.props.textFx, { font: "montserrat", popFrom: 0.55, exit: "geser" });
// kata kunci di bagian yang dipotong tidak muncul
const cutAway = buildEditedProps({ segments: [{ start: 0, end: 2.4 }, { start: 3.1, end: 12 }], source, words, style: full, seed: 1 });
assert.ok(!cutAway.props.pages.flatMap((p) => p.tokens).some((t) => t.text.trim() === "rahasia"));
// kamera mati = tanpa guncangan/tilt (slam tetap memantul hanya bila kamera nyala)
const noCam = buildEditedProps({ segments, source, words, style: normalizeStyle({ ...full, camera: false }), seed: 1 });
assert.equal(noCam.props.fx!.tilts.length, 0);

// ---- fxStateAt: puncak di sambungan, diam di luar, tilt tanpa tepi kosong, deterministik
for (const kind of ["whip", "zoom", "glitch"] as const) {
  const plan = planFx({ kind, frames: 8, joins: [5], shake: 0, shakeAt: [], slamAt: [], tiltDeg: 0, pageStarts: [], durationS: 10 });
  const idle = fxStateAt(plan, 3 * fps, fps, W, H);
  assert.ok(idle.x === 0 && idle.scale === 1 && idle.blur === 0 && !idle.filter, `${kind}: diam jauh dari sambungan`);
  const peak = fxStateAt(plan, 5 * fps - 1, fps, W, H);
  assert.ok(Math.abs(peak.x) > 0 || peak.scale > 1 || peak.blur > 0, `${kind}: bergerak di sambungan`);
  assert.deepEqual(fxStateAt(plan, 5 * fps + 1, fps, W, H), fxStateAt(plan, 5 * fps + 1, fps, W, H));
}
const tiltPlan = planFx({ kind: "tidak", frames: 8, joins: [1], shake: 0, shakeAt: [], slamAt: [], tiltDeg: 5, pageStarts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], durationS: 14 });
assert.equal(tiltPlan.joins.length, 0, "transisi 'tidak' tidak memakai sambungan");
assert.ok(tiltPlan.tilts.length >= 1);
for (let i = 1; i < tiltPlan.tilts.length; i++) assert.ok(tiltPlan.tilts[i].t - tiltPlan.tilts[i - 1].t >= FX.tilt.minGapSec);
const tilted = fxStateAt(tiltPlan, Math.round((tiltPlan.tilts[0].t + 0.3) * fps), fps, W, H);
assert.ok(Math.abs(tilted.rot) > 4.5, "tilt tertahan penuh");
const r = Math.abs(tilted.rot) * Math.PI / 180;
assert.ok(tilted.scale >= Math.cos(r) + Math.sin(r) * (H / W) - 1e-9, "skala menutup sudut kosong saat miring");
const after = fxStateAt(tiltPlan, Math.round((tiltPlan.tilts[0].t + FX.tilt.holdSec + 0.3) * fps), fps, W, H);
assert.equal(after.rot, 0, "snap kembali lurus");
const shakePlan = planFx({ kind: "tidak", frames: 8, joins: [], shake: 1, shakeAt: [2, 2.1], slamAt: [], tiltDeg: 0, pageStarts: [], durationS: 10 });
assert.equal(shakePlan.shakes.length, 1, "guncangan berdekatan digabung");
let maxAmp = 0;
for (let f = 0; f <= FX.shake.frames + 2; f++) { const s = fxStateAt(shakePlan, 60 + f, fps, W, H); maxAmp = Math.max(maxAmp, Math.hypot(s.x, s.y)); }
assert.ok(maxAmp > 3 && maxAmp < FX.shake.ampPx * 2 * (H / 1080), "guncangan terasa tapi tidak berlebihan");
assert.equal(fxStateAt(shakePlan, 60 + FX.shake.frames + 3, fps, W, H).x, 0, "guncangan habis setelah beberapa frame");

// ---- prompt AI memuat resep dan operasi baru
const prompt = buildOpsPrompt("tes", { durationS: 12, wordCount: 12, style: { styleId: "modern", aspect: "9:16", camera: true, captions: true, effects: true, cameraOverrides: 0, params: {} }, pending: 0, approved: 0, referenceSummary: "Kotak merah muda pada kata aktif." });
for (const needle of ["highlight_phrase", "lower-third", "transisi.jenis", "kamera.guncang", "unsupported", "Kotak merah muda"]) assert.ok(prompt.includes(needle), needle);

console.log("fx.test: params, 4 ops baru, kata kunci + hook dari ucapan, transisi whip/zoom/glitch, guncangan, dutch tilt tanpa tepi kosong, pemetaan cut passed");

// ---- kata kunci otomatis: dipilih kode, deterministik, berjarak, kata fungsi dan kata ragu dilewati
{
  const { pickKeywords } = await import("@app/shared/keywords");
  const talk = "jadi aku punya tujuh tools marketing yang terkoneksi ke dashboard dan semuanya gratis buat kamu coba hari ini juga".split(" ")
    .map((text, i) => ({ text: i === 18 ? "juga." : text, start: i * 0.6, end: i * 0.6 + 0.5, confidence: text === "dashboard" ? 0.2 : 0.95 }));
  const picks = pickKeywords(talk, { density: "sering", slamCount: 1, max: 40 });
  const texts = picks.map((p) => p.text);
  assert.ok(texts.includes("tujuh"), "angka diutamakan");
  assert.ok(!texts.includes("dashboard"), "kata dengan keyakinan rendah tidak disorot (aturan 7)");
  assert.ok(!texts.some((t) => ["jadi", "aku", "yang", "dan", "kamu", "buat"].includes(t)), "kata fungsi dilewati");
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i].start - picks[i - 1].start >= 2 - 1e-9, "berjarak sesuai kepadatan");
  assert.equal(picks.filter((p) => p.effect === "slam").length, 1);
  assert.deepEqual(pickKeywords(talk, { density: "sering", slamCount: 1, max: 40 }), picks, "deterministik");
  const auto = await planEffects(normalizeOps([{ type: "auto_highlight", density: "sering", slamCount: 1, punch: true }]).ops, { words: talk, durationS: 12, style: normalizeStyle({ aspect: "9:16" }), existing: [], getSilences: async () => [] });
  assert.ok(auto.style!.highlights!.every((h) => h.auto));
  assert.ok(auto.style!.cameraOverrides.length >= 1, "punch-in kamera di kata slam");
  assert.ok(auto.messages[0].includes("tujuh"), "kata yang dipilih ditampilkan ke pengguna");
  // dijalankan lagi: sorotan otomatis lama diganti, bukan ditumpuk
  const again = await planEffects(normalizeOps([{ type: "auto_highlight", density: "jarang", slamCount: 0, punch: false }]).ops, { words: talk, durationS: 12, style: auto.style!, existing: [], getSilences: async () => [] });
  assert.ok(again.style!.highlights!.length < auto.style!.highlights!.length);
  console.log("fx.test: kata kunci otomatis (angka, kata ragu dilewati, jarak, slam, punch-in, diganti saat diulang) passed");
}
