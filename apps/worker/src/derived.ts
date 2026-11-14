// Fase 11: file turunan dari video mentah. File mentah hanya DIBACA (aturan 1); hasilnya file baru di folder media.
// - preview: salinan H.264 untuk browser bila codec mentah tidak bisa diputar (mis. MOV HEVC iPhone). Render tetap dari mentah.
// - denoise: audio hasil noisereduce per kekuatan, dipakai pratinjau dan render bila "Kurangi noise" > 0.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DENOISE, PREVIEW } from "@app/config";
import { resolveMediaPath, type AssetRow, type JobRow } from "@app/shared";
import { denoiseLevel, denoisePath, isBrowserPlayable, previewPath } from "@app/shared/derived-media";
import { encodeAac, extractAudioPcmWav, makePreviewMp4, probe } from "./media.ts";
import { WORKER_TMP } from "./temp-dir.ts";
import { REPO_ROOT } from "./creative/workdir.ts";

type Ctx = { db: SupabaseClient; setProgress: (fraction: number) => Promise<void> };

async function rawAsset(db: SupabaseClient, assetId: unknown): Promise<AssetRow> {
  if (typeof assetId !== "string") throw new Error("payload.assetId tidak ada");
  const { data, error } = await db.from("assets").select("*").eq("id", assetId).single();
  if (error || !data) throw new Error(`Aset tidak ditemukan: ${error?.message}`);
  if (data.kind !== "raw") throw new Error("Hanya untuk aset mentah");
  return data as AssetRow;
}

export async function handlePreview(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  const asset = await rawAsset(db, job.payload.assetId);
  const raw = resolveMediaPath(asset.storage_path);
  if (!existsSync(raw)) throw new Error(`File mentah tidak ada di disk: ${asset.storage_path}`);
  const info = await probe(raw);
  if (isBrowserPlayable(info.videoCodec, info.pixFmt)) {
    await db.from("assets").update({ preview_status: "tidak_perlu", preview_path: null, preview_error: null }).eq("id", asset.id);
    return;
  }
  await db.from("assets").update({ preview_status: "antre", preview_error: null }).eq("id", asset.id);
  try {
    const rel = previewPath(asset.project_id, asset.id);
    const out = resolveMediaPath(rel);
    await mkdir(path.dirname(out), { recursive: true });
    await setProgress(0.05);
    await makePreviewMp4(raw, out, PREVIEW);
    const check = await probe(out);
    if (Math.abs(check.durationS - info.durationS) > 0.5) throw new Error(`Durasi salinan pratinjau (${check.durationS.toFixed(2)} dtk) berbeda dari file mentah (${info.durationS.toFixed(2)} dtk)`);
    await db.from("assets").update({ preview_status: "siap", preview_path: rel, preview_error: null }).eq("id", asset.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("assets").update({ preview_status: "gagal", preview_error: message.slice(0, 1000) }).eq("id", asset.id);
    throw e;
  }
}

/** Python venv dari `npm run setup:denoise` (atau DENOISE_PYTHON). */
export function denoisePython(): string {
  if (process.env.DENOISE_PYTHON) return process.env.DENOISE_PYTHON;
  const venv = path.join(REPO_ROOT, DENOISE.venvDir);
  return process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

function runPython(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(denoisePython(), args, { windowsHide: true, env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", TEMP: WORKER_TMP, TMP: WORKER_TMP } });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Reduksi noise melewati batas ${Math.round(timeoutMs / 60000)} menit`)); }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Python untuk reduksi noise tidak bisa dijalankan (${e.message}). Jalankan: npm run setup:denoise`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Reduksi noise gagal (kode ${code}): ${stderr.trim().slice(-600) || "tanpa pesan"}`));
    });
  });
}

/**
 * Pastikan audio hasil reduksi noise untuk kekuatan ini ada (dibuat bila belum). Mengembalikan path absolut, atau null
 * bila kekuatan 0. Dipakai job denoise (pratinjau) dan render, jadi render tidak pernah memakai audio mentah diam-diam.
 */
export async function ensureDenoised(asset: AssetRow, strength: unknown, onProgress?: (f: number) => Promise<void> | void): Promise<string | null> {
  const level = denoiseLevel(strength);
  if (!level) return null;
  const out = resolveMediaPath(denoisePath(asset.project_id, asset.id, level));
  if (existsSync(out)) return out;
  const raw = resolveMediaPath(asset.storage_path);
  if (!existsSync(raw)) throw new Error(`File mentah tidak ada di disk: ${asset.storage_path}`);
  const work = await mkdtemp(path.join(WORKER_TMP, "denoise-"));
  try {
    const src = path.join(work, "in.wav"), dst = path.join(work, "out.wav");
    await extractAudioPcmWav(raw, src, DENOISE.sampleRate);
    await onProgress?.(0.2);
    const summary = await runPython([path.join(REPO_ROOT, "apps/worker/py/denoise.py"), src, dst, String(level / 100), DENOISE.stationary ? "1" : "0", String(DENOISE.chunkSize)], DENOISE.timeoutMs);
    console.log(`[denoise] ${asset.id} ${level}%: ${summary}`);
    await onProgress?.(0.85);
    await mkdir(path.dirname(out), { recursive: true });
    await encodeAac(dst, out, DENOISE.audioBitrate);
    return out;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function handleDenoise(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  const asset = await rawAsset(db, job.payload.assetId);
  if (!denoiseLevel(job.payload.strength)) throw new Error("Kekuatan reduksi noise harus lebih dari 0");
  await ensureDenoised(asset, job.payload.strength, setProgress);
}
