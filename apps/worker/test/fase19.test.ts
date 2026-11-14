// Fase 19: Opinion Motion (motion + aset internet pilihan pengguna). Bagian murni: validasi keluaran AI riset, isyarat aset,
// props/kontrak motion, pemeriksaan kode, prompt, dan batas path. Jalankan: node apps/worker/test/fase19.test.ts
import assert from "node:assert/strict";
import { OPINION } from "../../../config/index.ts";
import { allDecided, assetCues, checkResearch, contextOf, RESEARCH_JSON_SCHEMA, type Mention, type OpinionState } from "../../../packages/shared/src/opinion.ts";
import { isCandidatePath } from "../../../packages/shared/src/opinion-store.ts";
import { privateIp } from "../../../packages/shared/src/safe-url.ts";
import { buildMotionProps, motionCreativeData, motionSubtitleOn, normalizeMotion } from "../../../packages/remotion/src/motion-props.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { opinionErrors, opinionInstruction } from "../src/creative/loop.ts";
import { fullResearchPrompt, singleResearchPrompt, targetMentions } from "../src/opinion/research.ts";
import { wikimediaThumb } from "../src/opinion/fetch-image.ts";

const words = "Kemarin Sri Mulyani bilang APBN aman tetapi berita Kompas menyebut defisit naik tajam bulan ini".split(" ").map((t, i) => ({ text: t, start: i * 0.5, end: i * 0.5 + 0.4 }));

// ---- validasi keluaran AI
const raw = {
  catatan: "Foto Bank Dunia meragukan.",
  mentions: [
    { type: "berita", label: "Defisit naik", wordStart: 6, wordEnd: 12, query: "defisit APBN", images: [], article: { url: "https://www.kompas.com/a", title: "Defisit Naik", publisher: "Kompas", fokus: "kutipan", kutipan: "defisit naik tajam" } },
    { type: "tokoh", label: "Sri Mulyani", wordStart: 1, wordEnd: 2, query: "Sri Mulyani", images: [
      { imageUrl: "https://upload.wikimedia.org/a.jpg", pageUrl: "https://commons.wikimedia.org/x", alasan: "resmi" },
      { imageUrl: "https://upload.wikimedia.org/a.jpg", pageUrl: "", alasan: "duplikat" },
      { imageUrl: "javascript:alert(1)", pageUrl: "", alasan: "bukan http" },
      { imageUrl: "https://b.example/2.png", pageUrl: "", alasan: "" },
      { imageUrl: "https://b.example/3.png", pageUrl: "", alasan: "" },
      { imageUrl: "https://b.example/4.png", pageUrl: "", alasan: "" },
      { imageUrl: "https://b.example/5.png", pageUrl: "", alasan: "" },
    ], article: null },
    { type: "selebriti", label: "X", wordStart: 0, wordEnd: 0, query: "", images: [], article: null },
    { type: "tokoh", label: "Y", wordStart: 3, wordEnd: 99, query: "", images: [], article: null },
    { type: "berita", label: "Tanpa link", wordStart: 7, wordEnd: 8, query: "", images: [], article: { url: "ftp://x", title: "", publisher: "", fokus: "judul", kutipan: null } },
    { type: "brand", label: "APBN", wordStart: 3, wordEnd: 3, query: "", images: [], article: null },
    { type: "berita", label: "Fokus kutipan kosong", wordStart: 7, wordEnd: 8, query: "", images: [], article: { url: "https://detik.com/b", title: "B", publisher: "", fokus: "kutipan", kutipan: "" } },
  ],
};
const r = checkResearch(raw, words);
assert.deepEqual(r.mentions.map((m) => m.label), ["Sri Mulyani", "APBN", "Defisit naik", "Fokus kutipan kosong"], "urut menurut waktu ucap, yang tidak sah dibuang");
const sri = r.mentions[0];
assert.equal(sri.images.length, OPINION.maxCandidates, "kandidat dibatasi");
assert.equal(new Set(sri.images.map((i) => i.imageUrl)).size, sri.images.length, "URL ganda dibuang");
assert.ok(sri.images.every((i) => i.imageUrl.startsWith("https://")), "hanya http(s)");
assert.equal(sri.startS, words[1].start);
assert.equal(sri.endS, words[2].end);
assert.match(sri.context, /Sri Mulyani bilang/);
assert.ok(r.dropped.some((d) => /selebriti/.test(d)), "jenis tak dikenal dilaporkan");
assert.ok(r.dropped.some((d) => /indeks kata 3–99/.test(d)), "indeks di luar naskah dilaporkan");
assert.ok(r.dropped.some((d) => /Tanpa link/.test(d)), "berita tanpa link sah dibuang");
assert.ok(r.dropped.some((d) => /APBN.*URL gambar/.test(d)), "sebutan tanpa gambar tetap ada tapi dilaporkan");
const berita = r.mentions.find((m) => m.label === "Defisit naik")!;
assert.deepEqual(berita.article, { url: "https://www.kompas.com/a", title: "Defisit Naik", publisher: "Kompas", fokus: "kutipan", kutipan: "defisit naik tajam", sorot: true });
assert.equal(berita.images.length, 0, "berita tidak membawa gambar");
assert.equal(r.mentions.find((m) => m.label === "Fokus kutipan kosong")!.article!.fokus, "judul", "fokus kutipan tanpa kutipan = judul");
assert.equal(r.catatan, "Foto Bank Dunia meragukan.");
assert.equal(checkResearch({ nope: 1 }, words).mentions.length, 0);
assert.match(checkResearch({ nope: 1 }, words).dropped[0], /skema/);
assert.equal(contextOf(words, 0, 0, 2), "Kemarin Sri Mulyani…");

// ---- skema JSON: semua kunci wajib (Codex --output-schema mode ketat)
const strict = (o: { properties?: Record<string, unknown>; required?: readonly string[]; items?: unknown }): void => {
  if (o.properties) {
    assert.deepEqual([...(o.required ?? [])].sort(), Object.keys(o.properties).sort(), "semua properti wajib");
    for (const v of Object.values(o.properties)) strict(v as never);
  }
  if (o.items) strict(o.items as never);
};
strict(RESEARCH_JSON_SCHEMA as never);

// ---- isyarat aset: hanya yang dipilih, voice over sama
const cand = (id: string, source: string) => ({ id, kind: "gambar" as const, file: `projects/p/opini/kandidat/m1/${id}.jpg`, source });
const mention = (o: Partial<Mention>): Mention => ({ id: "m1", type: "tokoh", label: "Sri Mulyani", wordStart: 1, wordEnd: 2, startS: 0.5, endS: 1.4, context: "", query: "", candidates: [cand("a", "wikimedia.org")], status: "pending", ...o });
const state: OpinionState = { version: 1, voiceoverJobId: "vo1", brief: "", provider: "claude", model: null, updatedAt: "", warnings: [], mentions: [
  mention({ status: "dipilih", chosen: "a", assetId: "asset-1" }),
  mention({ id: "m2", status: "tidak-dipakai" }),
  mention({ id: "m3", type: "berita", status: "dipilih", chosen: "s", assetId: "asset-3", candidates: [{ id: "s", kind: "screenshot", file: "x.png", source: "Kompas", article: { url: "u", title: "Judul", publisher: "Kompas", date: null, fokus: "kutipan", kutipan: "k", sorot: true, kutipanDitemukan: false, catatan: [] } }] }),
] };
const cues = assetCues(state, "vo1");
assert.equal(cues.size, 2);
assert.deepEqual(cues.get("asset-1"), { mention: "m1", type: "tokoh", label: "Sri Mulyani", start: 0.5, end: 1.4, source: "wikimedia.org" });
assert.equal(cues.get("asset-3")!.article!.kutipanDitemukan, false, "kutipan tidak ditemukan diteruskan apa adanya");
assert.equal(assetCues(state, "vo-lain").size, 0, "voice over diganti = waktu kedaluwarsa, tidak ada isyarat");
assert.equal(allDecided(state), true);
assert.equal(allDecided({ ...state, mentions: [mention({})] }), false);
assert.equal(allDecided(null), false);

// ---- pengaturan + props motion
const mo = normalizeMotion({ durationS: 10, opini: true, kredit: false })!;
assert.equal(mo.opini, true);
assert.equal(mo.kredit, false);
assert.ok(!("opini" in normalizeMotion({ durationS: 10 })!), "motion lama tidak mendapat kunci baru");
assert.equal(motionSubtitleOn({ durationS: 8, opini: true }), true, "subtitle bawaan menyala untuk Opinion Motion");
assert.equal(motionSubtitleOn({ durationS: 8 }), false);
const colors = { text: "#fff", accent: "#f00", dark: "#000" };
const materials = [{ id: "asset-1", label: "Sri", mime: "image/jpeg", width: 800, height: 1000, role: "gambar" as const, cue: cues.get("asset-1") }, { id: "logo", label: "logo.png", mime: "image/png", role: "logo" as const }];
const props = buildMotionProps({ aspect: "9:16", settings: { durationS: 8, opini: true }, colors, materials, srcFor: (x) => `/f/${x}` });
assert.deepEqual(props.opini, { kredit: true, prefix: OPINION.credit.prefix }, "kredit bawaan menyala");
assert.deepEqual(props.assets[0].cue, cues.get("asset-1"));
assert.ok(!("cue" in props.assets[1]), "bahan biasa tanpa isyarat");
assert.deepEqual(motionCreativeData(props).opini, props.opini, "data brief AI = data komposisi");
assert.equal(buildMotionProps({ aspect: "9:16", settings: { durationS: 8, opini: true, kredit: false }, colors, materials, srcFor: (x) => x }).opini!.kredit, false);
assert.ok(!("opini" in buildMotionProps({ aspect: "9:16", settings: { durationS: 8 }, colors, materials: [], srcFor: (x) => x })));
assert.match(buildContract({ motion: true }), /opini: \{ kredit: boolean; prefix: string \}/, "kontrak AI memuat data.opini");
assert.match(buildContract({ motion: true }), /type AssetCue/);

// ---- pemeriksaan kode Opinion Motion
const data = { assets: props.assets, opini: { kredit: true, prefix: "Sumber: " } };
assert.equal(opinionErrors({ overlay: "export default () => null" }, data).length, 2, "tanpa cue dan tanpa kredit");
assert.equal(opinionErrors({ overlay: "a.cue.start; a.cue.source" }, data).length, 0);
assert.equal(opinionErrors({ overlay: "a.cue.start" }, { ...data, opini: { kredit: false, prefix: "" } }).length, 0, "kredit dimatikan = tidak wajib");
assert.equal(opinionErrors({ overlay: "" }, { assets: [], opini: data.opini }).length, 0, "tanpa aset ber-cue tidak ada kewajiban");
assert.match(opinionInstruction({ kredit: true, cues: 2 }), /KREDIT WAJIB/);
assert.match(opinionInstruction({ kredit: false, cues: 0 }), /dimatikan/);

// ---- prompt riset: data, bukan instruksi; indeks kata ikut
const fp = fullResearchPrompt({ script: "Naskah opini.", words: words.slice(0, 3), brief: "gelap" });
assert.match(fp, /0:Kemarin 1:Sri 2:Mulyani/);
assert.match(fp, /JANGAN menebak/);
// jumlah aset mengikuti durasi voice over (seimbang dengan motion), bukan angka tetap
assert.equal(targetMentions(120), 15, "2 menit = ±15 aset");
assert.equal(targetMentions(10), OPINION.density.min, "video pendek tetap punya minimum");
assert.equal(targetMentions(3600), OPINION.maxMentions, "dibatasi batas keras");
assert.match(fullResearchPrompt({ script: "x", words: [{ text: "a", start: 0, end: 0.5 }, { text: "b", start: 119, end: 120 }] }), /sekitar 15 entri/);
const sp = singleResearchPrompt({ mention: { type: "tokoh", label: "Sri Mulyani", query: "Sri Mulyani", wordStart: 1, wordEnd: 2, context: "…" }, userQuery: "Menteri Keuangan 2024" });
assert.match(sp, /wordStart 1, wordEnd 2/);
assert.match(sp, /Menteri Keuangan 2024/);

// ---- batas path dan alamat
assert.equal(isCandidatePath("p1", "projects/p1/opini/kandidat/m1/a.jpg"), true);
assert.equal(isCandidatePath("p1", "projects/p1/opini/kandidat/../state.json"), false);
assert.equal(isCandidatePath("p1", "projects/p2/opini/kandidat/m1/a.jpg"), false);
assert.equal(isCandidatePath("p1", "projects/p1/materials/a.jpg"), false);
assert.ok(privateIp("127.0.0.1") && privateIp("192.168.1.5") && privateIp("::1") && !privateIp("8.8.8.8"));

// ---- thumbnail Wikimedia (berkas asli bisa puluhan MB)
assert.equal(wikimediaThumb("https://upload.wikimedia.org/wikipedia/commons/f/fa/Sri_Mulyani.jpg", 1920), "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Sri_Mulyani.jpg/1920px-Sri_Mulyani.jpg");
assert.equal(wikimediaThumb("https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/x.jpg/800px-x.jpg"), null, "sudah thumbnail");
assert.equal(wikimediaThumb("https://upload.wikimedia.org/wikipedia/commons/f/fa/Logo.svg"), null, "SVG tidak di-thumbnail");
assert.equal(wikimediaThumb("https://example.com/f/fa/x.jpg"), null);

console.log("fase19: semua tes lulus");
