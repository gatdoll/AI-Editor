// Opsi memori renderMedia. Murni agar bisa dites tanpa memuat @remotion/renderer.
import { VIDEO } from "@app/config";

export type RenderTuning = { offthreadVideoCacheSizeInBytes: number; concurrency?: number };

/** Cache mengikuti RAM bebas dengan batas bawah/atas; percobaan ulang memakai concurrency rendah. */
export function renderTuning(a: { freeBytes: number; retry?: boolean; envConcurrency?: string }): RenderTuning {
  const { freeShare, minBytes, maxBytes } = VIDEO.renderCache;
  const offthreadVideoCacheSizeInBytes = Math.floor(Math.min(maxBytes, Math.max(minBytes, a.freeBytes * freeShare)));
  // Mesin dengan memori/pagefile kecil: RENDER_CONCURRENCY=1 atau 2 mencegah "malloc failed" (bawaan Remotion: separuh CPU)
  const env = Number(a.envConcurrency);
  const fromEnv = env > 0 ? env : undefined;
  const concurrency = a.retry ? Math.min(fromEnv ?? VIDEO.retryConcurrency, VIDEO.retryConcurrency) : fromEnv;
  return { offthreadVideoCacheSizeInBytes, ...(concurrency ? { concurrency } : {}) };
}
