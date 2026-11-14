// Tes logika murni: pencarian frasa, skema operasi, pemetaan waktu. Jalankan: npm test
import { expandToSentence, findPhrase, normalizeToken } from "@app/shared/phrase";
import { LLM_OPS_SCHEMA, normalizeOps } from "@app/shared/ops";
import { LIMITS } from "@app/config";
import { buildEdl, cutSlack } from "@app/shared/edl";
import { explainError, isFatalForRetry } from "@app/shared/errors";
import { clampZoom, framesOf, mapRangeToOutput, outputToSource, rulerTicks, sourceToOutput } from "../../../packages/remotion/src/timeline.ts";
import { buildPages, mapWordsToTimeline, repairWordTimes } from "../../../packages/remotion/src/captions.ts";

let ok = 0, bad = 0;
const t = (n: string, c: boolean, i = "") => { c ? ok++ : bad++; if (!c) console.log("GAGAL ", n, i); };
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) < e;

// ------------------------------------------------------------------ frasa
const words = "Halo semua. Hari ini kita bahas harga produk baru. Harga ini sangat murah, bahkan harga terbaik! Kita pakai Premiere dan DaVinci Resolve, lalu export. Buka aplikasi, bukan buku.".split(" ").map((x, i) => ({ text: x, start: i * 0.4, end: i * 0.4 + 0.3 }));
t("normalisasi", normalizeToken("Premiere.") === "premiere" && normalizeToken("Café") === "cafe");
t('"harga" 3x', findPhrase(words, "harga").length === 3);
t("frasa 3 kata", findPhrase(words, "harga produk baru").length === 1);
t("tidak peka huruf besar/tanda baca", findPhrase(words, "HARGA TERBAIK!!!").length === 1);
t("ejaan meleset 1 huruf (kata panjang) ditoleransi", findPhrase(words, "davinci rezolve").length === 1 && !findPhrase(words, "davinci rezolve")[0].exact);
t("kata pendek tidak ditoleransi ('buku' bukan 'buka')", findPhrase(words, "buka").length === 1 && findPhrase(words, "buku").every((m) => words[m.startWord].text.startsWith("buku")));
t("tanpa fuzzy: persis", findPhrase(words, "davinci rezolve", { fuzzy: false }).length === 0);
t("tidak ada -> kosong", findPhrase(words, "kucing oren").length === 0 && findPhrase(words, "  ").length === 0);
t("hasil tidak tumpang tindih", findPhrase([{ text: "ya", start: 0, end: 1 }, { text: "ya", start: 1, end: 2 }, { text: "ya", start: 2, end: 3 }], "ya ya").length === 1);
const ex = expandToSentence(words, findPhrase(words, "harga")[0].startWord, findPhrase(words, "harga")[0].endWord);
t("perluas ke kalimat", words[ex.startWord].text === "Hari" && words[ex.endWord].text === "baru.");

// -------------------------------------------------------------- operasi
const flat = (o: Record<string, unknown>) => ({ type: null, phrase: null, scope: null, reason: null, startS: null, endS: null, minSec: null, keepSec: null, styleId: null, aspect: null, camera: null, captions: null, effects: null, preset: null, from: null, to: null, ...o });
t("operasi valid diterima", normalizeOps([flat({ type: "propose_pauses", minSec: 1 }), flat({ type: "set_style", styleId: "tebal" })]).ops.length === 2);
t("minSec di luar batas ditolak", normalizeOps([flat({ type: "propose_pauses", minSec: 0.01 })]).ops.length === 0 && normalizeOps([flat({ type: "propose_pauses", minSec: 9999 })]).ops.length === 0);
t("set_style kosong / gaya tak dikenal ditolak", normalizeOps([flat({ type: "set_style" })]).ops.length === 0 && normalizeOps([flat({ type: "set_style", styleId: "neon" })]).ops.length === 0);
t("jenis tak dikenal ditolak", normalizeOps([flat({ type: "hapus_semua_file", phrase: "x" })]).ops.length === 0);
t("prompt panjang tidak dipotong pada operasi ke-12", normalizeOps(Array.from({ length: 20 }, () => flat({ type: "propose_pauses", minSec: 1 }))).ops.length === 20);
const overflow = normalizeOps(Array.from({ length: LIMITS.promptOperations + 1 }, () => flat({ type: "propose_pauses", minSec: 1 })));
t("overflow ditolak utuh dengan satu pesan, tanpa eksekusi sebagian", overflow.ops.length === 0 && overflow.rejected.length === 1);
t("skema CLI dan validator memakai batas yang sama", LLM_OPS_SCHEMA.properties.ops.maxItems === LIMITS.promptOperations && normalizeOps(Array.from({ length: LIMITS.promptOperations }, () => flat({ type: "propose_pauses", minSec: 1 }))).ops.length === LIMITS.promptOperations);
t("undo digabung perintah lain ditolak", normalizeOps([flat({ type: "undo_last" }), flat({ type: "set_style", styleId: "tebal" })]).ops.length === 0);
t("properti nyasar diabaikan", !("styleId" in normalizeOps([flat({ type: "propose_pauses", minSec: 1, styleId: "tebal" })]).ops[0]));
const item = LLM_OPS_SCHEMA.properties.ops.items as any;
t("skema ketat", item.additionalProperties === false && Object.keys(item.properties).every((k: string) => item.required.includes(k)));

// ------------------------------------------------------------ pemetaan waktu
const segs = [{ start: 0, end: 10 }, { start: 14, end: 30 }, { start: 31, end: 60 }];
const F = framesOf(segs, 30, 60);
t("sumber->hasil", near(sourceToOutput(F, 30, 14.5).out, 10.5) && near(sourceToOutput(F, 30, 31.5).out, 26.5));
t("dalam potongan -> inCut, loncat", sourceToOutput(F, 30, 12).inCut && near(sourceToOutput(F, 30, 12).out, 10));
t("hasil->sumber", near(outputToSource(F, 30, 10.5), 14.5) && near(outputToSource(F, 30, 9999), 60) && near(outputToSource(F, 30, -3), 0));
let rt = true, mono = true, prev = -1;
for (let i = 0; i < 2000; i++) { const src = (i / 2000) * 60; const m = sourceToOutput(F, 30, src); if (!m.inCut && Math.abs(outputToSource(F, 30, m.out) - src) > 1 / 30) rt = false; if (m.out < prev - 1e-9) mono = false; prev = m.out; }
t("roundtrip dan monoton (2000 titik)", rt && mono);
t("rentang dipetakan / titik tengah terpotong -> null", (() => { const r = mapRangeToOutput(F, 30, 15, 17)!; return near(r.start, 11) && near(r.end, 13); })() && mapRangeToOutput(F, 30, 11, 13) === null);
t("zoom dijepit", clampZoom(0.01, 3600, 1200) >= 0.5 && clampZoom(99999, 60, 1200) === 400);
t("penggaris: jarak label >= 70px", [0.5, 1, 5, 20, 100, 400].every((z) => { const l = rulerTicks(600, z).filter((x) => x.label); return l.length < 2 || (l[1].t - l[0].t) * z >= 69; }));
t("penggaris 1 jam tidak berlebihan", rulerTicks(3600, 1).length < 200);

// ------------------------------------------------------------------ subtitle
const m = mapWordsToTimeline([{ text: "a", start: 1, end: 1.4 }, { text: "c", start: 11, end: 11.5 }, { text: "d", start: 14.2, end: 14.6 }], segs, 30, 60);
t("kata di bagian terpotong dibuang; waktu hasil benar", m.map((x) => x.text).join("") === "ad" && near(m[1].start, 10.2));
const r = repairWordTimes([{ text: "videos", start: 10.42, end: 11.68 }, { text: "quickly.", start: 11.68, end: 11.73 }]);
t("kata yang diperas diberi waktu layak", r[1].end - r[1].start >= 0.25);
const long = "Halo semua selamat datang di channel saya. Hari ini kita akan membahas cara mengedit video dengan sangat cepat dan mudah.".split(" ").map((x, i) => ({ text: x, start: i * 0.35, end: i * 0.35 + 0.3 }));
for (const aspect of ["16:9", "9:16"] as const) {
  const pages = buildPages(long, { aspect, uppercase: false });
  t(`[${aspect}] semua kata sekali, maks 2 baris`, pages.flatMap((p) => p.tokens.map((k) => k.text.trim())).join(" ") === long.map((w) => w.text).join(" ") && pages.every((p) => p.lineStarts.length <= 2));
}

// ----------------------------------------------------------------------- EDL
let e = buildEdl(60, [{ start: 10, end: 14 }], 0.1);
t("EDL padding 0.1", near(e.appliedCuts[0].start, 10.1) && near(e.appliedCuts[0].end, 13.9) && near(e.keptS + e.removedS, 60));
e = buildEdl(60, [{ start: 10, end: 14, maxPadStart: 0.03, maxPadEnd: 0.02 }], 0.1);
t("EDL padding dibatasi jarak aman", near(e.appliedCuts[0].start, 10.03) && near(e.appliedCuts[0].end, 13.98));
t("EDL potongan terlalu pendek diabaikan", buildEdl(60, [{ start: 20, end: 20.2 }], 0.1).skippedTooShort === 1);
t("EDL tumpang tindih digabung", buildEdl(60, [{ start: 10, end: 14 }, { start: 13, end: 18 }], 0.1).appliedCuts.length === 1);
t("cutSlack: tanpa kata tidak dibatasi", cutSlack([{ start: 0.15, end: 0.5 }], { start: 1.2, end: 2.8 }).maxPadStart === Infinity);

// ---------------------------------------------------------------------- error
t("error: kuota/login/tanpa audio/render sementara", explainError("[BATAS_PEMAKAIAN] x").kind === "quota" && explainError("belum login").kind === "cli_login" && explainError("Video tidak punya audio").kind === "no_audio" && explainError("remotion-audio-mixing ... Error opening output").kind === "render_temp");
t("error: 14290 bukan kuota; fatal vs boleh diulang", explainError("Panjang file 14290 byte").kind === "unknown" && isFatalForRetry("usage limit reached") && !isFatalForRetry("keluaran bukan JSON"));

console.log(`pure.test: ${ok} lolos, ${bad} gagal`);
process.exit(bad ? 1 : 0);
