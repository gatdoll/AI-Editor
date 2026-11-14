import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readdir, stat, rm } from "node:fs/promises";
import { z } from "zod";
import { ANALYSIS, LIMITS, REFERENCE } from "@app/config";
import { freeDiskBytes, mediaDir } from "@app/shared";
import { loadReference, referenceDir } from "@app/shared/reference-store";
import { referenceSampleTimes, referenceUrl, type ReferenceAttachment, type ReferenceReport } from "@app/shared/reference";
import { FFMPEG, FFPROBE } from "../media.ts";
import type { Provider } from "@app/shared";
import { runProvider } from "../analyze/providers.ts";
import { VisualStyle, visualStyleOps, visualStylePrompt } from "./reference-analysis.ts";

/** Bounded subprocess; kills downloader children as well as its Python parent on Windows. */
function run(bin: string, args: string[], timeoutMs: number, watchDir?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "", failure: string | null = null, checking = false;
    const stop = (reason: string) => {
      if (failure) return;
      failure = reason;
      if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGKILL");
    };
    const timer = setTimeout(() => stop("Pemrosesan referensi melewati batas waktu. Coba unggah cuplikan yang lebih pendek."), timeoutMs);
    const watcher = watchDir ? setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const files = await readdir(watchDir);
        const sizes = await Promise.all(files.map(async (name) => (await stat(path.join(watchDir, name))).size));
        if (sizes.reduce((a, b) => a + b, 0) > REFERENCE.maxBytes) stop("Referensi melebihi 150 MB. Unggah cuplikan yang lebih pendek.");
      } catch { /* downloader can rename its .part while sampled */ }
      finally { checking = false; }
    }, 250) : null;
    const clean = () => { clearTimeout(timer); if (watcher) clearInterval(watcher); };
    child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-100_000); });
    child.stderr.on("data", (chunk) => { error = (error + chunk).slice(-4000); });
    child.on("error", (e) => { clean(); reject(e); });
    child.on("close", (code) => { clean(); if (code === 0 && !failure) resolve(output); else reject(new Error(failure ?? error.slice(-800) ?? `Kode ${code}`)); });
  });
}

export async function downloadReference(url: string, dir: string): Promise<string> {
  const canonical = referenceUrl(url);
  await mkdir(dir, { recursive: true });
  const free = freeDiskBytes(mediaDir());
  if (free !== null && free < REFERENCE.maxBytes + LIMITS.diskReserveBytes) throw new Error("Ruang disk tidak cukup untuk mengunduh referensi.");
  // Python helper only accepts these platforms; every network request is checked for public IPs.
  const helper = fileURLToPath(new URL("../../../../scripts/download-reference.py", import.meta.url));
  try {
    await run(process.env.REFERENCE_PYTHON ?? "python", [helper, canonical.url, dir, String(REFERENCE.maxBytes)], REFERENCE.timeoutMs, dir);
    const files = (await readdir(dir)).filter((name) => /^reference\.(mp4|webm|mkv|mov|m4v)$/.test(name));
    if (files.length !== 1) throw new Error("Tidak ada file video yang dapat dianalisis.");
    const file = path.join(dir, files[0]);
    const size = (await stat(file)).size;
    if (!size || size > REFERENCE.maxBytes) throw new Error("Ukuran video kosong atau melebihi batas.");
    return file;
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // Penyebab asli hanya ke log worker (bisa berisi token CDN); pengguna mendapat pesan umum di bawah
    console.error(`[referensi] unduhan ${canonical.platform} gagal: ${raw.match(/ERROR:[^\n]*/g)?.pop() ?? raw.slice(-600)}`);
    if (/No module named|ENOENT/i.test(raw)) throw new Error("Pengunduh referensi belum siap. Pasang Python dan jalankan python -m pip install -r scripts/reference-requirements.txt, atau unggah video langsung.");
    // Do not expose media CDN tokens or pretend to infer visual style from a blocked page.
    throw new Error(`Video ${canonical.platform} tidak berhasil diakses. Link mungkin privat, meminta login, dibatasi platform, atau melebihi batas ukuran/waktu. Coba unggah file referensinya langsung. Tidak ada gaya yang diterapkan.`);
  }
}

export async function extractReferenceFrames(file: string, dir: string, startS: number) {
  const raw = await run(FFPROBE, ["-v", "error", "-protocol_whitelist", "file,pipe", "-print_format", "json", "-show_format", "-show_streams", file], 30_000);
  const info = JSON.parse(raw);
  const video = info.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  const duration = Number(video?.duration ?? info.format?.duration ?? 0);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height || video.width * video.height > 3840 * 2160 * 4) throw new Error("File referensi bukan video yang dapat dibaca atau resolusinya terlalu besar.");
  const [num, den] = String(video.avg_frame_rate ?? "30/1").split("/").map(Number);
  const frameDuration = num > 0 && den > 0 ? den / num : 1 / 30;
  if (startS > duration - frameDuration) throw new Error("Waktu referensi terlalu dekat akhir video. Majukan awal cuplikan sedikit.");
  const times = referenceSampleTimes(duration, startS, Math.max(0.1, frameDuration * 2));
  await mkdir(dir, { recursive: true });
  const images: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const out = path.join(dir, `frame-${String(i).padStart(2, "0")}.png`);
    await run(FFMPEG, ["-y", "-v", "error", "-protocol_whitelist", "file,pipe", "-ss", String(times[i]), "-i", file, "-map", "0:v:0", "-frames:v", "1", "-vf", `scale=${REFERENCE.frameMaxSize}:${REFERENCE.frameMaxSize}:force_original_aspect_ratio=decrease`, "-pix_fmt", "rgb24", "-threads", "1", out], 20_000);
    if (!(await stat(out)).size) throw new Error("Frame referensi tidak terbaca.");
    images.push(out);
  }
  return { images, times, width: video.width as number, height: video.height as number, sampledSeconds: Math.min(REFERENCE.sampleSeconds, duration - startS) };
}

/**
 * Fase 22: sampel frame referensi (unduh link bila perlu) ke folder sementara di folder referensi. Pemanggil WAJIB menghapus
 * `dir` sesudah memakai frame-nya (unduhan video tidak disimpan).
 */
export async function sampleReference(projectId: string, attachment: ReferenceAttachment) {
  const meta = await loadReference(projectId, attachment.id);
  const root = referenceDir(projectId, attachment.id);
  const dir = path.join(root, `analysis-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    const file = meta.kind === "upload" ? path.join(root, meta.file!) : await downloadReference(meta.url!, dir);
    return { dir, ...(await extractReferenceFrames(file, dir, attachment.startS)) };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

export async function analyzeReference(projectId: string, attachment: ReferenceAttachment, userPrompt: string, provider: Provider = "codex", model?: string) {
  const { dir, ...frames } = await sampleReference(projectId, attachment);
  try {
    const output = await runProvider(provider, visualStylePrompt(userPrompt, frames.times, frames.width, frames.height), z.toJSONSchema(VisualStyle, { target: "draft-7" }), ANALYSIS.cliTimeoutMs, frames.images, model);
    const visual = visualStyleOps(output.json);
    const report: ReferenceReport = { summary: visual.summary, limitations: visual.limitations, frameCount: frames.images.length, sampledSeconds: frames.sampledSeconds, model: output.model };
    return { ops: visual.ops, report };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
