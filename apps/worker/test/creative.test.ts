// Fase 9.0: kode kreatif di-compile saat runtime dengan scope tertutup.
import assert from "node:assert/strict";
import { CREATIVE } from "../../../config/index.ts";
import { checkScope, compileCreative } from "../../../packages/remotion/src/creative/compile.ts";
import { creativeVideoStyle } from "../../../packages/remotion/src/creative/video-style.ts";
import { SAMPLE_OVERLAY, SAMPLE_VIDEO } from "../../../packages/remotion/src/creative/sample.ts";
import type { CreativeData } from "../../../packages/remotion/src/creative/contract.ts";

const data: CreativeData = { width: 1080, height: 1920, fps: 30, durationInFrames: 270, aspect: "9:16", words: [{ text: "tujuh", start: 4, end: 4.3, hl: "aksen" }], joins: [5.2], colors: { text: "#FFFFFF", accent: "#B6FF00", dark: "#000000" }, fonts: { jakarta: "a", montserrat: "b", inter: "c" } };

// ---- contoh sah lolos dan ter-compile
assert.deepEqual(checkScope(SAMPLE_OVERLAY), []);
assert.deepEqual(checkScope(SAMPLE_VIDEO), []);
const overlay = compileCreative<unknown>(SAMPLE_OVERLAY);
assert.ok(overlay.ok && typeof overlay.value === "function", overlay.ok ? "" : overlay.error);
const video = compileCreative<(f: number, d: CreativeData) => { transform?: string; filter?: string }>(SAMPLE_VIDEO);
assert.ok(video.ok);
assert.ok(compileCreative(SAMPLE_OVERLAY) === overlay, "di-cache per string kode");

// ---- fungsi video: diam jauh dari sambungan, bergerak + blur di sambungan, deterministik
const calm = creativeVideoStyle(SAMPLE_VIDEO, 30, data)!;
assert.equal(calm.filter, undefined);
const atJoin = creativeVideoStyle(SAMPLE_VIDEO, Math.round(5.2 * 30) - 1, data)!;
assert.match(String(atJoin.filter), /blur/);
assert.deepEqual(creativeVideoStyle(SAMPLE_VIDEO, 150, data), creativeVideoStyle(SAMPLE_VIDEO, 150, data));

// ---- kode berbahaya / tidak deterministik ditolak sebelum dijalankan
const bad: Record<string, string> = {
  jaringan: `export default function v() { fetch("https://x.y"); return {}; }`,
  dom: `export default function v() { return { transform: document.title }; }`,
  storage: `export default function v() { localStorage.setItem("a", "b"); return {}; }`,
  eval: `export default function v() { return eval("1"); }`,
  constructor: `export default function v() { return [].constructor.constructor("return 1")(); }`,
  random: `export default function v() { return { opacity: Math.random() }; }`,
  modul: `import fs from "node:fs"; export default function v() { return {}; }`,
  api: `import { staticFile } from "remotion"; export default function v() { return {}; }`,
  apiTidakAda: `import { OffthreadVideo } from "remotion"; export default () => null;`,
  timer: `export default function v() { setTimeout(() => {}, 1); return {}; }`,
  importDinamis: `export default async function v() { await import("x"); return {}; }`,
  tanpaExport: `function v() { return {}; }`,
};
for (const [name, code] of Object.entries(bad)) {
  const c = compileCreative(code);
  assert.equal(c.ok, false, `${name} harus ditolak`);
}
assert.ok(checkScope("x".repeat(CREATIVE.maxCodeBytes + 10_000) + "export default 1").some((i) => i.rule === "ukuran"));

// ---- error saat jalan: tanpa efek, dilaporkan, tidak melempar
const errors: string[] = [];
const thrower = `export default function v(frame: number) { if (frame === 30) throw new Error("boom"); return { transform: "scale(1.1)" }; }`;
assert.equal(creativeVideoStyle(thrower, 30, data, (_w, m) => errors.push(m)), null);
assert.ok(errors[0].includes("boom"));
assert.equal(creativeVideoStyle(thrower, 31, data)!.transform, "scale(1.1)", "frame lain tetap jalan");
// nilai gaya berbahaya dibuang
assert.equal(creativeVideoStyle(`export default () => ({ filter: "url(https://x/y.svg#f)" })`, 1, data), null);
// sintaks rusak: pesan compile, bukan crash
const broken = compileCreative(`export default function v( { return 1 }`);
assert.ok(!broken.ok && broken.error.startsWith("Compile gagal"));

console.log(`creative.test: scope tertutup (${Object.keys(bad).length} pola ditolak), compile runtime ${overlay.ok ? overlay.ms.toFixed(1) : "?"} ms, cache, error per frame tidak merusak passed`);
