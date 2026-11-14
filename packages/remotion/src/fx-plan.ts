// Efek editing berbasis frame (murni, tanpa React): transisi di sambungan, guncangan, dutch tilt,
// dan sorotan kata kunci. Dipakai pratinjau dan render sehingga hasilnya identik.
// Resep diadaptasi dari Shotcraft dan DigitalSamba toolkit (lihat docs/motion-sources.md); konstanta di config FX.
import { FX, type TransitionKind } from "@app/config";
import type { CaptionPage, Highlight } from "./captions.ts";

/** Sorotan kata kunci yang diminta pengguna, dalam detik video MENTAH. */
/** auto = dipilih kode (auto_highlight); diganti saat mode otomatis dijalankan lagi. */
export type HighlightRequest = { startS: number; endS: number; effect: Highlight; auto?: boolean };

export type FxPlan = {
  transition: { kind: TransitionKind; frames: number };
  /** Waktu sambungan pada timeline hasil (detik). */
  joins: number[];
  /** Awal guncangan (detik hasil) dan kekuatannya 0..1. */
  shakes: Array<{ t: number; amp: number }>;
  /** Awal dutch tilt (detik hasil) dan sudutnya (derajat, bertanda). */
  tilts: Array<{ t: number; deg: number }>;
};

export const EMPTY_FX: FxPlan = { transition: { kind: "tidak", frames: FX.transition.frames }, joins: [], shakes: [], tilts: [] };

export function normalizeHighlights(value: unknown): HighlightRequest[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is HighlightRequest => !!v && Number.isFinite(v.startS) && Number.isFinite(v.endS) && v.startS >= 0 && v.endS > v.startS && (v.effect === "aksen" || v.effect === "slam"))
    .slice(0, FX.highlightMax)
    .map((v) => ({ startS: v.startS, endS: v.endS, effect: v.effect, ...(v.auto === true ? { auto: true } : {}) }));
}

/** Tandai token subtitle yang titik tengahnya berada dalam rentang sorotan (detik hasil). Mengembalikan salinan. */
export function applyHighlights(pages: CaptionPage[], ranges: Array<{ start: number; end: number; effect: Highlight }>): CaptionPage[] {
  if (!ranges.length) return pages;
  return pages.map((p) => ({
    ...p,
    tokens: p.tokens.map((tok) => {
      const mid = (tok.startMs + tok.endMs) / 2000;
      const r = ranges.find((x) => mid >= x.start && mid <= x.end);
      return r ? { ...tok, hl: r.effect } : tok;
    }),
  }));
}

/** Bilangan semu-acak deterministik 0..1 dari bilangan bulat. */
export function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function planFx(args: {
  kind: TransitionKind;
  frames: number;
  joins: number[];
  shake: number;
  shakeAt: number[];
  slamAt: number[];
  tiltDeg: number;
  pageStarts: number[];
  durationS: number;
}): FxPlan {
  const shakes: FxPlan["shakes"] = [];
  const slamAmp = args.shake > 0 ? args.shake : 0.6; // slam selalu "mendarat" dengan guncangan (score-slam)
  const events = [
    ...args.slamAt.map((t) => ({ t: t + FX.slam.frames / 30, amp: slamAmp })),
    ...(args.shake > 0 ? args.shakeAt.map((t) => ({ t, amp: args.shake })) : []),
  ].sort((a, b) => a.t - b.t);
  for (const e of events) {
    if (e.t < 0 || e.t > args.durationS) continue;
    const last = shakes[shakes.length - 1];
    if (last && e.t - last.t < FX.shake.minGapSec) { last.amp = Math.max(last.amp, e.amp); continue; }
    shakes.push({ ...e });
  }

  const tilts: FxPlan["tilts"] = [];
  if (args.tiltDeg > 0) {
    let sign = 1;
    args.pageStarts.forEach((t, i) => {
      if (i === 0 || i % FX.tilt.everyNthPage !== 0) return;
      const last = tilts[tilts.length - 1];
      if (last && t - last.t < FX.tilt.minGapSec) return;
      if (t + FX.tilt.holdSec > args.durationS) return;
      tilts.push({ t, deg: args.tiltDeg * sign });
      sign = -sign;
    });
  }
  return { transition: { kind: args.kind, frames: args.frames }, joins: args.kind === "tidak" ? [] : args.joins, shakes, tilts };
}

const easeIn = (x: number) => x * x * x;
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export type FxState = { x: number; y: number; rot: number; scale: number; blur: number; skew: number; glitch: number; filter: string | null; seedFrame: number };

/**
 * Keadaan efek pada satu frame. x/y/blur dalam piksel output, rot dalam derajat.
 * Skala menutup sudut kosong saat miring, sehingga tidak ada tepi hitam.
 */
export function fxStateAt(plan: FxPlan | undefined, frame: number, fps: number, width: number, height: number): FxState {
  const s: FxState = { x: 0, y: 0, rot: 0, scale: 1, blur: 0, skew: 0, glitch: 0, filter: null, seedFrame: 0 };
  if (!plan) return s;
  const t = frame / fps;
  const unit = height / 1080;

  // Transisi: separuh sebelum sambungan (keluar), separuh sesudah (masuk)
  const half = plan.transition.frames / 2 / fps;
  const ji = plan.joins.findIndex((j) => Math.abs(t - j) <= half);
  if (ji >= 0) {
    const p = (t - plan.joins[ji]) / half; // -1..1
    const e = p < 0 ? easeIn(clamp01(p + 1)) : 1 - easeOut(clamp01(p)); // 0 -> 1 (puncak di sambungan) -> 0
    const dir = ji % 2 === 0 ? 1 : -1;
    switch (plan.transition.kind) {
      case "whip":
        s.x += (p < 0 ? -1 : 1) * dir * FX.transition.whipTravel * width * e;
        // Perbesar sejauh pergeseran agar tidak ada tepi hitam; saat itu gambar sudah sangat blur
        s.scale *= 1 + 2 * FX.transition.whipTravel * e;
        s.blur = Math.max(s.blur, FX.transition.whipBlurPx * unit * e);
        break;
      case "zoom":
        s.scale *= 1 + (FX.transition.zoomScale - 1) * e;
        s.blur = Math.max(s.blur, FX.transition.zoomBlurPx * unit * e);
        break;
      case "glitch": {
        const g = 1 - Math.abs(p);
        const step = Math.floor(frame / 2);
        s.glitch = g;
        s.seedFrame = step;
        s.x += (hash01(step * 7 + 1) - 0.5) * 2 * FX.transition.glitchJitter * width * g;
        s.skew = (hash01(step * 13 + 5) - 0.5) * 8 * g;
        s.filter = `contrast(${1 + 0.5 * g}) saturate(${1 + 0.8 * g}) hue-rotate(${(hash01(step * 3 + 9) - 0.5) * 60 * g}deg)`;
        break;
      }
    }
  }

  // Guncangan: peluruhan eksponensial, arah berganti tiap frame (lebih besar horizontal)
  for (const sh of plan.shakes) {
    const df = (t - sh.t) * fps;
    if (df < 0 || df > FX.shake.frames) continue;
    const a = FX.shake.ampPx * unit * sh.amp * Math.exp(-df / FX.shake.tauFrames);
    const f = Math.floor(df) + Math.round(sh.t * 1000);
    s.x += (hash01(f * 2 + 1) - 0.5) * 2 * a;
    s.y += (hash01(f * 2 + 2) - 0.5) * 1.4 * a;
  }

  // Dutch tilt: miring cepat, tahan, snap kembali
  for (const tl of plan.tilts) {
    const df = (t - tl.t) * fps;
    const holdF = FX.tilt.holdSec * fps;
    if (df < 0 || df > FX.tilt.inFrames + holdF + FX.tilt.outFrames) continue;
    const k = df < FX.tilt.inFrames ? easeOut(df / FX.tilt.inFrames)
      : df < FX.tilt.inFrames + holdF ? 1
      : 1 - easeIn(clamp01((df - FX.tilt.inFrames - holdF) / FX.tilt.outFrames));
    s.rot += tl.deg * k;
  }
  if (s.rot !== 0) {
    const r = Math.abs(s.rot) * Math.PI / 180;
    const ratio = Math.max(width / height, height / width);
    s.scale *= Math.cos(r) + Math.sin(r) * ratio;
  }
  return s;
}
