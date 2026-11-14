// Gelombang audio untuk timeline: puncak (maks |sampel|) per 1/WAVEFORM.perSecond detik, mono, byte 0..255
// dengan skala akar (suara pelan tetap terlihat). Dibuat sekali dari file mentah (hanya dibaca, aturan 1) lalu di-cache.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { WAVEFORM } from "@app/config";

/** ffmpeg: env > binari bawaan Remotion (compositor) di node_modules > PATH. Sama dengan worker. */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  for (let dir = process.cwd(), i = 0; i < 5; i++, dir = path.dirname(dir)) {
    const base = path.join(dir, "node_modules", "@remotion");
    if (!existsSync(base)) continue;
    for (const pkg of readdirSync(base).filter((n) => n.startsWith("compositor-"))) {
      const candidate = path.join(base, pkg, exe);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "ffmpeg";
}

/** Puncak dari PCM s16le mono. Murni (diuji). */
export function peaksFromPcm(pcm: Buffer, samplesPerPeak: number): Uint8Array {
  const n = Math.floor(pcm.length / 2);
  const out = new Uint8Array(Math.ceil(n / samplesPerPeak));
  for (let i = 0; i < out.length; i++) {
    let max = 0;
    const end = Math.min(n, (i + 1) * samplesPerPeak);
    for (let k = i * samplesPerPeak; k < end; k++) { const v = Math.abs(pcm.readInt16LE(k * 2)); if (v > max) max = v; }
    out[i] = Math.round(Math.sqrt(Math.min(1, max / 32768)) * 255);
  }
  return out;
}

/** Decode audio mentah lewat ffmpeg (stdout, tanpa file sementara) lalu hitung puncak. */
export function computeWaveform(input: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-v", "error", "-i", input, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", String(WAVEFORM.sampleRate), "-acodec", "pcm_s16le", "-f", "wav", "pipe:1"], { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg gagal membaca audio: ${err.slice(-300)}`));
      // ffmpeg bawaan Remotion tidak punya muxer PCM mentah: keluaran WAV, data PCM dimulai setelah potongan "data"
      const wav = Buffer.concat(chunks);
      const at = wav.indexOf("data", 12, "ascii");
      if (at < 0) return reject(new Error("Audio tidak terbaca (WAV tanpa data)"));
      resolve(peaksFromPcm(wav.subarray(at + 8), WAVEFORM.sampleRate / WAVEFORM.perSecond));
    });
  });
}
