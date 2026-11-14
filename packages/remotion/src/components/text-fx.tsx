// Efek teks bersama subtitle dan judul: keluar halaman dan kata kunci (aksen / slam).
import { spring } from "remotion";
import { EASING, FX, type StyleDef } from "@app/config";
import type { CaptionToken } from "../captions.ts";
import type { TextFx } from "../build-props.ts";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Keluar halaman: 1 = tampil penuh, turun ke 0 dalam FX.exitSec terakhir (bila tidak "potong"). */
export function exitFactor(textFx: TextFx | undefined, t: number, pageEnd: number): number {
  if (!textFx || textFx.exit === "potong") return 1;
  return clamp01((pageEnd - t) / FX.exitSec);
}

/**
 * Kata kunci: aksen = 1.3x + kotak warna aksen menyapu kiri ke kanan (marker-underline);
 * slam = masuk dari 3x ke 1x dalam 6 frame ease-in lalu settle (score-slam). null bila bukan kata kunci.
 */
export function highlightLook(tok: CaptionToken, frame: number, fps: number, style: StyleDef) {
  if (!tok.hl) return null;
  const startFrame = Math.round((tok.startMs / 1000) * fps);
  const df = frame - startFrame;
  if (tok.hl === "aksen") {
    const sweep = df < 0 ? 0 : clamp01(df / FX.keyword.sweepFrames);
    return { scale: FX.keyword.scale, sweep, color: sweep > 0.5 ? style.colors.dark : style.colors.accent, transform: undefined as string | undefined, opacity: undefined as number | undefined };
  }
  const p = df < 0 ? 0 : clamp01(df / FX.slam.frames);
  const settle = df < FX.slam.frames ? 0 : spring({ frame: df - FX.slam.frames, fps, config: EASING.spring });
  const scale = df < FX.slam.frames ? FX.slam.fromScale - (FX.slam.fromScale - 1) * p * p : 1 + 0.06 * (1 - clamp01(settle));
  return { scale: FX.slam.scale, sweep: 0, color: style.colors.accent, transform: `scale(${scale})`, opacity: df < 0 ? 0 : 1 };
}

/** Kotak aksen di belakang kata, tumbuh dari kiri. */
export function SweepBox({ sweep, color }: { sweep: number; color: string }) {
  if (sweep <= 0) return null;
  return <span style={{ position: "absolute", left: `-${FX.keyword.padXEm}em`, right: `-${FX.keyword.padXEm}em`, top: `${FX.keyword.padYEm}em`, bottom: `${FX.keyword.padYEm}em`, background: color, borderRadius: `${FX.keyword.radiusEm}em`, transform: `scaleX(${sweep})`, transformOrigin: "left center", zIndex: -1 }} />;
}
