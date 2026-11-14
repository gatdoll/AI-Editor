import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

// ffmpeg/ffprobe: env > binari bawaan Remotion (compositor) > PATH sistem.
const COMPOSITOR_PACKAGES = [
  "@remotion/compositor-win32-x64-msvc",
  "@remotion/compositor-linux-x64-gnu",
  "@remotion/compositor-linux-arm64-gnu",
  "@remotion/compositor-darwin-x64",
  "@remotion/compositor-darwin-arm64",
];

function resolveBinary(envValue: string | undefined, name: "ffmpeg" | "ffprobe"): string {
  if (envValue) return envValue;
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  for (const pkg of COMPOSITOR_PACKAGES) {
    try {
      const dir = path.dirname(require.resolve(`${pkg}/package.json`));
      const candidate = path.join(dir, exe);
      if (existsSync(candidate)) return candidate;
    } catch {
      // paket platform lain tidak terpasang
    }
  }
  return name;
}

export const FFMPEG = resolveBinary(process.env.FFMPEG_PATH, "ffmpeg");
export const FFPROBE = resolveBinary(process.env.FFPROBE_PATH, "ffprobe");

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} keluar dengan kode ${code}: ${stderr.slice(-800)}`));
    });
  });
}

export type MediaInfo = {
  durationS: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  /** Fase 11: codec dan format piksel video, untuk memutuskan perlu tidaknya salinan pratinjau. */
  videoCodec: string | null;
  pixFmt: string | null;
};

function parseFraction(value: string | undefined): number {
  if (!value) return 0;
  const [n, d] = value.split("/").map(Number);
  return d ? n / d : n;
}

export async function probe(input: string): Promise<MediaInfo> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    input,
  ]);
  const info = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
      codec_name?: string;
      pix_fmt?: string;
      tags?: { rotate?: string };
      side_data_list?: Array<{ rotation?: number }>;
    }>;
  };
  const video = info.streams?.find((s) => s.codec_type === "video");
  const audio = info.streams?.find((s) => s.codec_type === "audio");
  if (!video) throw new Error("File tidak punya aliran video");
  const durationS = Number(info.format?.duration ?? video.duration ?? 0);
  // Video ponsel (mis. iPhone) disimpan mendatar dengan tanda rotasi; pemutar dan renderer memutarnya.
  // Ukuran yang dicatat harus ukuran yang TAMPIL, kalau tidak rasio, batas zoom, dan posisi potong salah.
  const rotation = Number(video.side_data_list?.find((d) => d.rotation != null)?.rotation ?? video.tags?.rotate ?? 0);
  const sideways = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  return {
    durationS,
    width: (sideways ? video.height : video.width) ?? 0,
    height: (sideways ? video.width : video.height) ?? 0,
    fps: parseFraction(video.avg_frame_rate) || parseFraction(video.r_frame_rate),
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name ?? null,
    pixFmt: video.pix_fmt ?? null,
  };
}

/**
 * Fase 19: gambar unduhan internet -> salinan baru (JPEG, atau PNG bila `png` untuk menjaga transparansi), sisi terpanjang
 * dibatasi, hanya frame pertama. Isi berkas asli tidak pernah disajikan apa adanya.
 */
export async function reencodeImage(input: string, output: string, o: { maxLongSide: number; jpegQ: number; png: boolean }): Promise<{ width: number; height: number }> {
  const m = o.maxLongSide;
  await run(FFMPEG, [
    "-y", "-v", "error", "-i", input, "-frames:v", "1",
    "-vf", `scale='if(gt(iw,ih),min(${m},iw),-2)':'if(gt(iw,ih),-2,min(${m},ih))'`,
    ...(o.png ? ["-pix_fmt", "rgba"] : ["-pix_fmt", "yuvj420p", "-q:v", String(o.jpegQ)]),
    output,
  ]);
  const info = await probe(output);
  return { width: info.width, height: info.height };
}

/** Audio mono 16 kHz PCM, format yang diminta Whisper.cpp. */
export async function extractAudioWav(input: string, outWav: string): Promise<void> {
  await run(FFMPEG, [
    "-y", "-v", "error",
    "-i", input,
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
    outWav,
  ]);
}

/**
 * Salinan pratinjau H.264 untuk browser (Fase 11): sisi terpendek dibatasi, rotasi ponsel diterapkan, cap waktu frame
 * dipertahankan (passthrough) agar pratinjau tetap sinkron dengan EDL dan render. Ditulis ke file sementara lalu
 * dipindah, jadi pemutar tidak pernah membaca file setengah jadi.
 */
export async function makePreviewMp4(input: string, out: string, opt: { maxShortSide: number; crf: number; preset: string; audioBitrate: string }): Promise<void> {
  const tmp = `${out}.tmp.mp4`;
  const m = opt.maxShortSide;
  await run(FFMPEG, [
    "-y", "-v", "error",
    "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", `scale='if(gte(iw,ih),-2,min(${m},iw))':'if(gte(iw,ih),min(${m},ih),-2)',format=yuv420p`,
    "-fps_mode", "passthrough",
    "-c:v", "libx264", "-preset", opt.preset, "-crf", String(opt.crf), "-profile:v", "high",
    "-c:a", "aac", "-b:a", opt.audioBitrate,
    "-movflags", "+faststart",
    tmp,
  ]);
  await rename(tmp, out);
}

/** Audio kualitas penuh (PCM 24-bit, sample rate tetap) untuk diproses Python; stereo. ffmpeg bawaan Remotion tidak punya encoder float. */
export async function extractAudioPcmWav(input: string, outWav: string, sampleRate: number): Promise<void> {
  await run(FFMPEG, ["-y", "-v", "error", "-i", input, "-vn", "-map", "0:a:0", "-ac", "2", "-ar", String(sampleRate), "-c:a", "pcm_s24le", outWav]);
}

/** WAV -> AAC (.m4a), ditulis ke file sementara lalu dipindah. */
export async function encodeAac(inWav: string, out: string, bitrate: string): Promise<void> {
  const tmp = `${out}.tmp.m4a`;
  // "-f mp4": ffmpeg bawaan Remotion tidak punya muxer ipod/.m4a; isinya tetap AAC dalam MP4
  await run(FFMPEG, ["-y", "-v", "error", "-i", inWav, "-vn", "-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart", "-f", "mp4", tmp]);
  await rename(tmp, out);
}

/**
 * Fase 12: audio gabungan HANYA dari segmen yang dipertahankan (untuk Whisper). WAV PCM dipotong langsung per sampel
 * di Node (ffmpeg bawaan Remotion tidak punya filter aselect), hasilnya rapat tanpa jeda dengan format yang sama.
 */
export async function extractSegmentsWav(inWav: string, outWav: string, segments: Array<{ start: number; end: number }>): Promise<void> {
  const buf = await readFile(inWav);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Audio sementara bukan WAV");
  let pos = 12, fmt: Buffer | null = null, dataStart = -1, dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4), size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = buf.subarray(pos + 8, pos + 8 + size);
    if (id === "data") { dataStart = pos + 8; dataLen = Math.min(size, buf.length - dataStart); break; }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || dataStart < 0) throw new Error("Audio sementara tidak lengkap");
  const rate = fmt.readUInt32LE(4), blockAlign = fmt.readUInt16LE(12);
  const parts = segments.map((s) => {
    const a = Math.max(0, Math.round(s.start * rate)) * blockAlign, b = Math.min(dataLen, Math.round(s.end * rate) * blockAlign);
    return b > a ? buf.subarray(dataStart + a, dataStart + b) : Buffer.alloc(0);
  });
  const data = Buffer.concat(parts);
  const header = Buffer.alloc(12 + 8 + fmt.length + 8);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(header.length - 8 + data.length, 4); header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii"); header.writeUInt32LE(fmt.length, 16); fmt.copy(header, 20);
  header.write("data", 20 + fmt.length, "ascii"); header.writeUInt32LE(data.length, 24 + fmt.length);
  await writeFile(outWav, Buffer.concat([header, data]));
}

export type Silence = { start: number; end: number };

/** Persentil `p` level RMS (dBFS) jendela 50 ms dari WAV PCM 16-bit (format extractAudioWav). Dibaca bertahap. */
export async function noiseFloorDb(wavFile: string, p: number): Promise<number | null> {
  const { createReadStream } = await import("node:fs");
  const levels: number[] = [];
  let header = Buffer.alloc(0), dataAt = -1, sampleRate = 16000, channels = 1;
  let acc = 0, n = 0, win = 0, carry: Buffer | null = null;
  for await (const chunk of createReadStream(wavFile)) {
    let buf = chunk as Buffer;
    if (dataAt < 0) {
      header = Buffer.concat([header, buf]);
      for (let off = 12; off + 8 <= header.length; off += 8 + header.readUInt32LE(off + 4)) {
        const id = header.toString("ascii", off, off + 4);
        if (id === "fmt " && off + 16 <= header.length) { channels = header.readUInt16LE(off + 10); sampleRate = header.readUInt32LE(off + 12); }
        if (id === "data") { dataAt = off + 8; break; }
      }
      if (dataAt < 0) continue;
      buf = header.subarray(dataAt);
      win = Math.max(1, Math.round(sampleRate * 0.05)) * channels;
    }
    if (carry) { buf = Buffer.concat([carry, buf]); carry = null; }
    const even = buf.length & ~1;
    for (let i = 0; i < even; i += 2) {
      const v = buf.readInt16LE(i) / 32768;
      acc += v * v;
      if (++n === win) { levels.push(10 * Math.log10(acc / n + 1e-12)); acc = 0; n = 0; }
    }
    if (even < buf.length) carry = buf.subarray(even);
  }
  if (!levels.length) return null;
  levels.sort((a, b) => a - b);
  return levels[Math.floor(p * (levels.length - 1))];
}

/** Ambang silencedetect untuk satu video: lantai noise + margin, tidak lebih ketat dari `minDb` dan tidak lebih dari `maxDb`. */
export function silenceThresholdFor(floorDb: number | null, o: { minDb: number; marginDb: number; maxDb: number }): number {
  if (floorDb == null || !Number.isFinite(floorDb)) return o.minDb;
  return Math.min(o.maxDb, Math.max(o.minDb, floorDb + o.marginDb));
}

/** Interval diam dari ffmpeg silencedetect. Diam di ujung file ditutup di `durationS`. */
export async function detectSilences(
  input: string,
  noiseDb: number,
  minSec: number,
  durationS: number,
): Promise<Silence[]> {
  const { stderr } = await run(FFMPEG, [
    "-hide_banner", "-nostats",
    "-i", input,
    "-af", `silencedetect=noise=${noiseDb}dB:d=${minSec}`,
    "-f", "null", "-",
  ]);
  const out: Silence[] = [];
  let open: number | null = null;
  for (const raw of stderr.split("\n")) {
    const line = raw.trim();
    const st = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (st) open = Math.max(0, Number(st[1]));
    const en = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (en && open !== null) {
      out.push({ start: open, end: Number(en[1]) });
      open = null;
    }
  }
  if (open !== null && durationS > open) out.push({ start: open, end: durationS });
  return out;
}
