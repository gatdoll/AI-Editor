import { MOTION } from "@app/config";
import type { CaptionPage } from "./captions.ts";

export type MotionScene = { start: number; end: number; index: number };
export type MotionDesign = { enabled: boolean; strength: number; scenes: MotionScene[]; spatial?: "datar" | "orbit" | "parallax" };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
// Quintic easing: zero velocity AND acceleration at rest, deterministic during seeks.
export const motionEase = (n: number) => { const t = clamp01(n); return t * t * t * (t * (t * 6 - 15) + 10); };

/** Shotcraft BlurSlide: opacity, displacement and focus share one quint-out curve. */
export const blurSlideProgress = (elapsed: number) => 1 - Math.pow(1 - clamp01(elapsed / MOTION.blurSlide.durationSec), MOTION.blurSlide.outPower);

export function spatialMotionAt(design: MotionDesign | undefined, t: number) {
  const amount = design?.enabled ? motionAt(design.scenes, t).amount * design.strength : 0;
  const phase = t / MOTION.spatial.periodSec * Math.PI * 2;
  const orbit = design?.spatial === "orbit";
  const parallax = design?.spatial === "parallax";
  return {
    amount,
    x: parallax ? Math.sin(phase) * MOTION.spatial.parallaxX * amount : 0,
    rotX: orbit ? Math.cos(phase) * MOTION.spatial.tiltX * amount : 0,
    rotY: orbit ? Math.sin(phase) * MOTION.spatial.tiltY * amount : 0,
    rotZ: orbit || parallax ? Math.sin(phase) * MOTION.spatial.roll * amount : 0,
  };
}

/** Framing accents begin on a spoken phrase; no added cuts or change to EDL duration. */
export function planMotion(pages: CaptionPage[], duration: number, interval: number = MOTION.sceneGapSec): MotionScene[] {
  const scenes: MotionScene[] = [];
  let next = MOTION.sceneStartSec;
  for (const p of pages) {
    if (p.start < next || !Number.isFinite(p.start)) continue;
    const start = Math.max(0, p.start - MOTION.sceneLeadSec);
    const end = Math.min(duration, start + MOTION.sceneMaxSec);
    if (end - start < MOTION.sceneMinSec) continue;
    scenes.push({ start, end, index: scenes.length });
    next = end + Math.max(0, interval);
  }
  return scenes;
}

export function motionAt(scenes: MotionScene[], t: number): { amount: number; index: number } {
  const scene = scenes.find((s) => t >= s.start && t < s.end);
  if (!scene) return { amount: 0, index: 0 };
  const entrance = motionEase((t - scene.start) / MOTION.entranceSec);
  const exit = motionEase((scene.end - t) / MOTION.exitSec);
  return { amount: Math.min(entrance, exit), index: scene.index };
}

export function wordMotion(t: number, start: number, end: number, pageEnd: number) {
  const enter = motionEase((t - start) / MOTION.wordRevealSec);
  // Never hide a word before it has finished being spoken.
  const exitLength = Math.min(MOTION.exitSec, Math.max(0, pageEnd - end));
  const exit = exitLength > 0 ? motionEase((pageEnd - t) / exitLength) : 1;
  return { enter, exit, opacity: enter * exit };
}
