// Uji transkrip panjang (beberapa chunk) tanpa database.
// Pakai: npm run chunk-smoke -w @app/worker -- claude|codex
import { ANALYSIS } from "@app/config";
import type { Provider, Word } from "@app/shared";
import { analyzeWithLlm, buildSuggestionRows } from "./analyze/run.ts";

const provider = (process.argv[2] ?? "claude") as Provider;

const topics = ["kamera", "lampu", "mikrofon", "naskah", "tripod", "musik", "warna", "teks", "transisi", "ekspor", "judul", "thumbnail", "audio", "latar", "ritme"];
const verbs = ["kita atur", "kita periksa", "kita siapkan", "kita rapikan", "kita uji", "kita sesuaikan"];
const tails = ["supaya hasilnya enak ditonton", "sebelum mulai merekam video", "agar penonton tidak bosan", "dengan pengaturan yang sederhana", "tanpa alat yang mahal", "dengan cara yang cepat"];
const sentence = (i: number) =>
  `Pada bagian ${i + 1} ini ${verbs[i % verbs.length]} ${topics[i % topics.length]} ${tails[(i * 7) % tails.length]} dan mencatat hasilnya dengan teliti.`;

// Kalimat unik berurutan; beberapa diduplikasi (retake) pada posisi yang kita pilih.
const RETAKE_AT = new Set([6, 20, 55]); // kalimat ke-N diucapkan DUA kali (take pertama harus dipotong)
const words: Word[] = [];
const truth: { first: [number, number]; text: string }[] = [];
let t = 0;
const push = (text: string, gapBefore = 0) => {
  t += gapBefore;
  for (const tok of text.split(/\s+/)) {
    words.push({ text: tok, start: t, end: t + 0.3, confidence: 0.95 });
    t += 0.35;
  }
};
for (let i = 0; i < 70; i++) {
  const s = sentence(i);
  if (RETAKE_AT.has(i)) {
    const a = words.length;
    push(s);
    truth.push({ first: [a, words.length - 1], text: s });
    push(s, 1.0); // take ulang setelah jeda 1 dtk
  } else push(s, 0.15);
}

const ranges = (() => {
  const size = ANALYSIS.chunkWords, step = size - ANALYSIS.chunkOverlapWords;
  const out: string[] = [];
  for (let f = 0; f < words.length; f += step) { out.push(`${f}-${Math.min(f + size, words.length) - 1}`); if (f + size >= words.length) break; }
  return out;
})();
console.log(`kata=${words.length}, chunk=[${ranges.join(" | ")}]`);
console.log("kunci jawaban (take pertama harus dipotong):");
truth.forEach((x) => console.log(`  kata ${x.first[0]}-${x.first[1]}`));

const t0 = Date.now();
const llm = await analyzeWithLlm(provider, words, (f) => console.log(`progress ${Math.round(f * 100)}%`));
console.log(`\n[${provider}] ${((Date.now() - t0) / 1000).toFixed(1)} dtk, chunks=${llm.stats.chunks}, mentah=${llm.stats.rawSuggestions}, dibuang=${llm.stats.droppedInvalid}, retry=${llm.stats.retries}`);

const rows = buildSuggestionRows(words, llm, []).filter((r) => r.kind !== "filler");
console.log("\nusulan setelah digabung:");
for (const r of rows) console.log(`  ${r.kind.padEnd(10)} kata ${r.start_word}-${r.end_word}`);

let ok = 0;
for (const x of truth) {
  const hit = rows.filter((r) => r.kind === "retake" && r.start_word! <= x.first[1] && r.end_word! >= x.first[0]);
  const exact = hit.length === 1 && Math.abs(hit[0].start_word! - x.first[0]) <= 1 && Math.abs(hit[0].end_word! - x.first[1]) <= 1;
  console.log(`  kunci ${x.first[0]}-${x.first[1]}: ${hit.length === 0 ? "TIDAK DITEMUKAN" : hit.length > 1 ? `TERPECAH ${hit.length} usulan` : exact ? "tepat (+-1 kata)" : `ditemukan tapi batas beda: ${hit[0].start_word}-${hit[0].end_word}`}`);
  if (exact) ok++;
}
const falsePos = rows.filter((r) => !truth.some((x) => r.start_word! <= x.first[1] && r.end_word! >= x.first[0]));
console.log(`\ntepat ${ok}/${truth.length}; usulan di luar kunci jawaban (positif palsu): ${falsePos.length}`);
falsePos.forEach((r) => console.log(`  ${r.kind} kata ${r.start_word}-${r.end_word}: ${r.quote?.slice(0, 80)}`));
