// Tes perencana efek prompt. Jalankan: node apps/worker/test/effects.test.ts
// (Node 22+ menjalankan TypeScript langsung.)
import { planEffects, type PromptCtx } from "../src/prompt/effects.ts";
import { DEFAULT_STYLE } from "../../../packages/remotion/src/build-props.ts";
import type { Op } from "@app/shared/ops";
import { CAMERA } from "@app/config";

let ok = 0, bad = 0;
const t = (n: string, c: boolean, i = "") => { c ? ok++ : bad++; console.log(c ? "LOLOS " : "GAGAL ", n, i); };

const text = "Halo semua. Hari ini kita bahas harga produk baru. Harga ini sangat murah, bahkan harga terbaik! Kita pakai Premier dan DaVinci Resolve, lalu export. Terima kasih sudah menonton.";
const words = text.split(" ").map((x, i) => ({ text: x, start: 1 + i * 0.45, end: 1 + i * 0.45 + 0.35, confidence: 0.95 }));
const duration = words[words.length - 1].end + 1;
const base = (over: Partial<PromptCtx> = {}): PromptCtx => ({ words, durationS: duration, style: DEFAULT_STYLE, existing: [], getSilences: async () => [], ...over });
const run = (ops: Op[], ctx = base()) => planEffects(ops, ctx);

// 1. potong frasa
let fx = await run([{ type: "propose_cut_phrase", phrase: "harga", scope: "phrase" }]);
t('"harga" -> 3 usulan', fx.suggestions.length === 3, String(fx.suggestions.length));
t("usulan: jenis custom, sumber prompt, tanpa properti status (lahir pending di DB)", fx.suggestions.every((s) => s.kind === "custom" && s.source === "prompt" && !("status" in s)));
t("usulan valid: awal<akhir, di dalam durasi, orig = awal/akhir", fx.suggestions.every((s) => s.start_s >= 0 && s.end_s > s.start_s && s.end_s <= duration && s.orig_start_s === s.start_s && s.orig_end_s === s.end_s));
t("usulan membawa kutipan dan indeks kata", fx.suggestions.every((s) => s.quote && s.start_word != null && s.end_word != null));
t("pesan menyebut jumlah dan frasa", /"harga".*3 usulan/.test(fx.messages[0]), fx.messages[0]);

// 2. cakupan kalimat
fx = await run([{ type: "propose_cut_phrase", phrase: "harga", scope: "sentence" }]);
t('scope kalimat: "harga" 3x di 2 kalimat -> 2 usulan', fx.suggestions.length === 2, String(fx.suggestions.length));
t("usulan kalimat berakhir di tanda baca kalimat", fx.suggestions.every((s) => /[.!?]$/.test(words[s.end_word!].text)));

// 3. tidak ditemukan
fx = await run([{ type: "propose_cut_phrase", phrase: "kucing oren", scope: "phrase" }]);
t("tidak ditemukan -> 0 usulan + pesan jelas (tidak menebak)", fx.suggestions.length === 0 && /Tidak menemukan/.test(fx.messages[0]));

// 4. duplikat
const first = (await run([{ type: "propose_cut_phrase", phrase: "harga", scope: "phrase" }])).suggestions;
fx = await run([{ type: "propose_cut_phrase", phrase: "harga", scope: "phrase" }], base({ existing: first.map((s) => ({ start: s.start_s, end: s.end_s })) }));
t("sudah ada usulan di tempat yang sama -> 0 baru, dilaporkan", fx.suggestions.length === 0 && /3 sudah ada/.test(fx.messages[0]), fx.messages[0]);
fx = await run([{ type: "propose_cut_phrase", phrase: "harga", scope: "phrase" }, { type: "propose_cut_phrase", phrase: "harga", scope: "phrase" }]);
t("dua operasi sama dalam satu perintah tidak menggandakan usulan", fx.suggestions.length === 3);

// 5. rentang waktu
fx = await run([{ type: "propose_cut_time", startS: 2, endS: 4 }]);
t("potong 2-4 dtk -> satu usulan", fx.suggestions.length === 1 && fx.suggestions[0].start_s === 2 && fx.suggestions[0].end_s === 4 && fx.suggestions[0].quote === null);
fx = await run([{ type: "propose_cut_time", startS: 5, endS: 3 }]);
t("rentang terbalik -> tidak diusulkan", fx.suggestions.length === 0 && /tidak valid/.test(fx.messages[0]));
fx = await run([{ type: "propose_cut_time", startS: 3, endS: 9999 }]);
t("akhir melewati durasi dijepit", fx.suggestions.length === 1 && fx.suggestions[0].end_s === duration);
fx = await run([{ type: "propose_cut_time", startS: 9998, endS: 9999 }]);
t("seluruhnya di luar durasi -> tidak diusulkan", fx.suggestions.length === 0);

// 6. jeda
let asked = -1;
// jeda uji harus berada di dalam durasi video uji (~15,8 dtk)
const sil = [{ start: 5, end: 7 }, { start: 10, end: 10.9 }, { start: 12, end: 14.5 }];
fx = await run([{ type: "propose_pauses", minSec: 0.8 }], base({ getSilences: async (m) => { asked = m; return sil; } }));
t("jeda: meminta silencedetect dengan ambang dari perintah (0.8)", asked === 0.8);
t("jeda: 3 usulan pause, disisakan 0.3 dtk (0.15 tiap sisi)", fx.suggestions.length === 3 && fx.suggestions[0].kind === "pause" && Math.abs(fx.suggestions[0].start_s - 5.15) < 1e-9 && Math.abs(fx.suggestions[0].end_s - 6.85) < 1e-9);
fx = await run([{ type: "propose_pauses", minSec: 0.8, keepSec: 0 }], base({ getSilences: async () => sil }));
t("keepSec 0: seluruh jeda diusulkan", Math.abs(fx.suggestions[0].start_s - 5) < 1e-9 && Math.abs(fx.suggestions[0].end_s - 7) < 1e-9);
fx = await run([{ type: "propose_pauses", minSec: 3 }], base({ getSilences: async () => [] }));
t("tidak ada jeda -> pesan jelas", fx.suggestions.length === 0 && /Tidak ada jeda/.test(fx.messages[0]));
fx = await run([{ type: "propose_pauses", minSec: 0.8 }], base({ getSilences: async () => sil, existing: [{ start: 5, end: 7 }] }));
t("jeda yang sudah ada usulannya dilewati", fx.suggestions.length === 2 && /1 sudah ada/.test(fx.messages[0]), fx.messages[0]);
fx = await run([{ type: "propose_pauses", minSec: 0.8 }], base({ getSilences: async () => [{ start: 3, end: 3.2 }] }));
t("jeda lebih pendek dari ambang tidak diusulkan (alasan harus jujur)", fx.suggestions.length === 0);
fx = await run([{ type: "propose_pauses", minSec: 0.5 }], base({ getSilences: async () => [{ start: duration - 1, end: duration + 5 }] }));
t("jeda yang melewati durasi video dijepit", fx.suggestions.every((s) => s.end_s <= duration));

// 7. gaya
fx = await run([{ type: "set_style", styleId: "tebal", aspect: "9:16", effects: false }]);
t("set_style: gaya + rasio + efek berubah", fx.style?.styleId === "tebal" && fx.style?.aspect === "9:16" && fx.style?.effects === false && fx.style?.camera === true);
t("set_style: pesan merinci perubahan", /gaya bersih -> tebal/.test(fx.messages[0]) && /rasio 16:9 -> 9:16/.test(fx.messages[0]) && /efek film dimatikan/.test(fx.messages[0]), fx.messages[0]);
fx = await run([{ type: "set_style", styleId: "bersih" }]);
t("set_style tanpa perubahan -> style null + pesan jujur", fx.style === null && /sudah seperti itu/.test(fx.messages[0]));
t("set_style tidak menyentuh usulan potong", fx.suggestions.length === 0);

// 8. tekankan
fx = await run([{ type: "emphasize_phrase", phrase: "harga", preset: "zoom-point" }]);
const ov = fx.style!.cameraOverrides;
t('emphasize "harga": 3 permintaan zoom', ov.length === 3 && ov.every((o) => o.preset === "zoom-point"));
t("zoom mulai sedikit sebelum dan berakhir sesudah frasa, dalam durasi", ov.every((o) => o.startS >= 0 && o.endS <= duration && o.endS - o.startS >= CAMERA.overrideLeadSec + CAMERA.overrideTailSec - 1e-6));
const again = await run([{ type: "emphasize_phrase", phrase: "harga", preset: "zoom-point" }], base({ style: fx.style! }));
t("zoom yang sama diminta lagi: tidak menggandakan", again.style === null && /sudah ada/.test(again.messages[0]));
fx = await run([{ type: "emphasize_phrase", phrase: "tidak-ada-kata-ini", preset: "push-in" }]);
t("emphasize tidak ditemukan -> tanpa perubahan + pesan", fx.style === null && /Tidak menemukan/.test(fx.messages[0]));
t("emphasize tidak membuat usulan potong", fx.suggestions.length === 0);

// 9. perbaiki kata
fx = await run([{ type: "fix_word", from: "premier", to: "Premiere" }]);
t('fix_word "Premier" -> "Premiere" (1 tempat)', fx.wordFixes.length === 1 && fx.wordFixes[0].after === "Premiere");
fx = await run([{ type: "fix_word", from: "murah", to: "Murah" }]);
t("fix_word mempertahankan tanda baca ('murah,' -> 'Murah,')", fx.wordFixes.length === 1 && fx.wordFixes[0].before === "murah," && fx.wordFixes[0].after === "Murah,", JSON.stringify(fx.wordFixes));
fx = await run([{ type: "fix_word", from: "premier dan", to: "x" }]);
t("fix_word multi-kata ditolak dengan pesan", fx.wordFixes.length === 0 && /SATU kata/.test(fx.messages[0]));
fx = await run([{ type: "fix_word", from: "kucing", to: "x" }]);
t("fix_word tidak ditemukan -> tanpa perubahan", fx.wordFixes.length === 0 && /Tidak menemukan/.test(fx.messages[0]));
fx = await run([{ type: "fix_word", from: "Premier", to: "Premiere" }, { type: "propose_cut_phrase", phrase: "premiere", scope: "phrase" }]);
t("operasi berikutnya melihat ejaan baru", fx.suggestions.length === 1 && fx.wordFixes.length === 1);
t("fix_word hanya mengubah kata yang cocok", fx.wordFixes.every((f) => f.before.toLowerCase().startsWith("premier")));

// 10. bendera
fx = await run([{ type: "render", aspect: "9:16" }]);
t("render: aspek dibawa, tidak membuat usulan", fx.render?.aspect === "9:16" && fx.suggestions.length === 0);
fx = await run([{ type: "undo_last" }]);
t("undo_last: bendera", fx.undo === true);
fx = await run([{ type: "answer" }]);
t("answer: tidak mengubah apa pun", fx.suggestions.length === 0 && fx.style === null && fx.wordFixes.length === 0 && !fx.render && !fx.undo);

// 11. perintah gabungan
fx = await run([
  { type: "propose_pauses", minSec: 1 },
  { type: "propose_cut_phrase", phrase: "eh", scope: "phrase" },
  { type: "set_style", styleId: "tebal" },
  { type: "emphasize_phrase", phrase: "harga", preset: "zoom-point" },
  { type: "render", aspect: "9:16" },
], base({ getSilences: async () => sil }));
t("perintah gabungan: jeda + gaya + zoom + render sekaligus", fx.suggestions.length === 2 && fx.style?.styleId === "tebal" && fx.style.cameraOverrides.length === 3 && fx.render?.aspect === "9:16");
t("tiap operasi menghasilkan pesan", fx.messages.length >= 4);

// 12. fuzzing
function rnd(seed: number) { let a = seed; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }
const vocab = ["harga", "produk", "kita", "ya", "eh", "baik", "video", "cepat", "sekali", "lalu"];
let fuzzOk = true, cases = 0, sugs = 0, why = "";
for (let seed = 1; seed <= 600; seed++) {
  const r = rnd(seed);
  const n = 20 + Math.floor(r() * 400);
  const ws = Array.from({ length: n }, (_, i) => ({ text: vocab[Math.floor(r() * vocab.length)] + (r() < 0.1 ? "." : ""), start: i * 0.4 + r() * 0.05, end: i * 0.4 + 0.3, confidence: 0.9 }));
  const dur = ws[n - 1].end + 0.5;
  const ops: Op[] = [];
  for (let k = 0; k < 1 + Math.floor(r() * 5); k++) {
    const x = r();
    if (x < 0.3) ops.push({ type: "propose_cut_phrase", phrase: vocab[Math.floor(r() * vocab.length)], scope: r() < 0.5 ? "phrase" : "sentence" });
    else if (x < 0.5) ops.push({ type: "propose_cut_time", startS: r() * dur * 1.2 - 2, endS: r() * dur * 1.2 });
    else if (x < 0.7) ops.push({ type: "propose_pauses", minSec: 0.3 + r() * 2 });
    else if (x < 0.85) ops.push({ type: "emphasize_phrase", phrase: vocab[Math.floor(r() * vocab.length)], preset: "zoom-point" });
    else ops.push({ type: "set_style", styleId: r() < 0.5 ? "tebal" : "lembut" });
  }
  const sils = Array.from({ length: Math.floor(r() * 30) }, () => { const s = r() * dur; return { start: s, end: s + 0.3 + r() * 3 }; }); // sengaja bisa melewati durasi
  const f = await planEffects(ops, { words: ws, durationS: dur, style: DEFAULT_STYLE, existing: [], getSilences: async () => sils });
  cases++; sugs += f.suggestions.length;
  for (const s of f.suggestions) if (!(s.start_s >= 0 && s.end_s > s.start_s && s.end_s <= dur + 1e-9)) { fuzzOk = false; why ||= `rentang tidak valid seed=${seed}`; }
  for (let i = 0; i < f.suggestions.length; i++) for (let j = i + 1; j < f.suggestions.length; j++) {
    const a = f.suggestions[i], b = f.suggestions[j];
    const ov = Math.max(0, Math.min(a.end_s, b.end_s) - Math.max(a.start_s, b.start_s));
    if (ov / Math.min(a.end_s - a.start_s, b.end_s - b.start_s) >= 0.5) { fuzzOk = false; why ||= `tumpang tindih seed=${seed}`; }
  }
  if (f.style && f.style.cameraOverrides.some((o) => !(o.startS >= 0 && o.endS > o.startS && o.endS <= dur + 1e-9))) { fuzzOk = false; why ||= `override di luar durasi seed=${seed}`; }
}
t(`fuzzing ${cases} perintah acak (${sugs} usulan): semua valid, dalam durasi, tidak saling tumpang tindih`, fuzzOk, why);

console.log(`\n${ok} lolos, ${bad} gagal`);
process.exit(bad ? 1 : 0);
