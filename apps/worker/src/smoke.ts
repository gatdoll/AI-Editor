// Uji lokal tanpa database: probe -> ekstrak audio -> Whisper -> cetak kata.
// Pakai: npm run smoke -w @app/worker -- <path-video>
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { extractAudioWav, probe, FFMPEG, FFPROBE } from "./media.ts";
import { CACHE_DIR } from "./storage.ts";
import { transcribeWav, WHISPER_MODEL } from "./whisper.ts";

const input = process.argv[2];
if (!input) {
  console.error("Pemakaian: npm run smoke -w @app/worker -- <path-video>");
  process.exit(1);
}

console.log("ffmpeg :", FFMPEG);
console.log("ffprobe:", FFPROBE);
const info = await probe(input);
console.log("probe  :", info);
if (!info.hasAudio) throw new Error("tidak ada audio");

const dir = path.join(CACHE_DIR, "smoke");
await mkdir(dir, { recursive: true });
const wav = path.join(dir, "audio.wav");
await extractAudioWav(input, wav);
console.log("audio  :", wav);

const t0 = Date.now();
let last = -1;
const { words, language, model } = await transcribeWav(wav, (f) => {
  const pct = Math.floor(f * 10) * 10;
  if (pct !== last) {
    last = pct;
    console.log(`progress ${pct}%`);
  }
});
const sec = (Date.now() - t0) / 1000;
console.log(`model=${model} (${WHISPER_MODEL}) bahasa=${language} kata=${words.length} waktu=${sec.toFixed(1)}s rtf=${(sec / info.durationS).toFixed(2)}x`);
for (const w of words.slice(0, 40)) {
  console.log(`${w.start.toFixed(2)}-${w.end.toFixed(2)}  ${w.text}  (${w.confidence?.toFixed(2) ?? "-"})`);
}
