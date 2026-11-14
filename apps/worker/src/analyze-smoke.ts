// Uji kualitas analisis tanpa database. Pakai: npm run analyze-smoke -w @app/worker -- claude|codex
import type { Provider, Word } from "@app/shared";
import { analyzeWithLlm, buildSuggestionRows } from "./analyze/run.ts";

const provider = (process.argv[2] ?? "claude") as Provider;

// "|" = jeda 1 dtk. Kunci jawaban ada di bawah.
const TEXT =
  "Halo semua selamat datang di channel saya | Halo semua selamat datang di channel saya hari ini kita akan bahas cara edit video dengan cepat eh | " +
  "Pertama kita buka aplikasi Premiere eh maksud saya DaVinci Resolve lalu import video mentah. Kedua kita potong bagian yang salah. " +
  "Ini sangat sangat penting karena menghemat waktu. Ketiga | ketiga kita tambahkan subtitle dan musik. Anu terakhir kita render videonya. Terima kasih sudah menonton.";

const words: Word[] = [];
let t = 0;
for (const tok of TEXT.split(/\s+/)) {
  if (tok === "|") {
    t += 1.0;
    continue;
  }
  words.push({ text: tok, start: t, end: t + 0.3, confidence: 0.95 });
  t += 0.35;
}

const ANSWER_KEY = [
  'retake   : "Halo semua selamat datang di channel saya" PERTAMA (kata 0-6) dipotong, take kedua dipertahankan',
  'correction: "Premiere eh maksud saya" dipotong, "DaVinci Resolve" dipertahankan',
  'retake   : "Ketiga" pertama (sebelum jeda) dipotong',
  'JANGAN   : "sangat sangat penting" (penekanan sengaja)',
  'filler   : "eh" (setelah "cepat") dan "Anu" ditangani aturan, bukan LLM',
];

const t0 = Date.now();
const llm = await analyzeWithLlm(provider, words, (f) => console.log(`progress ${Math.round(f * 100)}%`));
console.log(`\n[${provider}] ${((Date.now() - t0) / 1000).toFixed(1)} dtk, model=${llm.stats.model}, chunks=${llm.stats.chunks}, dibuang=${llm.stats.droppedInvalid}, retry=${llm.stats.retries}`);
console.log("usage:", JSON.stringify(llm.stats.usage));

const rows = buildSuggestionRows(words, llm, []);
console.log("\n=== USULAN ===");
for (const r of rows) {
  console.log(`${r.kind.padEnd(10)} ${r.start_s.toFixed(2)}-${r.end_s.toFixed(2)}  kata ${r.start_word}-${r.end_word}  "${r.quote}"\n           alasan: ${r.reason}`);
}
console.log("\n=== KUNCI JAWABAN ===");
ANSWER_KEY.forEach((k) => console.log(" -", k));
