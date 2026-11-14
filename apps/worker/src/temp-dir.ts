// Folder sementara worker: DI LUAR drive sistem dan DI LUAR repo.
// Remotion menaruh bundel webpack dan salinan video ("remotion-v4.*-assets*") di os.tmpdir() dan tidak selalu
// membersihkannya. Di C: yang sempit, sisa itu memenuhi disk (28 Okt 2026: 4,8 GB, C: tinggal 30 MB -> ENOSPC).
// Modul ini HARUS diimpor sebelum @remotion/*: TEMP/TMP diarahkan ke sini untuk seluruh proses worker.
// Di luar repo agar agen Claude (cwd di sini) tidak membaca CLAUDE.md proyek.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
/** Bawaan: <drive repo>\editing-video-tmp (mis. H:\editing-video-tmp). Bisa diganti WORKER_TMP_DIR. */
export const WORKER_TMP = path.resolve(process.env.WORKER_TMP_DIR ?? path.join(path.parse(repoRoot).root, "editing-video-tmp"));

const rel = path.relative(repoRoot, WORKER_TMP);
if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error(`WORKER_TMP_DIR (${WORKER_TMP}) tidak boleh di dalam repo.`);

mkdirSync(WORKER_TMP, { recursive: true });
process.env.TEMP = process.env.TMP = process.env.TMPDIR = WORKER_TMP;

/**
 * Hapus sisa sementara yang sudah tua di folder worker sendiri (bukan %TEMP% sistem): folder Remotion dan
 * folder kerja kreatif yang tertinggal karena proses mati di tengah jalan. Hanya nama yang dikenal.
 */
export function cleanStaleTemp(maxAgeMs: number, now = Date.now()): { removed: number; errors: number } {
  let removed = 0, errors = 0;
  const sweep = (dir: string, match: (name: string) => boolean) => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (!match(name)) continue;
      const full = path.join(dir, name);
      try {
        if (now - statSync(full).mtimeMs < maxAgeMs) continue;
        rmSync(full, { recursive: true, force: true });
        removed++;
      } catch { errors++; }
    }
  };
  sweep(WORKER_TMP, (n) => n.startsWith("remotion-") || n.startsWith("react-motion-") || n.startsWith("puppeteer_dev_"));
  sweep(path.join(WORKER_TMP, "editing-video-creative"), () => true);
  return { removed, errors };
}

/**
 * Folder hasil `build` yang dipakai ulang selama proses hidup, aman terhadap cleanStaleTemp: tiap pemakaian
 * memperbarui waktunya (yang dipakai tidak pernah "tua"), dan folder yang tetap hilang dibuat ulang.
 * Tanpa ini worker yang hidup lebih dari 6 jam gagal di semua render (3 Nov 2026: bundel Remotion terhapus).
 */
export function reusableDir(build: () => Promise<string>, marker: string): () => Promise<string> {
  let current: Promise<string> | null = null;
  const get = async (): Promise<string> => {
    const p = (current ??= build().catch((e) => {
      current = null;
      throw e;
    }));
    const dir = await p;
    if (!existsSync(path.join(dir, marker))) {
      if (current === p) current = null;
      return get();
    }
    const now = new Date();
    try { utimesSync(dir, now, now); } catch { /* folder yang hilang tetap dibuat ulang di pemakaian berikutnya */ }
    return dir;
  };
  return get;
}
