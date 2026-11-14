// Fase 25: rig karakter dari gambar bahan (apps/worker/py/rig.py, venv talent: OpenCV + YuNet). Gambar asli hanya DIBACA
// (aturan 1); hasilnya projects/<pid>/rig/<assetId>.json. Gambar yang bukan karakter berdiri (foto, grafik, latar tidak polos)
// tidak di-rig dan alasannya dicatat (aturan 7). Dipanggil job Kreatif bila pengguna mencentang "Rig karakter" (payload.rig).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { TALENT } from "@app/config";
import { resolveMediaPath } from "@app/shared";
import { parseRig, rigRel, type CharacterRig } from "@app/shared/rig";
import { loadRig } from "@app/shared/rig-store";
import { REPO_ROOT } from "./creative/workdir.ts";
import { talentPython } from "./talent.ts";

const TIMEOUT_MS = 90_000;

/** Jalankan rig.py untuk satu gambar. Bukan karakter / gagal = error dengan alasan. */
export async function rigImage(file: string, signal?: AbortSignal): Promise<CharacterRig> {
  const py = talentPython();
  if (!existsSync(py)) throw new Error("Alat rig belum dipasang. Jalankan sekali: npm run setup:talent");
  const script = path.join(REPO_ROOT, "apps/worker/py/rig.py");
  const models = path.join(REPO_ROOT, TALENT.modelDir);
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(py, ["-I", script, file, models], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let so = "", se = "";
    const kill = (why: string) => { if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill("SIGKILL"); reject(new Error(why)); };
    const timer = setTimeout(() => kill("Rig melewati batas waktu."), TIMEOUT_MS);
    const onAbort = () => kill(signal?.reason instanceof Error ? signal.reason.message : "Dibatalkan.");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (d: Buffer) => { so += d; });
    child.stderr.on("data", (d: Buffer) => { se = (se + d).slice(-2000); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve(so); else reject(new Error(se.trim().split(/\r?\n/).pop() || `kode ${code}`));
    });
  });
  const rig = parseRig(JSON.parse(out));
  if (!rig) throw new Error("hasil rig tidak sah");
  const bad = rig.notes.find((n) => n.startsWith("latar tidak terpisah"));
  if (bad) throw new Error(`bukan karakter dengan latar polos (${bad})`);
  if (!rig.eyes && !rig.legs) throw new Error("wajah dan kaki tidak terdeteksi: kemungkinan bukan karakter berdiri");
  return rig;
}

/**
 * Rig semua gambar karakter yang belum punya rig. Logo dilewati. Hasil per gambar dicatat lewat `log`.
 * Mengembalikan jumlah gambar yang ber-rig (lama + baru).
 */
export async function ensureRigs(projectId: string, images: Array<{ id: string; label: string; file: string; role?: string }>, log: (text: string) => void, signal?: AbortSignal): Promise<number> {
  let ready = 0;
  for (const im of images) {
    if (im.role === "logo") continue;
    if (loadRig(projectId, im.id)) { ready++; continue; }
    signal?.throwIfAborted();
    try {
      const rig = await rigImage(im.file, signal);
      const dest = resolveMediaPath(rigRel(projectId, im.id));
      await mkdir(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(rig));
      await rename(tmp, dest);
      ready++;
      log(`✓ Rig ${im.label}${rig.notes.length ? ` (${rig.notes.join("; ")})` : ""}`);
    } catch (e) {
      if (signal?.aborted) throw e;
      log(`– ${im.label} tidak di-rig: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    }
  }
  return ready;
}
