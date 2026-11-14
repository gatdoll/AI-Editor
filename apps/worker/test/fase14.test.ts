// Fase 14: efek suara (SFX). Normalisasi isyarat, pencarian pustaka, sfx.json dari AI Kreatif, props komposisi
// (cut, volume master), operasi Mode Cepat add_sfx/clear_sfx, dan kontrak AI. Jalankan: node apps/worker/test/fase14.test.ts
import assert from "node:assert/strict";
import { SFX, STYLES } from "../../../config/index.ts";
import { findSfx, normalizeCues, normalizeStyleSfx, parseSfxFile, type SfxItem } from "../../../packages/shared/src/sfx.ts";
import { buildSfxProps } from "../../../packages/remotion/src/sfx-props.ts";
import { toFrameSegments } from "../../../packages/remotion/src/frames.ts";
import { buildEditedProps, DEFAULT_STYLE, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { buildMotionProps } from "../../../packages/remotion/src/motion-props.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { normalizeOps, LLM_OPS_SCHEMA } from "../../../packages/shared/src/ops.ts";
import { planEffects } from "../src/prompt/effects.ts";
import { buildOpsPrompt } from "../src/prompt/translate.ts";
import { unchangedFromBase } from "../src/creative/loop.ts";

const lib: SfxItem[] = [
  { id: "b-whoosh", name: "whoosh", tags: ["transisi", "swoosh"], file: "sfx/bawaan/whoosh.mp3", mime: "audio/mpeg", durationS: 0.6, source: "bawaan" },
  { id: "b-pop", name: "pop", tags: ["muncul", "ui"], file: "sfx/bawaan/pop.ogg", mime: "audio/ogg", durationS: 0.2, source: "bawaan" },
  { id: "b-impact-berat", name: "impact-berat", tags: ["impact", "hit"], file: "sfx/bawaan/impact-berat.ogg", mime: "audio/ogg", durationS: 0.9, source: "bawaan" },
];

// ---- pencarian pustaka: id > nama persis > nama mengandung > tag
assert.equal(findSfx(lib, "b-pop")?.id, "b-pop");
assert.equal(findSfx(lib, "WHOOSH")?.id, "b-whoosh");
assert.equal(findSfx(lib, "impact")?.id, "b-impact-berat", "nama mengandung");
assert.equal(findSfx(lib, "transisi")?.id, "b-whoosh", "tag");
assert.equal(findSfx(lib, "kucing"), undefined);
assert.equal(findSfx(lib, "  "), undefined);

// ---- normalisasi isyarat
{
  const r = normalizeCues([{ id: "b-pop", at: 2 }, { sound: "b-whoosh", at: 1, volume: 3 }, { id: "b-pop", at: 2.05 }, { id: "b-pop", at: 99 }, { at: 1 }], 10);
  assert.deepEqual(r.cues, [{ id: "b-whoosh", at: 1, volume: 1 }, { id: "b-pop", at: 2, volume: 1 }], "urut, volume dijepit, alias sound");
  assert.equal(r.dropped.length, 3, "terlalu rapat, di luar durasi, tanpa suara");
  const many = normalizeCues(Array.from({ length: SFX.maxCues + 5 }, (_, i) => ({ id: "b-pop", at: i })), 1000);
  assert.equal(many.cues.length, SFX.maxCues, "batas jumlah isyarat");
  assert.equal(normalizeCues([{ id: "x", at: 1 }], 10, (id) => id.startsWith("b-")).cues.length, 0, "suara tak dikenal dibuang");
  assert.deepEqual(normalizeStyleSfx({ cues: [{ id: "b-pop", at: 1 }], useCreative: false }), { cues: [{ id: "b-pop", at: 1, volume: 1 }], useCreative: false });
  assert.equal(normalizeStyleSfx(null), undefined);
  assert.equal("sfx" in normalizeStyle({}), false, "project lama tanpa SFX tidak berubah");
}

// ---- sfx.json dari AI Kreatif
{
  assert.deepEqual(parseSfxFile(undefined, lib, 10), { cues: [], errors: [], dropped: [] }, "tanpa sfx.json = tanpa SFX");
  assert.match(parseSfxFile("{rusak", lib, 10).errors[0], /bukan JSON/);
  assert.match(parseSfxFile('{"a":1}', lib, 10).errors[0], /array/);
  assert.match(parseSfxFile('[{"sound":"laser","at":1}]', lib, 10).errors[0], /laser/, "suara di luar pustaka dikembalikan ke AI");
  const ok = parseSfxFile('[{"sound":"whoosh","at":1.25,"volume":0.8},{"sound":"pop","at":3.4},{"sound":"pop","at":30}]', lib, 10);
  assert.deepEqual(ok.cues, [{ id: "b-whoosh", at: 1.25, volume: 0.8 }, { id: "b-pop", at: 3.4, volume: 1 }], "nama -> id pustaka");
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.dropped.length, 1, "di luar durasi hanya dibuang + dicatat");
  assert.equal(parseSfxFile('{"cues":[{"sound":"pop","at":1}]}', lib, 10).cues.length, 1, "bentuk {cues} juga diterima");
}

// ---- props komposisi: waktu sumber -> frame hasil, cut, master
{
  const fps = 30;
  // dipertahankan 0–2 dan 4–6 dtk; 2–4 dipotong
  const segs = toFrameSegments([{ start: 0, end: 2 }, { start: 4, end: 6 }], fps, 6);
  const style = { params: {}, sfx: { cues: [{ id: "b-pop", at: 1, volume: 1 }, { id: "b-pop", at: 3, volume: 1 }, { id: "b-whoosh", at: 5, volume: 0.5 }], useCreative: true } };
  const p = buildSfxProps({ style, frameSegs: segs, fps, durationS: 4, srcFor: (id) => `u/${id}` });
  assert.deepEqual(p.map((x) => x.from), [30, 90], "isyarat di bagian terpotong tidak bunyi; 5 dtk sumber = 3 dtk hasil");
  assert.equal(p[0].volume, SFX.defaultMaster, "volume x master bawaan");
  assert.equal(p[1].volume, 0.5 * SFX.defaultMaster);
  assert.equal(p[0].src, "u/b-pop");
  // Tiap SFX punya panjang terbatas: Sequence tanpa panjang tetap terpasang sampai akhir dan menghabiskan slot audio Player
  assert.equal(p[0].frames, Math.ceil(SFX.fallbackLenS * fps) + 2, "tanpa durasi pustaka = fallback");
  const sized = buildSfxProps({ style, frameSegs: segs, fps, durationS: 4, lengthFor: (id) => lib.find((x) => x.id === id)?.durationS });
  assert.deepEqual(sized.map((x) => x.frames), [Math.ceil(0.2 * fps) + 2, Math.ceil(0.6 * fps) + 2], "panjang = durasi suara");
  assert.equal(buildSfxProps({ style, frameSegs: segs, fps, durationS: 4, lengthFor: () => 999 })[0].frames, Math.ceil(SFX.maxLenS * fps) + 2, "dibatasi maxLenS");
  assert.equal(buildSfxProps({ style: { ...style, params: { "audio.sfx": 0 } }, frameSegs: segs, fps, durationS: 4 }).length, 0, "master 0 = semua SFX mati");
  const withCreative = buildSfxProps({ style: { params: { "audio.sfx": 1 }, sfx: { cues: [], useCreative: true } }, creativeSfx: [{ id: "b-impact-berat", at: 3.5, volume: 1 }], frameSegs: segs, fps, durationS: 4 });
  assert.deepEqual(withCreative.map((x) => [x.id, x.from, x.volume]), [["b-impact-berat", 105, 1]], "isyarat kreatif sudah waktu hasil");
  assert.equal(buildSfxProps({ style: { params: {}, sfx: { cues: [], useCreative: false } }, creativeSfx: [{ id: "b-pop", at: 1, volume: 1 }], frameSegs: segs, fps, durationS: 4 }).length, 0, "SFX kreatif bisa dimatikan");
  assert.equal(buildSfxProps({ style: { params: {} }, frameSegs: null, fps, durationS: 4 }).length, 0);
  assert.equal(buildSfxProps({ style: { params: {}, sfx: { cues: [{ id: "b-pop", at: 1, volume: 1 }], useCreative: true } }, frameSegs: null, fps, durationS: 4 })[0].src, "/api/sfx/b-pop/file", "pratinjau memakai rute web");
}

// ---- buildEditedProps: SFX gaya + SFX versi kreatif (ikut kode kreatif saja)
{
  const words = [{ text: "halo", start: 0.2, end: 0.6 }];
  const style = normalizeStyle({ ...DEFAULT_STYLE, sfx: { cues: [{ id: "b-pop", at: 0.5, volume: 1 }], useCreative: true } } as never);
  const base = { segments: [{ start: 0, end: 3 }], source: { width: 1920, height: 1080, fps: 30, durationS: 3 }, words, style, seed: 1 };
  assert.deepEqual(buildEditedProps(base).props.sfx?.map((x) => x.id), ["b-pop"]);
  assert.equal(buildEditedProps({ ...base, style: DEFAULT_STYLE }).props.sfx, undefined, "tanpa isyarat = tanpa props sfx");
  const creative = { overlay: "export default () => null", replacesCaptions: false, sfx: [{ id: "b-whoosh", at: 2, volume: 1 }] };
  assert.deepEqual(buildEditedProps({ ...base, creative }).props.sfx?.map((x) => x.id), ["b-pop", "b-whoosh"], "SFX versi kreatif ikut");
  assert.deepEqual(buildEditedProps({ ...base, creative: null, creativeSfx: [{ id: "b-whoosh", at: 2, volume: 1 }] }).props.sfx?.map((x) => x.id), ["b-pop"], "tanpa kode kreatif, SFX-nya tidak bunyi");
}

// ---- motion: waktu = waktu hasil
{
  const style = normalizeStyle({ sfx: { cues: [{ id: "b-pop", at: 1, volume: 1 }], useCreative: true } } as never);
  const p = buildMotionProps({ aspect: "16:9", settings: { durationS: 5 }, colors: STYLES.bersih.colors, materials: [], srcFor: (id) => id, sfx: { style, creativeSfx: [{ id: "b-whoosh", at: 2, volume: 1 }], srcFor: (id) => `sfx:${id}` } });
  assert.deepEqual(p.sfx?.map((x) => [x.src, x.from]), [["sfx:b-pop", 30], ["sfx:b-whoosh", 60]]);
  assert.equal(buildMotionProps({ aspect: "16:9", settings: { durationS: 5 }, colors: STYLES.bersih.colors, materials: [], srcFor: (id) => id }).sfx, undefined, "still/brief tanpa SFX");
}

// ---- Mode Cepat: operasi add_sfx / clear_sfx
{
  assert.ok((LLM_OPS_SCHEMA.properties.ops.items.required as readonly string[]).includes("sound"), "skema CLI memuat sound");
  const n = normalizeOps([
    { type: "add_sfx", sound: "whoosh", phrase: "dashboard", startS: null, volume: 0.7 },
    { type: "add_sfx", sound: "pop", phrase: null, startS: 1.5, volume: null },
    { type: "add_sfx", sound: "pop", phrase: null, startS: null, volume: null },
    { type: "add_sfx", sound: "pop", phrase: "x", startS: 2, volume: null },
    { type: "clear_sfx" },
  ]);
  assert.equal(n.ops.length, 3);
  assert.equal(n.rejected.length, 2, "add_sfx butuh phrase ATAU startS");

  const words = "buka dashboard lalu klik dashboard sekali lagi".split(" ").map((text, i) => ({ text, start: 1 + i * 0.5, end: 1.4 + i * 0.5, confidence: 0.9 }));
  const ctx = { words, durationS: 6, style: DEFAULT_STYLE, existing: [], getSilences: async () => [], sfxLibrary: lib };
  let fx = await planEffects(n.ops.slice(0, 2), ctx);
  const cues = fx.style!.sfx!.cues;
  assert.deepEqual(cues.map((c) => [c.id, c.at]), [["b-whoosh", 1.5], ["b-whoosh", 3]], "whoosh di dua 'dashboard'; pop 1.5 dtk terlalu rapat dengan whoosh -> dilewati");
  assert.match(fx.messages[0], /2 isyarat/);
  assert.match(fx.messages[1], /tidak ditambahkan/);
  assert.equal(cues[0].volume, 0.7);

  fx = await planEffects([{ type: "add_sfx", sound: "laser", startS: 1 }], ctx);
  assert.equal(fx.style, null);
  assert.match(fx.messages[0], /tidak ada di pustaka/);
  fx = await planEffects([{ type: "add_sfx", sound: "pop", phrase: "kucing" }], ctx);
  assert.match(fx.messages[0], /Tidak menemukan/);
  fx = await planEffects([{ type: "add_sfx", sound: "pop", startS: 60 }], ctx);
  assert.match(fx.messages[0], /di luar video/);

  const withSfx = normalizeStyle({ ...DEFAULT_STYLE, sfx: { cues: [{ id: "b-pop", at: 1, volume: 1 }], useCreative: true } } as never);
  fx = await planEffects([{ type: "clear_sfx" }], { ...ctx, style: withSfx });
  assert.deepEqual(fx.style?.sfx, { cues: [], useCreative: false }, "hapus semua SFX + matikan SFX kreatif");
  assert.match(fx.messages[0], /1 SFX dihapus/);

  const prompt = buildOpsPrompt("tambah whoosh", { durationS: 6, wordCount: 7, style: { styleId: "bersih", aspect: "16:9", camera: true, captions: true, effects: true, cameraOverrides: 0, params: {} }, pending: 0, approved: 0, sfx: lib.map((x) => ({ name: x.name, tags: x.tags })) });
  assert.match(prompt, /PUSTAKA SFX: whoosh \(transisi, swoosh\); pop/);
  assert.match(prompt, /add_sfx:/);
  assert.doesNotMatch(prompt, /musik\/SFX,/, "SFX tidak lagi disebut belum didukung");
  assert.match(buildOpsPrompt("x", { durationS: 6, wordCount: 0, style: { styleId: "bersih", aspect: "16:9", camera: true, captions: true, effects: true, cameraOverrides: 0, params: {} }, pending: 0, approved: 0 }), /PUSTAKA SFX: kosong/);
}

// ---- kontrak AI Kreatif + pembanding versi dasar
{
  const c = buildContract();
  assert.match(c, /sfx\.json/);
  assert.match(c, /sfxLibrary/);
  assert.match(c, new RegExp(`maksimal ${SFX.maxCues} isyarat`));
  assert.match(buildContract({ motion: true }), /sfx\.json/);
  const base = { overlay: "a", notes: "", replacesCaptions: false, sfx: '[{"sound":"pop","at":1}]' };
  assert.equal(unchangedFromBase({ ...base }, base), true);
  assert.equal(unchangedFromBase({ ...base, sfx: '[{"sound":"pop","at":2}]' }, base), false, "revisi yang hanya mengubah SFX tetap dianggap perubahan");
}

console.log("fase14: semua tes lolos");
