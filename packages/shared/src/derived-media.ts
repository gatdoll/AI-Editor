// File turunan di folder media (Fase 11): salinan pratinjau dan audio hasil reduksi noise.
// File mentah tidak pernah ditulis (aturan 1); semua di sini file baru di samping project. Murni, aman di browser.
import { DENOISE, PREVIEW } from "@app/config";

/** Browser bisa memutar file mentah apa adanya? (codec + format piksel; container tidak menentukan). */
export function isBrowserPlayable(codec: string | null | undefined, pixFmt: string | null | undefined): boolean {
  return !!codec && (PREVIEW.playableCodecs as readonly string[]).includes(codec) && !!pixFmt && (PREVIEW.playablePixFmts as readonly string[]).includes(pixFmt);
}

export const previewPath = (projectId: string, assetId: string) => `projects/${projectId}/preview/${assetId}.mp4`;

/** Kekuatan reduksi noise dibulatkan ke langkah DENOISE.step, dalam persen bulat (0 = mati). */
export function denoiseLevel(strength: unknown): number {
  const s = Number(strength);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.round(Math.min(1, Math.round(s / DENOISE.step) * DENOISE.step) * 100);
}

export const denoisePath = (projectId: string, assetId: string, level: number) => `projects/${projectId}/audio/${assetId}-nr${level}.m4a`;
