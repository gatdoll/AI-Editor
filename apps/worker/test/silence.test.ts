// Ambang diam adaptif: rekaman dengan desis ruangan di atas -35 dB tetap punya jeda yang terdeteksi, rekaman bersih tidak
// berubah. Memakai ffmpeg bawaan Remotion. Jalankan: node apps/worker/test/silence.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ANALYSIS } from "../../../config/index.ts";
import { detectSilences, noiseFloorDb, silenceThresholdFor } from "../src/media.ts";

const opts = { minDb: ANALYSIS.silenceThresholdDb, marginDb: ANALYSIS.silenceFloorMarginDb, maxDb: ANALYSIS.silenceMaxThresholdDb };
assert.equal(silenceThresholdFor(null, opts), -35, "lantai tidak diketahui = ambang lama");
assert.equal(silenceThresholdFor(-60, opts), -35, "rekaman bersih: tidak lebih ketat dari ambang lama");
assert.equal(silenceThresholdFor(-39.5, opts), -27.5, "desis ruangan (uji 31 Okt): lantai + 12 dB");
assert.equal(silenceThresholdFor(-10, opts), -20, "dibatasi maksimal");

/** WAV 16 kHz mono: noise putih `noiseDb` RMS di seluruh durasi + nada "ucapan" -12 dB di luar `pauses`. */
function wav(file: string, seconds: number, noiseDb: number, pauses: Array<[number, number]>) {
  const rate = 16000, n = seconds * rate, data = Buffer.alloc(n * 2);
  const noiseAmp = 10 ** (noiseDb / 20) * Math.sqrt(3); // RMS noise seragam = amp/sqrt(3)
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const speech = pauses.some(([a, b]) => t >= a && t < b) ? 0 : 0.25 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((speech + noiseAmp * rnd()) * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii"); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "silence-"));
try {
  const pauses: Array<[number, number]> = [[3, 4], [7, 8.2]];
  for (const [name, noiseDb] of [["ruang", -36], ["bersih", -60]] as const) {
    const f = path.join(tmp, `${name}.wav`);
    wav(f, 10, noiseDb, pauses);
    const floor = await noiseFloorDb(f, ANALYSIS.noiseFloorPercentile);
    assert.ok(floor !== null && Math.abs(floor - noiseDb) < 2, `${name}: lantai noise ${floor} ~ ${noiseDb}`);
    const db = silenceThresholdFor(floor, opts);
    const found = await detectSilences(f, db, ANALYSIS.minPauseSec, 10);
    assert.equal(found.length, 2, `${name}: dua jeda terdeteksi pada ambang ${db}`);
    for (const [i, [a, b]] of pauses.entries()) assert.ok(Math.abs(found[i].start - a) < 0.1 && Math.abs(found[i].end - b) < 0.1, `${name}: jeda ${i} ${JSON.stringify(found[i])}`);
    if (name === "ruang") assert.equal((await detectSilences(f, -35, ANALYSIS.minPauseSec, 10)).length, 0, "ambang tetap -35 dB tidak menemukan jeda (masalah lama)");
    if (name === "bersih") assert.equal(db, -35, "rekaman bersih memakai ambang lama");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("silence.test: ambang diam adaptif (desis ruangan -36 dB tetap ketemu jeda, rekaman bersih tetap -35 dB, batas) passed");
