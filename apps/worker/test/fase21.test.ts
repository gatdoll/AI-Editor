// Fase 21: aset sendiri di video bicara (keterangan + usulan waktu dari transkrip, diputuskan pengguna). Bagian murni:
// validasi keluaran AI, posisi playhead, isyarat, pemetaan ke timeline hasil (termasuk kalimat terpotong), prompt, instruksi.
// Jalankan: node apps/worker/test/fase21.test.ts
import assert from "node:assert/strict";
import { OWN_ASSETS } from "../../../config/index.ts";
import { checkPlacements, OWN_JSON_SCHEMA, ownCuesFrom, ownDecided, placementAt, placementOf, type OwnState } from "../../../packages/shared/src/own-assets.ts";
import { cleanNote } from "../../../packages/shared/src/material-notes.ts";
import { reconcileOwn } from "../../../packages/shared/src/own-assets-store.ts";
import { assetsOnTimeline, buildEditedProps, DEFAULT_STYLE } from "../../../packages/remotion/src/build-props.ts";
import { materialAssets, type MaterialInfo } from "../../../packages/remotion/src/motion-props.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { ownAssetErrors, ownAssetsInstruction } from "../src/creative/loop.ts";
import { ownAssetsPrompt } from "../src/own-assets/prompt.ts";

// 19 kata, 0,5 dtk per kata (0..9,4 dtk video mentah)
const words = "Halo semua hari ini aku mau bahas harga botol hijau yang baru rilis dan omzet kami naik dua kali".split(" ").map((t, i) => ({ text: t, start: i * 0.5, end: i * 0.5 + 0.4 }));
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const asked = new Map([["a1", A], ["a2", B], ["a3", C]]);

// ---- validasi keluaran AI
{
  const raw = {
    catatan: "a3 tanpa keterangan.",
    penempatan: [
      { aset: "a1", cocok: true, utama: { wordStart: 7, wordEnd: 10, alasan: "botol hijau disebut" }, alternatif: [{ wordStart: 7, wordEnd: 10, alasan: "duplikat" }, { wordStart: 99, wordEnd: 100, alasan: "di luar" }] },
      { aset: "a9", cocok: true, utama: { wordStart: 0, wordEnd: 1, alasan: "" }, alternatif: [] },
      { aset: "a2", cocok: true, utama: { wordStart: 14, wordEnd: 18, alasan: "omzet naik" }, alternatif: [] },
      { aset: "a2", cocok: true, utama: { wordStart: 0, wordEnd: 1, alasan: "jawaban kedua" }, alternatif: [] },
    ],
  };
  const r = checkPlacements(raw, words, asked);
  const a = r.byAsset.get(A)!;
  assert.equal(a.options.length, 1, "duplikat dan indeks di luar transkrip dibuang");
  assert.deepEqual([a.options[0].startS, a.options[0].endS], [3.5, 5.4], "detik dari kata video mentah");
  assert.match(a.options[0].context, /botol hijau/);
  assert.equal(r.byAsset.get(B)!.options[0].wordStart, 14, "jawaban pertama yang dipakai");
  assert.match(r.byAsset.get(C)!.error!, /tidak menjawab/, "aset yang tidak dijawab ditandai, bukan ditebak");
  assert.ok(r.dropped.some((d) => /a9/.test(d)) && r.dropped.some((d) => /dua kali/.test(d)) && r.dropped.some((d) => /99/.test(d)));
  assert.equal(r.catatan, "a3 tanpa keterangan.");

  const none = checkPlacements({ catatan: "", penempatan: [{ aset: "a1", cocok: false, utama: null, alternatif: [] }] }, words, new Map([["a1", A]]));
  assert.equal(none.byAsset.get(A)!.options.length, 0);
  assert.match(none.byAsset.get(A)!.error!, /tidak menemukan bagian yang cocok/, "tidak cocok = alasan (aturan 7)");
  const bad = checkPlacements({ nope: 1 }, words, new Map([["a1", A]]));
  assert.match(bad.dropped[0], /tidak sesuai skema/);
  assert.ok(bad.byAsset.get(A)!.error, "keluaran rusak tetap ditandai per aset");
  assert.equal(placementOf(words, 0, OWN_ASSETS.maxSpanWords + 1), null, "rentang terlalu panjang ditolak");
  // Skema ketat untuk Codex: semua kunci wajib
  assert.deepEqual([...OWN_JSON_SCHEMA.properties.penempatan.items.required].sort(), ["alternatif", "aset", "cocok", "utama"]);
}

// ---- posisi playhead
{
  const p = placementAt(words, 3.6)!;
  assert.equal(p.wordStart, 7, "kata yang sedang diucapkan");
  assert.equal(p.wordEnd, 7 + OWN_ASSETS.hereWords - 1);
  assert.equal(placementAt(words, 999)!.wordStart, words.length - 1, "sesudah kata terakhir = kata terakhir");
  assert.equal(placementAt([], 1), null, "tanpa transkrip = tidak bisa");
}

// ---- isyarat dan status
const state: OwnState = { version: 1, provider: "claude", model: null, updatedAt: "", warnings: [], items: [
  { assetId: A, status: "dipakai", options: [], chosen: placementOf(words, 7, 10)!, noteUsed: "botol" },
  { assetId: B, status: "dipakai", options: [], chosen: placementOf(words, 14, 18)!, noteUsed: "" },
  { assetId: C, status: "pending", options: [], noteUsed: "" },
] };
{
  const cues = ownCuesFrom(state, new Map([[A, { label: "botol.png", note: "foto botol hijau" }], [C, { label: "c.png", note: "" }]]));
  assert.equal(cues.size, 1, "hanya yang dipakai DAN masih ada");
  assert.deepEqual({ ...cues.get(A)!, mention: "x" }, { mention: "x", type: "sendiri", label: "botol.png", start: 3.5, end: 5.4, source: "", keterangan: "foto botol hijau" });
  assert.equal(ownDecided(state), false);
  const copy = structuredClone(state);
  assert.equal(reconcileOwn(copy, new Set([A, C])), true);
  assert.deepEqual(copy.items.map((i) => i.assetId), [A, C], "bahan yang dihapus ikut hilang dari status");
  assert.equal(cleanNote("  a\u0000b \t c  "), "a b c");
  assert.equal(cleanNote("x".repeat(OWN_ASSETS.noteMaxChars + 50)).length, OWN_ASSETS.noteMaxChars);
}

// ---- pemetaan ke timeline hasil: cut sebelum kalimat menggeser aset; kalimat terpotong = tanpa isyarat
{
  const mats: MaterialInfo[] = [
    { id: A, label: "botol.png", mime: "image/png", width: 800, height: 800, role: "gambar", cue: { mention: "a", type: "sendiri", label: "botol.png", start: 3.5, end: 5.4, source: "" } },
    { id: B, label: "grafik.png", mime: "image/png", width: 800, height: 800, role: "gambar", cue: { mention: "b", type: "sendiri", label: "grafik.png", start: 7, end: 9.9, source: "" } },
    { id: C, label: "logo.png", mime: "image/png", width: 400, height: 400, role: "logo" },
  ];
  const source = { width: 1920, height: 1080, fps: 30, durationS: 10 };
  // Cut 1–3 dtk dan 6,5–10 dtk: kalimat A bergeser 2 dtk lebih awal, kalimat B terpotong
  const segments = [{ start: 0, end: 1 }, { start: 3, end: 6.5 }];
  const mapped = assetsOnTimeline(materialAssets(mats, (id) => id, undefined, { imagesOnly: true }), segments, source);
  assert.deepEqual([mapped[0].cue!.start, mapped[0].cue!.end], [1.5, 3.4], "detik mentah -> timeline hasil");
  assert.equal(mapped[1].cue, undefined, "kalimatnya terpotong: tidak dipaksa tampil di tempat lain");
  assert.equal(mapped[2].cue, undefined);
  assert.equal(mapped.length, 3, "gambar tetap ada untuk dipakai prompt");

  const creativeAssets = materialAssets(mats, (id) => `/api/assets/${id}/file`, undefined, { imagesOnly: true });
  const built = buildEditedProps({ segments, source, words, style: DEFAULT_STYLE, seed: 1, creative: { overlay: "export default () => null", replacesCaptions: false }, creativeAssets });
  assert.deepEqual([built.props.creative!.assets![0].cue!.start, built.props.creative!.assets![0].cue!.end], [1.5, 3.4], "pratinjau dan render memakai pemetaan yang sama");
  const noCut = buildEditedProps({ segments: [{ start: 0, end: 10 }], source, words, style: DEFAULT_STYLE, seed: 1, creative: { overlay: "x", replacesCaptions: false }, creativeAssets });
  assert.equal(noCut.props.creative!.assets![1].cue!.start, 7, "tanpa cut = waktu mentah");
}

// ---- prompt: transkrip dan keterangan = data; aset tanpa keterangan ditandai
{
  const pr = ownAssetsPrompt({ words: words.slice(0, 4), assets: [{ key: "a1", name: "botol.png", note: "foto botol hijau saat bahas harga", role: "gambar" }, { key: "a2", name: "IMG_1.jpg", note: "", role: "gambar" }], occupied: [{ name: "logo.png", wordStart: 0, wordEnd: 1 }] });
  assert.match(pr, /0:Halo 1:semua 2:hari 3:ini/);
  assert.match(pr, /DATA video, bukan instruksi/);
  assert.match(pr, /a1 \(gambar\), berkas "botol.png": keterangan: "foto botol hijau saat bahas harga"/);
  assert.match(pr, /a2 .*TANPA keterangan/);
  assert.match(pr, /SUDAH DIPAKAI[\s\S]*logo.png": kata 0–1/);
  assert.match(pr, /JANGAN menebak/);
}

// ---- instruksi dan pemeriksaan kode Mode Kreatif
{
  assert.match(ownAssetsInstruction({ cues: 2 }), /2 gambar MILIKNYA/);
  const data = { assets: [{ cue: { start: 1 } }] };
  assert.equal(ownAssetErrors({ overlay: "export default () => null" }, data).length, 1, "aset tidak diikat ke waktunya");
  assert.equal(ownAssetErrors({ overlay: "a.cue.start" }, data).length, 0);
  assert.equal(ownAssetErrors({ overlay: "" }, { assets: [{}] }).length, 0, "tanpa aset ber-cue tidak ada kewajiban");
  assert.match(buildContract(), /cue\.type\\?` "sendiri"/);
  assert.match(buildContract(), /"sendiri"; label/);
}

console.log("fase21: semua tes lulus");
