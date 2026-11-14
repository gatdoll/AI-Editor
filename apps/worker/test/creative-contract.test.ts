// Fase 9.1: kontrak, validator scope yang diperketat, creativeId di gaya, dan migrasi.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkScope, compileCreative, REMOTION_API, SCOPE_RULE_LABELS } from "../../../packages/remotion/src/creative/compile.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { creativeVideoStyle } from "../../../packages/remotion/src/creative/video-style.ts";
import { SAMPLE_OVERLAY, SAMPLE_VIDEO } from "../../../packages/remotion/src/creative/sample.ts";
import type { CreativeData } from "../../../packages/remotion/src/creative/contract.ts";
import { normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { JobType, CreativeStatus } from "../../../packages/shared/src/index.ts";
import { CREATIVE } from "../../../config/index.ts";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const data: CreativeData = { width: 1080, height: 1920, fps: 30, durationInFrames: 270, aspect: "9:16", words: [], joins: [], colors: { text: "#FFFFFF", accent: "#B6FF00", dark: "#000000" }, fonts: { jakarta: "a", montserrat: "b", inter: "c" } };

// ---- contract.md: contoh di dalamnya sah, dan daftar di dalamnya sama dengan yang ditegakkan
const contract = buildContract();
const blocks = [...contract.matchAll(/```(tsx|ts)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], code: m[2] }));
const overlayEx = blocks.find((b) => b.lang === "tsx")!.code;
const videoEx = blocks.filter((b) => b.lang === "ts").map((b) => b.code).find((c) => c.includes("videoMotion"))!;
assert.deepEqual(checkScope(overlayEx), [], "contoh overlay di contract.md harus lolos validator");
assert.deepEqual(checkScope(videoEx), [], "contoh video di contract.md harus lolos validator");
assert.ok(compileCreative(overlayEx).ok, "contoh overlay ter-compile");
const ve = creativeVideoStyle(videoEx, 10, { ...data, joins: [10 / 30] });
assert.match(String(ve?.filter), /blur/);
assert.equal(creativeVideoStyle(videoEx, 100, data)?.filter, undefined, "jauh dari sambungan: tanpa blur");
for (const name of REMOTION_API) assert.ok(contract.includes(`\`${name}\``), `contract.md menyebut ${name}`);
for (const label of SCOPE_RULE_LABELS) assert.ok(contract.includes(label), `contract.md menyebut larangan: ${label}`);
assert.ok(contract.includes(String(CREATIVE.maxCodeBytes)));
// setiap field CreativeData di contract.ts ada di dokumen (tipe tidak boleh berbeda diam-diam)
const typeSrc = read("packages/remotion/src/creative/contract.ts");
const dataBlock = /export type CreativeData = \{([\s\S]*?)\n\};/.exec(typeSrc)![1];
const keys = [...dataBlock.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
assert.ok(keys.length >= 9, `field CreativeData terbaca (${keys.length})`);
for (const k of keys) assert.ok(contract.includes(`${k}:`), `contract.md memuat field ${k}`);
for (const t of ["CreativeProps", "CreativeVideoStyle", "CreativeWord"]) assert.ok(contract.includes(t));

// ---- kode sah (termasuk pola yang rawan salah tolak) lolos
const good: Record<string, string> = {
  sample: SAMPLE_OVERLAY,
  sampleVideo: SAMPLE_VIDEO,
  cssTop: `import React from "react"; export default function O() { return <div style={{ position: "absolute", top: 100, left: 20 }}>hai</div>; }`,
  reactHooks: `import React, { useMemo } from "react"; import { useCurrentFrame } from "remotion"; export default function O() { const f = useCurrentFrame(); const v = useMemo(() => f * 2, [f]); return <div>{v}</div>; }`,
  indexAngka: `export default function v(frame: number, d: { joins: number[] }) { const j = d.joins[0] ?? 0; return { opacity: Math.min(1, frame / 30 + j) }; }`,
  typographic: `export default function O() { return <div>“halo” — ya</div>; }`,
};
for (const [name, code] of Object.entries(good)) assert.deepEqual(checkScope(code), [], `${name} harus lolos`);

// ---- kode buruk ditolak, termasuk celah yang dulu lolos (alias, re-export, string disusun)
const bad: Record<string, string> = {
  aliasWindow: `export default function v() { const w = window; return {}; }`,
  aliasFunction: `export default function v() { const F = Function; return {}; }`,
  aliasEval: `export default function v() { const e = eval; return {}; }`,
  globalThis: `export default function v() { return globalThis.x; }`,
  reexportFs: `export { readFileSync } from "fs"; export default function v() { return {}; }`,
  reexportAll: `export * from "node:child_process"; export default function v() { return {}; }`,
  sideEffectImport: `import "evil"; export default function v() { return {}; }`,
  stringKey: `export default function v() { return {}["cons" + "tructor"]; }`,
  templateKey: "export default function v(a: any) { return a[`x`]; }",
  fromCharCode: `export default function v() { return String.fromCharCode(99); }`,
  hexEscape: `export default function v() { return "\\x66"; }`,
  unicodeEscape: `export default function v() { return "\\u0066etch"; }`,
  getProto: `export default function v() { return Object.getPrototypeOf({}); }`,
  reflect: `export default function v() { return Reflect.ownKeys({}); }`,
  proxy: `export default function v() { return new Proxy({}, {}); }`,
  thisUse: `export default function v() { return this; }`,
  argumentsUse: `export default function v() { return arguments; }`,
  importMeta: `export default function v() { return import.meta; }`,
  dateNow: `export default function v() { return { opacity: Date.now() }; }`,
  newDate: `export default function v() { return { opacity: new Date().getTime() }; }`,
  sendBeacon: `export default function v() { return navigator.sendBeacon("x"); }`,
  proto: `export default function v() { return {}.__proto__; }`,
  moduleExports: `module.exports = 1; export default 1;`,
  importAliasRemotion: `import { staticFile as s } from "remotion"; export default function v() { return {}; }`,
};
for (const [name, code] of Object.entries(bad)) {
  assert.ok(checkScope(code).length > 0, `${name} harus ditolak oleh checkScope`);
  assert.equal(compileCreative(code).ok, false, `${name} harus ditolak oleh compileCreative`);
}
// pesan menyebut aturan yang dilanggar agar AI bisa memperbaiki
const msg = compileCreative(`export default function v() { const w = window; return {}; }`);
assert.ok(!msg.ok && /akses DOM\/global/.test(msg.error));

// ---- style.creativeId: hanya uuid yang bertahan; project lama tidak berubah bentuk
const id = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
assert.equal(normalizeStyle({ creativeId: id }).creativeId, id.toLowerCase());
assert.equal("creativeId" in normalizeStyle({ creativeId: "bukan-uuid" } as never), false);
assert.equal("creativeId" in normalizeStyle({ creativeId: 5 } as never), false);
assert.equal("creativeId" in normalizeStyle({}), false, "tanpa creativeId, kunci tidak muncul");
assert.equal("creativeId" in normalizeStyle(null), false);
assert.equal(normalizeStyle(normalizeStyle({ creativeId: id })).creativeId, id.toLowerCase(), "normalisasi idempoten");

// ---- tipe bersama
assert.ok(JobType.options.includes("creative"));
assert.deepEqual([...CreativeStatus.options].sort(), ["aktif", "ditolak", "draft", "gagal"]);

// ---- migrasi tidak lepas dari konstanta dan tipe
const sql = read("supabase/migrations/20261028120000_fase9_kreatif.sql");
assert.match(sql, /create table if not exists public\.creative_versions/);
assert.match(sql, /jobs_type_check[\s\S]*'creative'/);
assert.match(sql, /creative_versions_one_active[\s\S]*where status = 'aktif'/);
assert.match(sql, /enable row level security/);
for (const s of CreativeStatus.options) assert.ok(sql.includes(`'${s}'`), `migrasi memuat status ${s}`);
// Batas ukuran kode dinaikkan di migrasi Fase 15 (constraint nama bawaan Postgres diganti); yang terakhir harus = config
const sql15 = read("supabase/migrations/20261030120000_fase15_kode_kreatif_200kb.sql");
assert.match(sql15, /drop constraint if exists creative_versions_code_overlay_check/);
const limits = [...sql15.matchAll(/octet_length\(code_\w+\) <= (\d+)/g)].map((m) => Number(m[1]));
assert.equal(limits.length, 2);
for (const l of limits) assert.equal(l, CREATIVE.maxCodeBytes, "batas ukuran kode di SQL = CREATIVE.maxCodeBytes");
for (const col of ["id", "project_id", "prompt", "model", "code_overlay", "code_video", "replaces_captions", "notes", "stills", "status", "error", "duration_ms", "created_at"]) {
  assert.ok(new RegExp(`^\\s+${col}\\s`, "m").test(sql), `kolom ${col} ada di migrasi`);
}

console.log(`creative-contract.test: contract.md sinkron dengan validator, ${Object.keys(bad).length} pola buruk ditolak, ${Object.keys(good).length} pola sah lolos, creativeId, migrasi passed`);
