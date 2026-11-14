// Fase 24: analisis talent (pemisahan orang dari latar + kotak wajah) untuk video bicara. File mentah hanya DIBACA (aturan 1);
// hasilnya berkas baru di projects/<pid>/talent/. Ditulis ke berkas sementara lalu diganti nama: pembaca tidak pernah
// melihat hasil setengah jadi. Dipanggil job Kreatif bila pengguna mencentang "Pisahkan talent" (payload.talent).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { TALENT } from "@app/config";
import { resolveMediaPath, type AssetRow } from "@app/shared";
import { facesRel, parseFaces, talentRel, type TalentFaces } from "@app/shared/talent";
import { REPO_ROOT } from "./creative/workdir.ts";

export function talentPython(): string {
  if (process.env.TALENT_PYTHON) return process.env.TALENT_PYTHON;
  const venv = path.join(REPO_ROOT, TALENT.venvDir);
  return process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
}

/** Hasil talent satu video (berkas yang ada di disk) atau null. */
export function loadTalent(projectId: string, assetId: string): { file: string; faces: TalentFaces } | null {
  const file = resolveMediaPath(talentRel(projectId, assetId));
  const facesFile = resolveMediaPath(facesRel(projectId, assetId));
  if (!existsSync(file) || !existsSync(facesFile)) return null;
  try {
    const faces = parseFaces(JSON.parse(readFileSync(facesFile, "utf8")));
    return faces ? { file, faces } : null;
  } catch { return null; }
}

/** Data wajah semua video yang sudah disiapkan (untuk buildEditedProps). Tidak ada sama sekali = undefined. */
export function talentFacesById(projectId: string, assetIds: string[]): Record<string, { width: number; height: number; samples: TalentFaces["samples"] }> | undefined {
  const out: Record<string, { width: number; height: number; samples: TalentFaces["samples"] }> = {};
  for (const id of assetIds) {
    const t = loadTalent(projectId, id);
    if (t) out[id] = { width: t.faces.width, height: t.faces.height, samples: t.faces.samples };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Jalankan analisis untuk satu video mentah. `onProgress` 0..1. */
export async function runTalent(asset: AssetRow, onProgress: (f: number) => void, signal?: AbortSignal): Promise<void> {
  const py = talentPython();
  if (!existsSync(py)) throw new Error("Pemisah talent belum dipasang. Jalankan sekali: npm run setup:talent");
  if (!asset.width || !asset.height || !asset.fps || !asset.duration_s) throw new Error("Metadata video belum lengkap (ingest belum selesai).");
  const src = resolveMediaPath(asset.storage_path);
  if (!existsSync(src)) throw new Error(`File mentah tidak ada di disk: ${asset.storage_path}`);
  const out = resolveMediaPath(talentRel(asset.project_id, asset.id));
  const facesOut = resolveMediaPath(facesRel(asset.project_id, asset.id));
  await mkdir(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp.webm`, tmpFaces = `${facesOut}.${process.pid}.tmp`;
  const ffmpeg = spawnSync(py, ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8", windowsHide: true }).stdout.trim();
  if (!ffmpeg) throw new Error("ffmpeg untuk talent tidak ditemukan. Jalankan ulang: npm run setup:talent");
  const script = path.join(REPO_ROOT, "apps/worker/py/talent.py");
  const models = path.join(REPO_ROOT, TALENT.modelDir);
  const timeoutMs = Math.max(120_000, Number(asset.duration_s) * TALENT.timeoutPerSecondMs);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(py, [script, ffmpeg, src, tmp, tmpFaces, models, String(Number(asset.fps)), String(asset.width), String(asset.height), String(asset.duration_s), String(TALENT.inferWidth), String(TALENT.crf)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      const kill = (why: string) => { if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill("SIGKILL"); reject(new Error(why)); };
      const timer = setTimeout(() => kill(`Pemisahan talent melewati batas waktu ${Math.round(timeoutMs / 60000)} menit.`), timeoutMs);
      const onAbort = () => kill(signal?.reason instanceof Error ? signal.reason.message : "Dibatalkan.");
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (d: Buffer) => { for (const m of String(d).matchAll(/^P ([\d.]+)/gm)) onProgress(Number(m[1])); });
      child.stderr.on("data", (d: Buffer) => { err = (err + d).slice(-3000); });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
        if (code === 0) resolve(); else reject(new Error(`Pemisahan talent gagal: ${err.trim().split(/\r?\n/).pop() ?? `kode ${code}`}`));
      });
    });
    if (!parseFaces(JSON.parse(readFileSync(tmpFaces, "utf8")))) throw new Error("Hasil deteksi wajah tidak sah.");
    await rename(tmp, out);
    await rename(tmpFaces, facesOut);
  } finally {
    await rm(tmp, { force: true });
    await rm(tmpFaces, { force: true });
  }
}

/** Pastikan semua video project punya hasil talent; yang belum ada diproses berurutan. */
export async function ensureTalent(assets: AssetRow[], onProgress: (f: number, label: string) => void, signal?: AbortSignal): Promise<number> {
  const missing = assets.filter((a) => !loadTalent(a.project_id, a.id));
  for (const [i, a] of missing.entries()) {
    signal?.throwIfAborted();
    await runTalent(a, (f) => onProgress((i + f) / missing.length, `Memisahkan talent dari latar${missing.length > 1 ? ` (video ${i + 1}/${missing.length})` : ""}`), signal);
  }
  return missing.length;
}
