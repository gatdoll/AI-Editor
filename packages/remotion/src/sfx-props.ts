// Fase 14: isyarat SFX -> props komposisi (Edited dan Motion). Murni; satu rumus untuk pratinjau dan render.
import { SFX } from "@app/config";
import type { SfxCue, StyleSfx } from "../../shared/src/sfx.ts";
import type { FrameSegment } from "./frames.ts";
import { mapRangeToOutput } from "./timeline.ts";

export type SfxProp = { id: string; src: string; from: number; volume: number; /** Panjang (frame): Sequence tanpa panjang tetap terpasang sampai akhir video. */ frames: number };

/**
 * Fase 14: isyarat SFX -> frame hasil. Isyarat gaya (waktu mentah) yang jatuh di bagian terpotong dibuang; isyarat versi
 * kreatif sudah dalam waktu hasil. Volume x master (audio.sfx). Dipakai komposisi Edited dan Motion.
 */
export function buildSfxProps(a: { style: { params: Record<string, unknown>; sfx?: StyleSfx }; creativeSfx?: SfxCue[] | null; frameSegs: FrameSegment[] | null; fps: number; durationS: number; srcFor?: (id: string) => string; /** Durasi suara (detik) dari pustaka. */ lengthFor?: (id: string) => number | undefined }): SfxProp[] {
  const master = Number(a.style.params["audio.sfx"] ?? SFX.defaultMaster);
  if (!(master > 0)) return [];
  const src = a.srcFor ?? ((id: string) => `/api/sfx/${encodeURIComponent(id)}/file`);
  const frames = (id: string) => Math.max(1, Math.ceil(Math.min(SFX.maxLenS, a.lengthFor?.(id) || SFX.fallbackLenS) * a.fps) + 2);
  const out: SfxProp[] = [];
  for (const c of a.style.sfx?.cues ?? []) {
    const t = a.frameSegs ? mapRangeToOutput(a.frameSegs, a.fps, c.at, c.at + 0.02)?.start : c.at;
    if (t !== undefined && t < a.durationS) out.push({ id: c.id, src: src(c.id), from: Math.round(t * a.fps), volume: c.volume * master, frames: frames(c.id) });
  }
  if (a.style.sfx?.useCreative !== false) for (const c of a.creativeSfx ?? []) if (c.at < a.durationS) out.push({ id: c.id, src: src(c.id), from: Math.round(c.at * a.fps), volume: c.volume * master, frames: frames(c.id) });
  return out.sort((x, y) => x.from - y.from);
}

