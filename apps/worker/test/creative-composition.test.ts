// Fase 9.3: kode kreatif masuk ke props komposisi lewat SATU fungsi (pratinjau = render), dan pemuat versi tidak diam-diam.
import assert from "node:assert/strict";
import { buildCreativeTimeline, buildEditedProps, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { loadCreativeCode, syncActiveCreative } from "../../../packages/shared/src/creative-store.ts";
import { SAMPLE_OVERLAY, SAMPLE_VIDEO } from "../../../packages/remotion/src/creative/sample.ts";

const args = {
  segments: [{ start: 0, end: 2 }, { start: 3, end: 6 }],
  source: { width: 1920, height: 1080, fps: 30, durationS: 6 },
  words: [{ text: "satu", start: 0.5, end: 0.9 }, { text: "hilang", start: 2.2, end: 2.6 }, { text: "tiga", start: 3.5, end: 3.9 }],
  style: normalizeStyle({ aspect: "9:16", highlights: [{ startS: 3.4, endS: 4, effect: "aksen" }] }),
  seed: 1,
};

// ---- tanpa kode: tidak ada layer kreatif (props sama persis dengan sebelum Fase 9)
const plain = buildEditedProps(args);
assert.equal("creative" in plain.props, false);
assert.equal("creative" in buildEditedProps({ ...args, creative: null }).props, false);
assert.equal("creative" in buildEditedProps({ ...args, creative: { overlay: "", video: "" } }).props, false, "kode kosong = tanpa layer");

// ---- dengan kode: kata pada timeline HASIL (sama dengan yang diberikan ke AI di brief), opsi menggantikan subtitle
const withCode = buildEditedProps({ ...args, creative: { overlay: SAMPLE_OVERLAY, video: SAMPLE_VIDEO, replacesCaptions: true } });
const c = withCode.props.creative!;
assert.equal(c.overlay, SAMPLE_OVERLAY);
assert.equal(c.video, SAMPLE_VIDEO);
assert.equal(c.replacesCaptions, true);
assert.deepEqual(c.words, buildCreativeTimeline(args).words, "kata di props = kata di brief.json");
assert.deepEqual(c.words.map((w) => [w.text, w.start, w.hl]), [["satu", 0.5, undefined], ["tiga", 2.5, "aksen"]]);
assert.equal(buildEditedProps({ ...args, creative: { video: SAMPLE_VIDEO } }).props.creative!.replacesCaptions, false, "bawaan: subtitle bawaan tetap tampil");
// layer kreatif tidak mengubah apa pun yang lain (EDL, kamera, durasi). Subtitle bawaan yang digantikan dibuang dari
// pages di rentang kreatif (Fase 10; sebelumnya disembunyikan komposisi), jadi dibandingkan terpisah.
const { creative: _c, pages: replacedPages, ...rest } = withCode.props;
const { pages: plainPages, ...plainRest } = plain.props;
assert.deepEqual(rest, plainRest);
assert.ok(plainPages.length > 0 && replacedPages.length === 0, "subtitle bawaan digantikan di seluruh rentang kreatif");
const { creative: _v, ...videoOnly } = buildEditedProps({ ...args, creative: { video: SAMPLE_VIDEO, replacesCaptions: true } }).props;
assert.deepEqual(videoOnly, plain.props, "tanpa overlay tidak ada yang menggantikan subtitle");
assert.equal(withCode.durationInFrames, plain.durationInFrames);

// ---- pemuat versi: hilang / project lain / gagal / tanpa kode ditolak dengan pesan; versi sah dimuat
const P = "11111111-1111-1111-1111-111111111111";
const rows: Record<string, Record<string, unknown>> = {
  ok: { id: "ok", project_id: P, status: "draft", code_overlay: SAMPLE_OVERLAY, code_video: null, replaces_captions: true },
  lain: { id: "lain", project_id: "lain", status: "aktif", code_overlay: SAMPLE_OVERLAY, code_video: null, replaces_captions: false },
  gagal: { id: "gagal", project_id: P, status: "gagal", code_overlay: SAMPLE_OVERLAY, code_video: null, replaces_captions: false },
  kosong: { id: "kosong", project_id: P, status: "draft", code_overlay: null, code_video: null, replaces_captions: false },
};
const db = {
  from: (table: string) => {
    assert.equal(table, "creative_versions");
    let id = "";
    const q = { select: () => q, eq: (_k: string, v: string) => ((id = v), q), maybeSingle: async () => ({ data: rows[id] ?? null, error: null }) };
    return q;
  },
} as never;
const ok = await loadCreativeCode(db, P, "ok");
assert.ok(ok.ok && ok.code.overlay === SAMPLE_OVERLAY && ok.code.video === undefined && ok.code.replacesCaptions === true);
for (const [id, status, re] of [["tidakada", 404, /tidak ditemukan/], ["lain", 404, /tidak ditemukan/], ["gagal", 409, /gagal/], ["kosong", 409, /tidak punya kode/]] as const) {
  const r = await loadCreativeCode(db, P, id);
  assert.ok(!r.ok && r.httpStatus === status && re.test(r.error), `${id}: ${JSON.stringify(r)}`);
}

// ---- status aktif mengikuti style.creativeId: turunkan yang lain DULU (indeks unik satu aktif), baru naikkan
const ops: string[] = [];
const syncDb = {
  from: () => {
    const f: string[] = [];
    let patch = "";
    const q = {
      update: (p: { status: string }) => ((patch = p.status), q),
      eq: (k: string, v: string) => (f.push(`${k}=${v}`), q),
      neq: (k: string, v: string) => (f.push(`${k}!=${v}`), q),
      then: (res: (v: { error: null }) => void) => { ops.push(`${patch} ${f.join(",")}`); res({ error: null }); },
    };
    return q;
  },
} as never;
assert.equal(await syncActiveCreative(syncDb, P, "baru"), null);
assert.deepEqual(ops, [`draft project_id=${P},status=aktif,id!=baru`, `aktif id=baru,project_id=${P},status=draft`]);
ops.length = 0;
await syncActiveCreative(syncDb, P, undefined);
assert.deepEqual(ops, [`draft project_id=${P},status=aktif`], "dimatikan: semua turun ke draft, tidak ada yang dinaikkan");

console.log("creative-composition.test: props kreatif dari satu fungsi (kata timeline hasil, menggantikan subtitle, tidak mengubah props lain), pemuat versi menolak hilang/project lain/gagal/kosong passed");
