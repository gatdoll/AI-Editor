import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";

export const CACHE_DIR = path.resolve(process.env.WORKER_CACHE_DIR ?? ".cache");

export function assetDir(assetId: string): string {
  return path.join(CACHE_DIR, "assets", assetId);
}

/**
 * Hitung SHA-256 file di disk. Hanya MEMBACA; file mentah tidak pernah ditulis ulang (aturan 1).
 */
export async function hashFile(
  file: string,
  onProgress?: (fraction: number) => void,
): Promise<{ sha256: string; sizeBytes: number }> {
  const total = statSync(file).size;
  const hash = createHash("sha256");
  let read = 0;
  let lastReport = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    read += (chunk as Buffer).length;
    if (onProgress && total && read - lastReport > 64 * 1024 * 1024) {
      lastReport = read;
      onProgress(read / total);
    }
  }
  return { sha256: hash.digest("hex"), sizeBytes: read };
}
