// Fase 18: klip motion penutup (CTA) sesudah video. Durasi hasil bertambah; segmen, subtitle, kamera tidak berubah.
// Jalankan: node apps/worker/test/fase18.test.ts
import assert from "node:assert/strict";
import { END_CLIP } from "../../../config/index.ts";
import { buildEditedProps, DEFAULT_STYLE, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { clampEndClipSeconds, normalizeEndClip } from "../../../packages/remotion/src/motion-props.ts";

const V = "aaaaaaaa-0000-4000-8000-000000000001";
const source = { width: 1920, height: 1080, fps: 30, durationS: 10 };
const segments = [{ start: 0, end: 4 }, { start: 6, end: 10 }];
const words = [{ text: "halo", start: 1, end: 1.5 }, { text: "dunia", start: 7, end: 7.5 }];
const base = { segments, source, words, seed: 1 };
const code = { overlay: "export default () => null;", replacesCaptions: false };

// ---- normalisasi
assert.equal(clampEndClipSeconds("abc"), null);
assert.equal(clampEndClipSeconds(1), END_CLIP.seconds.min, "dijepit ke minimum");
assert.equal(clampEndClipSeconds(999), END_CLIP.seconds.max, "dijepit ke maksimum");
assert.equal(clampEndClipSeconds(5.2), 5, "dibulatkan ke langkah 0,5");
assert.equal(normalizeEndClip({ seconds: 5 }), undefined, "tanpa versi = tidak ada klip");
assert.equal(normalizeEndClip({ seconds: 5, versionId: "x" }), undefined);
assert.deepEqual(normalizeEndClip({ seconds: 5, versionId: V.toUpperCase() }), { seconds: 5, versionId: V });
assert.ok(!("endClip" in normalizeStyle({})), "project lama tidak mendapat kunci baru");
const withEnd = normalizeStyle({ ...DEFAULT_STYLE, endClip: { seconds: 5, versionId: V } });
assert.deepEqual(withEnd.endClip, { seconds: 5, versionId: V });

// ---- durasi bertambah di ujung, isi video tidak berubah
const plain = buildEditedProps({ ...base, style: normalizeStyle(DEFAULT_STYLE) });
const built = buildEditedProps({ ...base, style: withEnd, endClip: code });
assert.equal(plain.durationInFrames, 240);
assert.equal(built.durationInFrames, 240 + 150, "video 8 dtk + klip 5 dtk");
assert.equal(built.props.endClip?.frames, 150);
assert.equal(built.props.endClip?.overlay, code.overlay);
assert.deepEqual(built.props.segments, plain.props.segments, "EDL tidak berubah");
assert.deepEqual(built.props.pages, plain.props.pages, "subtitle tidak bergeser");
assert.deepEqual(built.props.camera, plain.props.camera, "rencana kamera tidak berubah");

// ---- kode belum/gagal dimuat: tidak ada klip kosong
const noCode = buildEditedProps({ ...base, style: withEnd, endClip: null });
assert.equal(noCode.durationInFrames, 240);
assert.equal(noCode.props.endClip, undefined);

// ---- SFX klip digeser ke ujung video, isyarat edit tidak digandakan
const sfxBuilt = buildEditedProps({ ...base, style: { ...withEnd, sfx: { cues: [{ id: "whoosh", at: 1, volume: 1 }], useCreative: true } }, endClip: { ...code, sfx: [{ id: "ding", at: 1, volume: 1 }] } });
const ids = (sfxBuilt.props.sfx ?? []).map((c) => `${c.id}@${c.from}`);
assert.deepEqual(ids, ["whoosh@30", "ding@270"], `isyarat: ${ids.join(",")}`);

// ---- gambar klip memakai daftar yang sama dengan pemanggil
const assets = [{ id: V, name: "logo.png", type: "image" as const, src: "/logo" }];
assert.deepEqual(buildEditedProps({ ...base, style: withEnd, endClip: code, creativeAssets: assets }).props.endClip?.assets, assets);

console.log("fase18: lulus");
