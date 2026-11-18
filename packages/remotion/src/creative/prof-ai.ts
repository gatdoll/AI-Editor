// Fase 27: Prof. AI untuk kode kreatif project Animasi (`import { ProfAI } from "character"`).
// Rig tulang + mesh (gaya Spine/Live2D) dari gambar ASLI (PNG transparan, T-pose):
// - Tulang: panggul -> badan -> leher/kepala; bahu -> siku -> tangan; pinggul -> lutut -> kaki.
// - Lengan dan kaki dibentangkan di jaring segitiga; tiap titik diberi bobot halus ke tulang atas/bawah, jadi siku dan lutut
//   menekuk melengkung (bukan patah). Badan dan kepala kaku. Wajah tampak depan = potongan varian yang sejajar piksel.
// - Gerak = fungsi murni frame (`profAiPose`), digambar ke <canvas> tiap frame: pratinjau = render.
// Tanpa JSX agar bisa diimpor tes Node.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import type { ProfAiData, ProfAiFile, ProfAiView, ProfAiViewRig } from "../../../shared/src/prof-ai.ts";
import { PROF_AI } from "@app/config";
import { blinkAt } from "./character.ts";
import { ProfAIMesh, PROF_AI_MESH_ACTIONS, type ProfAiMeshAction } from "./prof-ai-mesh.ts";

export const PROF_AI_ACTIONS = ["idle", "talk", "explain", "wave", "point", "present", "cheer", "jump", "nod", "shake", "shock", "think", "walk"] as const;
export type ProfAiAction = (typeof PROF_AI_ACTIONS)[number];
export const PROF_AI_EXPRESSIONS = ["neutral", "happy", "surprised", "thinking", "serious", "sad", "angry", "shy", "wink"] as const;
export type ProfAiExpression = (typeof PROF_AI_EXPRESSIONS)[number];
export type ProfAiMouth = "closed" | "small" | "wide" | "o";

export type ProfAIProps = {
  /** `data` dari Overlay: dibaca `data.profAi` (gambar + rig) dan `data.words` (mulut). */
  data: { profAi?: ProfAiData; words?: Array<{ text: string; start: number; end: number }> };
  /** Tinggi karakter di kanvas (piksel), dari puncak rambut sampai sepatu. */
  height: number;
  /** Tampak. Bawaan "front". `walk` memakai "threequarter" bila tampak depan/samping. */
  view?: ProfAiView;
  action?: ProfAiAction;
  /** Sisi lengan untuk wave/point/present, dari sudut pandang PENONTON. Bawaan "right". */
  dir?: "left" | "right";
  expression?: ProfAiExpression;
  /** Mulut bergerak mengikuti `data.words` (hanya saat ada kata yang sedang diucapkan). */
  talking?: boolean;
  /** Frame mulai aksi (jump, nod, shake, shock, walk) dan pergantian tampak. Bawaan 0. */
  from?: number;
  /** Ganti tampak: dari tampak ini ke `view`, mulai di `from` (squash cepat ala kartun). */
  turnFrom?: ProfAiView;
  /** Cermin horizontal (3/4 dan samping menghadap kanan; jalan ke kanan). */
  flip?: boolean;
  /** Jalan di tempat (tanpa berpindah). Bawaan false: `walk` maju sejauh langkahnya sendiri. */
  inPlace?: boolean;
  shadow?: boolean;
  /** Bawaan otomatis: tampak depan + idle/talk/explain/nod/shake/think/shock/jump = avatar mesh; lainnya rig tulang. "bones" = paksa rig tulang. */
  rig?: "auto" | "bones";
  /** Posisi kotak luar (left/top/transform). Lebar kotak = 0,6 x tinggi; kaki di tengah bawah kotak. */
  style?: React.CSSProperties;
};

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 0.5 - Math.cos(Math.PI * clamp01(x)) / 2;
const smooth = (a: number, b: number, x: number) => { const k = clamp01((x - a) / (b - a)); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- pose (murni)
/** Sudut dalam derajat CSS (searah jarum jam = +), relatif terhadap gambar T-pose. Panjang dalam satuan tinggi karakter. */
export type ProfAiPose = {
  x: number; y: number; rot: number; sx: number; sy: number;
  torso: number; breathe: number; head: number; headY: number;
  armL: { sh: number; el: number }; armR: { sh: number; el: number };
  legL: { hip: number; knee: number }; legR: { hip: number; knee: number };
  shadow: number;
};

/** Langkah per detik dan jarak tempuh per detik (satuan tinggi) agar kaki tidak meluncur. */
export function profAiWalk() {
  const P = PROF_AI.walk;
  const cyclesPerS = P.stepsPerS / 2;
  // Panjang kaki ±0,36 tinggi; jarak satu langkah = 2·L·sin(A)
  const stride = 2 * 0.36 * Math.sin((P.hipSwing * Math.PI) / 180);
  return { cyclesPerS, speed: stride * P.stepsPerS };
}

export function profAiPose(action: ProfAiAction, t: number, ta: number, o: { dir?: "left" | "right"; talking?: boolean; inPlace?: boolean } = {}): ProfAiPose {
  const P = PROF_AI;
  const dir = o.dir ?? "right";
  const breathe = P.breathe * Math.sin((TAU * t) / P.breathePeriodS);
  const sway = P.armSway * Math.sin((TAU * t) / P.armSwayPeriodS);
  const restL = { sh: -P.armRest - sway, el: -P.elbowRest };
  const restR = { sh: P.armRest + sway, el: P.elbowRest };
  const p: ProfAiPose = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, torso: 0, breathe, head: P.headSway * Math.sin((TAU * t) / P.headSwayPeriodS), headY: 0,
    armL: restL, armR: restR, legL: { hip: 0, knee: 0 }, legR: { hip: 0, knee: 0 }, shadow: 1 };
  const into = ease(ta / P.blendS);
  const mix = (a: { sh: number; el: number }, b: { sh: number; el: number }, k = into) => ({ sh: a.sh + (b.sh - a.sh) * k, el: a.el + (b.el - a.el) * k });
  // Lengan kanan penonton (+ = turun / siku menekuk ke dalam); kiri = cermin
  const R = (sh: number, el: number) => ({ sh, el });
  const L = (sh: number, el: number) => ({ sh: -sh, el: -el });
  const gesture = (phase: number, amp: number) => Math.max(0, Math.sin(TAU * t / P.explainPeriodS + phase)) * amp;

  if (o.talking || action === "talk") {
    p.head += 2 * Math.sin(TAU * t * 0.8);
    p.headY += -0.004 * Math.abs(Math.sin(TAU * t * 1.7));
  }
  switch (action) {
    case "talk":
      p.armL = mix(restL, L(P.armRest - 4, 18 + gesture(0, 30)));
      p.armR = mix(restR, R(P.armRest - 4, 18 + gesture(Math.PI, 30)));
      break;
    case "explain":
      p.armL = mix(restL, L(66 - gesture(0, 16), 40 + gesture(0, 70)));
      p.armR = mix(restR, R(66 - gesture(Math.PI, 16), 40 + gesture(Math.PI, 70)));
      p.torso = 1.5 * Math.sin(TAU * t / P.explainPeriodS);
      break;
    case "wave": {
      const w = -P.waveForearm + P.waveSwing * Math.sin((TAU * t) / P.wavePeriodS);
      if (dir === "right") p.armR = mix(restR, R(-6, w)); else p.armL = mix(restL, L(-6, w));
      p.head += (dir === "right" ? 3 : -3) * into;
      break;
    }
    case "point":
      if (dir === "right") p.armR = mix(restR, R(-6, 0)); else p.armL = mix(restL, L(-6, 0));
      p.torso = (dir === "right" ? 2 : -2) * into;
      break;
    case "present":
      if (dir === "right") p.armR = mix(restR, R(42, -28 + 4 * Math.sin(TAU * t * 0.5))); else p.armL = mix(restL, L(42, -28 + 4 * Math.sin(TAU * t * 0.5)));
      break;
    case "cheer": {
      const b = Math.abs(Math.sin(TAU * t * 1.6));
      p.armL = mix(restL, L(-62 + 10 * b, -20));
      p.armR = mix(restR, R(-62 + 10 * b, -20));
      p.y = -0.05 * b;
      p.sy = 1 + 0.02 * b;
      p.shadow = 1 - 0.25 * b;
      break;
    }
    case "jump": {
      const x = ta / P.jumpS;
      if (x >= 0 && x <= 1) {
        const crouch = x < 0.2 ? Math.sin((x / 0.2) * Math.PI) : 0;
        const air = x >= 0.2 && x <= 0.85 ? Math.sin(((x - 0.2) / 0.65) * Math.PI) : 0;
        const land = x > 0.85 ? Math.sin(((x - 0.85) / 0.15) * Math.PI) : 0;
        p.y = -P.jumpHeight * air + 0.03 * (crouch + land);
        p.sy = 1 - 0.07 * (crouch + land) + 0.05 * air;
        p.sx = 1 + 0.05 * (crouch + land) - 0.03 * air;
        p.armL = L(P.armRest - 110 * air + 10 * crouch, -10 - 20 * air);
        p.armR = R(P.armRest - 110 * air + 10 * crouch, -10 - 20 * air);
        p.legL = { hip: 6 * air, knee: -22 * air };
        p.legR = { hip: -6 * air, knee: 22 * air };
        p.shadow = 1 - 0.5 * air;
      }
      break;
    }
    case "nod": {
      const x = ta / 0.9;
      if (x >= 0 && x <= 1) p.headY += 0.018 * Math.sin(x * TAU * 2) * (1 - x);
      break;
    }
    case "shake": {
      const x = ta / 0.9;
      if (x >= 0 && x <= 1) p.head += 9 * Math.sin(x * TAU * 3) * (1 - x);
      break;
    }
    case "shock": {
      if (ta >= 0) {
        const pop = ta / 0.5 <= 1 ? Math.sin((ta / 0.5) * Math.PI) : 0;
        const k = ease(ta / 0.12) * (ta <= 1.4 ? 1 : Math.max(0, 1 - (ta - 1.4) / 0.4));
        p.y = -0.06 * pop;
        p.armL = mix(restL, L(22, -55), k);
        p.armR = mix(restR, R(22, -55), k);
        p.head += ta <= 0.5 ? 4 * Math.sin((ta / 0.5) * TAU * 2) : 0;
      }
      break;
    }
    case "think":
      p.armR = mix(restR, R(-12, P.thinkElbow + 4 * Math.sin(TAU * t * 2.2)));
      p.armL = mix(restL, L(80, 70));
      p.head += 6 * into;
      break;
    case "walk": {
      const W = P.walk;
      const { cyclesPerS, speed } = profAiWalk();
      const ph = Math.max(0, ta) * cyclesPerS;
      const leg = (phase: number) => {
        const th = TAU * (ph + phase);
        return { hip: W.hipSwing * Math.sin(th), knee: -(W.kneeBend * Math.pow(Math.max(0, Math.cos(th)), 1.3) + 6) };
      };
      p.legL = leg(0);
      p.legR = leg(0.5);
      const sL = Math.sin(TAU * ph), sR = Math.sin(TAU * (ph + 0.5));
      // Lengan berayun berlawanan dengan kaki sisi yang sama; siku sedikit menekuk saat ke depan
      p.armL = { sh: -(P.armRest + 4) + W.armSwing * sR, el: -(12 + 18 * Math.max(0, sR)) };
      p.armR = { sh: P.armRest + 4 + W.armSwing * sL, el: 12 + 18 * Math.max(0, sL) };
      p.y = -W.bob * (1 - Math.abs(Math.sin(TAU * ph)));
      p.torso = -W.lean;
      p.head += 1.5 * Math.sin(TAU * ph * 2);
      if (!o.inPlace) p.x = -speed * Math.max(0, ta);
      break;
    }
  }
  return p;
}

const VOWEL: Record<string, ProfAiMouth> = { a: "wide", e: "wide", o: "o", u: "o", i: "small" };

/** Bentuk mulut pada detik `t` dari waktu kata: di luar kata = tertutup; di dalam kata = vokal huruf yang sedang dibaca. */
export function profAiMouth(words: Array<{ text: string; start: number; end: number }>, t: number): ProfAiMouth {
  const w = words.find((x) => t >= x.start && t < x.end);
  if (!w) return "closed";
  const letters = w.text.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return "small";
  const q = Math.floor((t - w.start) / PROF_AI.mouthMinS) * PROF_AI.mouthMinS;
  const i = Math.min(letters.length - 1, Math.floor((q / Math.max(0.01, w.end - w.start)) * letters.length));
  for (let k = i; k < letters.length; k++) if (VOWEL[letters[k]]) return VOWEL[letters[k]];
  for (let k = i; k >= 0; k--) if (VOWEL[letters[k]]) return VOWEL[letters[k]];
  return "small";
}

// ---------------------------------------------------------------- matriks 2D [a b c d e f] (sama dengan canvas)
type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const tr = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const sc = (x: number, y: number): M => [x, 0, 0, y, 0, 0];
const rotAt = (px: number, py: number, deg: number): M => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return mul(tr(px, py), mul([c, s, -s, c, 0, 0], tr(-px, -py))); };
const ap = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Satu segitiga bertekstur: peta afin sumber -> tujuan, klip sedikit diperbesar agar tidak ada celah antar segitiga. */
function triangle(ctx: CanvasRenderingContext2D, img: CanvasImageSource, s: [number, number][], d: [number, number][]) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const [[u0, v0], [u1, v1], [u2, v2]] = d;
  const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(den) < 1e-6) return;
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den;
  const c = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den;
  const e = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
  const b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den;
  const dd = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
  const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
  // Perbesar dari titik pusat lingkaran dalam: SETIAP sisi bergeser keluar tepat GROW px (segitiga tipis juga), jadi tepi
  // anti-alias tiap segitiga jatuh di atas tetangganya dan tidak ada garis celah.
  const la = Math.hypot(u1 - u2, v1 - v2), lb = Math.hypot(u0 - u2, v0 - v2), lc = Math.hypot(u0 - u1, v0 - v1), per = la + lb + lc;
  const area = Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2;
  if (per < 1e-6 || area < 1e-6) return;
  const cx = (la * u0 + lb * u1 + lc * u2) / per, cy = (la * v0 + lb * v1 + lc * v2) / per;
  const k = 1 + 1.4 / ((2 * area) / per);
  const grow = (u: number, v: number): [number, number] => [cx + (u - cx) * k, cy + (v - cy) * k];
  const g = [grow(u0, v0), grow(u1, v1), grow(u2, v2)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g[0][0], g[0][1]); ctx.lineTo(g[1][0], g[1][1]); ctx.lineTo(g[2][0], g[2][1]); ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, dd, e, f);
  const sx = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 2)), sy = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 2));
  const sw = Math.ceil(Math.max(x0, x1, x2) + 2) - sx, sh = Math.ceil(Math.max(y0, y1, y2) + 2) - sy;
  ctx.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
  ctx.restore();
}

/**
 * Anggota badan dua tulang di jaring. `axis` = arah tulang dalam gambar (lengan: horizontal, kaki: vertikal).
 * Titik di sepanjang sumbu diberi bobot halus ke tulang atas (m1) atau bawah (m2) di sekitar sendi tengah.
 */
function limb(ctx: CanvasRenderingContext2D, img: CanvasImageSource, view: M, rect: { u0: number; u1: number; v0: number; v1: number }, axis: "x" | "y", joint: number, blend: number, m1: M, m2: M, segs = 16) {
  const pts: Array<{ s: [number, number]; d: [number, number] }> = [];
  const rows = 3;
  for (let i = 0; i <= segs; i++) {
    const u = rect.u0 + ((rect.u1 - rect.u0) * i) / segs;
    for (let j = 0; j < rows; j++) {
      const v = rect.v0 + ((rect.v1 - rect.v0) * j) / (rows - 1);
      const [x, y] = axis === "x" ? [u, v] : [v, u];
      const along = Math.abs(u - rect.u0);
      const w2 = smooth(joint - blend, joint + blend, along);
      const a = ap(m1, x, y), b = ap(m2, x, y);
      const d = ap(view, a[0] * (1 - w2) + b[0] * w2, a[1] * (1 - w2) + b[1] * w2);
      pts.push({ s: [x, y], d });
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rows - 1; j++) {
    const p00 = pts[i * rows + j], p01 = pts[i * rows + j + 1], p10 = pts[(i + 1) * rows + j], p11 = pts[(i + 1) * rows + j + 1];
    triangle(ctx, img, [p00.s, p10.s, p11.s], [p00.d, p10.d, p11.d]);
    triangle(ctx, img, [p00.s, p11.s, p01.s], [p00.d, p11.d, p01.d]);
  }
}

/** Bagian kaku: gambar dengan transform `m`, dipotong poligon (koordinat gambar). */
function rigid(ctx: CanvasRenderingContext2D, img: CanvasImageSource, m: M, clip: Array<[number, number]> | { cx: number; cy: number; r: number }, src?: { x: number; y: number; w: number; h: number }) {
  ctx.save();
  ctx.transform(...m);
  ctx.beginPath();
  if (Array.isArray(clip)) { ctx.moveTo(clip[0][0], clip[0][1]); for (const [x, y] of clip.slice(1)) ctx.lineTo(x, y); ctx.closePath(); }
  else ctx.arc(clip.cx, clip.cy, clip.r, 0, TAU);
  ctx.clip();
  if (src) ctx.drawImage(img, src.x, src.y, src.w, src.h, src.x, src.y, src.w, src.h);
  else ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------- pemuat gambar (delayRender sampai semua siap)
const cache = new Map<string, Promise<HTMLImageElement>>();
const loaded = new Map<string, HTMLImageElement>();
function loadImg(src: string): Promise<HTMLImageElement> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => { loaded.set(src, im); res(im); }; im.onerror = () => rej(new Error(`Prof. AI: gambar gagal dimuat (${src})`)); im.src = src; });
    cache.set(src, p);
  }
  return p;
}

// Rig tulang hanya punya 4 gambar ekspresi: sad/angry -> serious, shy/wink -> happy (avatar mesh punya semuanya)
const EXPR_FILE: Record<Exclude<ProfAiExpression, "neutral">, ProfAiFile> = { happy: "expr-happy.png", surprised: "expr-surprised.png", thinking: "expr-thinking.png", serious: "expr-serious.png", sad: "expr-serious.png", angry: "expr-serious.png", shy: "expr-happy.png", wink: "expr-happy.png" };
const MOUTH_FILE: Record<ProfAiMouth, ProfAiFile> = { closed: "mouth-closed.png", small: "mouth-small.png", wide: "mouth-wide.png", o: "mouth-o.png" };

/** Gambar satu frame Prof. AI ke canvas. `origin` = titik kaki (tengah bawah) di canvas, `s` = skala gambar -> canvas. */
function draw(ctx: CanvasRenderingContext2D, off: CanvasRenderingContext2D, pa: ProfAiData, vr: ProfAiViewRig, isFront: boolean, pose: ProfAiPose, face: { eyes?: string; mouth?: string }, s: number, origin: [number, number], height: number, shadow: boolean) {
  const img = loaded.get(pa.src[vr.file as ProfAiFile] ?? "");
  if (!img) return;
  const footY = vr.box.y + vr.box.h;
  const cx = vr.neck.cx;
  // Tampilan: gambar -> canvas (skala, kaki di origin) + gerak seluruh badan (pantul, miring, squash) di titik kaki
  const view = mul(tr(origin[0] + pose.x * height, origin[1] + pose.y * height), mul(rotAt(0, 0, pose.rot), mul(sc(s * pose.sx, s * pose.sy), tr(-cx, -footY))));
  if (shadow) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${(PROF_AI.shadowOpacity * pose.shadow).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(origin[0] + pose.x * height, origin[1] - height * 0.005, height * 0.18 * (0.75 + 0.25 * pose.shadow), height * 0.02, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  const legs = vr.legs, arms = vr.arms;
  const pelvisY = legs ? legs.hem : footY;
  // Badan: miring di panggul + napas (skala vertikal dari panggul)
  const torso = mul(rotAt(cx, pelvisY, pose.torso), mul(tr(cx, pelvisY), mul(sc(1, 1 + pose.breathe), tr(-cx, -pelvisY))));
  const W = vr.width, H = vr.height, neckY = vr.neck.y, ov = vr.box.h * 0.03;
  const head = mul(torso, mul(tr(0, pose.headY * vr.box.h), rotAt(cx, neckY, pose.head)));

  // 1. Kaki (di belakang jas): pinggul -> lutut -> pergelangan
  if (legs) {
    const top = legs.hem - vr.box.h * 0.035;
    // Panggul celana (di belakang kaki) menutup celah selangkangan saat kaki membuka
    rigid(ctx, img, view, [[legs.jointL - 40, top], [legs.jointR + 40, top], [legs.jointR + 40, legs.hip + 14], [legs.jointL - 40, legs.hip + 14]]);
    for (const side of ["L", "R"] as const) {
      const jx = side === "L" ? legs.jointL : legs.jointR;
      const hipJ: [number, number] = [jx, legs.hem];
      const kneeY = (legs.hem + legs.ankle) / 2;
      const lp = side === "L" ? pose.legL : pose.legR;
      const thigh = rotAt(hipJ[0], hipJ[1], lp.hip);
      const shin = mul(thigh, rotAt(jx, kneeY, lp.knee));
      const x0 = side === "L" ? vr.box.x - 4 : legs.split, x1 = side === "L" ? legs.split : vr.box.x + vr.box.w + 4;
      limb(ctx, img, view, { u0: top, u1: footY + 4, v0: x0, v1: x1 }, "y", kneeY - top, vr.box.h * 0.05, thigh, shin, 10);
    }
  }
  // 2. Badan (tanpa pita lengan), menimpa pangkal kaki
  const hemY = legs ? legs.hem + 2 : H;
  let torsoClip: Array<[number, number]>;
  const nl = vr.neck.l, nr = vr.neck.r;
  if (arms) {
    const bt = Math.min(arms.left.top, arms.right.top) - 6, bb = Math.max(arms.left.bottom, arms.right.bottom) + 6;
    torsoClip = [[0, neckY], [nl, neckY], [nl, neckY - ov], [nr, neckY - ov], [nr, neckY], [W, neckY], [W, bt], [arms.right.cut, bt], [arms.right.cut, bb], [W, bb], [W, hemY], [0, hemY], [0, bb], [arms.left.cut, bb], [arms.left.cut, bt], [0, bt]];
  } else torsoClip = [[0, neckY], [nl, neckY], [nl, neckY - ov], [nr, neckY - ov], [nr, neckY], [W, neckY], [W, hemY], [0, hemY]];
  rigid(ctx, img, mul(view, torso), torsoClip);
  // 3. Kepala + wajah
  const headClip: Array<[number, number]> = [[0, 0], [W, 0], [W, neckY], [0, neckY]];
  rigid(ctx, img, mul(view, head), headClip);
  const fr = pa.rig.face;
  if (isFront && fr && fr.split != null) {
    const up = { x: fr.box.x, y: fr.box.y, w: fr.box.w, h: fr.split - fr.box.y };
    const lo = { x: fr.box.x, y: fr.split, w: fr.box.w, h: fr.box.y + fr.box.h - fr.split };
    const eyes = face.eyes ? loaded.get(face.eyes) : undefined;
    const mouth = face.mouth ? loaded.get(face.mouth) : undefined;
    if (eyes) rigid(ctx, eyes, mul(view, head), [[up.x, up.y], [up.x + up.w, up.y], [up.x + up.w, up.y + up.h], [up.x, up.y + up.h]], up);
    if (mouth) rigid(ctx, mouth, mul(view, head), [[lo.x, lo.y], [lo.x + lo.w, lo.y], [lo.x + lo.w, lo.y + lo.h], [lo.x, lo.y + lo.h]], lo);
  }
  // 4. Lengan: bahu -> siku -> tangan, digambar ke kanvas samping lalu diberi garis tepi (menutup potongan bahu)
  if (arms) {
    const o = Math.max(1, 1.4 * s);
    for (const side of ["left", "right"] as const) {
      const a = arms[side];
      const sign = side === "left" ? -1 : 1; // arah ujung jari dari bahu
      const len = Math.abs(a.tip - a.pivot.x);
      const elbowAt = len * PROF_AI.elbowAt;
      const ap0 = ap(torso, a.pivot.x, a.pivot.y);
      const pr = side === "left" ? pose.armL : pose.armR;
      // Tulang atas ikut badan (bahu menempel), lalu berputar di bahu; tulang bawah berputar di siku
      const upper = mul(tr(ap0[0] - a.pivot.x, ap0[1] - a.pivot.y), rotAt(a.pivot.x, a.pivot.y, pr.sh));
      const lower = mul(upper, rotAt(a.pivot.x + sign * elbowAt, a.pivot.y, pr.el));
      off.setTransform(1, 0, 0, 1, 0, 0);
      off.clearRect(0, 0, off.canvas.width, off.canvas.height);
      const r = Math.min(a.pivot.y - a.top + 2, a.bottom + 4 - a.pivot.y);
      rigid(off, img, mul(view, upper), { cx: a.pivot.x, cy: a.pivot.y, r });
      const tip = a.tip + sign * 12;
      limb(off, img, view, { u0: a.pivot.x, u1: tip, v0: a.top - 2, v1: a.bottom + 4 }, "x", elbowAt, len * 0.07, upper, lower, 12);
      ctx.save();
      ctx.filter = `drop-shadow(${o}px 0 0 #1b1b1b) drop-shadow(-${o}px 0 0 #1b1b1b) drop-shadow(0 ${o}px 0 #1b1b1b) drop-shadow(0 -${o}px 0 #1b1b1b)`;
      ctx.drawImage(off.canvas, 0, 0);
      ctx.restore();
    }
  }
}

export function ProfAI(props: ProfAIProps): React.ReactElement | null {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const pa = props.data.profAi;
  const srcs = pa ? Object.entries(pa.src).filter(([f, x]) => !!x && f.endsWith(".png")).map(([, x]) => x as string) : [];
  const key = srcs.join("|");
  const [ready, setReady] = useState(() => srcs.every((s) => loaded.has(s)));
  useEffect(() => {
    if (ready || !srcs.length) return;
    const handle = delayRender("Prof. AI: memuat gambar");
    let alive = true;
    Promise.all(srcs.map(loadImg)).then(() => { if (alive) setReady(true); continueRender(handle); }, (e) => { console.error(String(e)); continueRender(handle); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const t = frame / fps;
  const from = props.from ?? 0;
  const ta = (frame - from) / fps;
  const action = props.action ?? "idle";
  let viewName: ProfAiView = props.view ?? "front";
  if (action === "walk" && (viewName === "front" || viewName === "side")) viewName = "threequarter";
  let turnSx = 1;
  if (props.turnFrom && props.turnFrom !== viewName && ta >= 0 && ta < PROF_AI.turnS) {
    const x = ta / PROF_AI.turnS;
    if (x < 0.5) viewName = props.turnFrom;
    turnSx = 0.12 + 0.88 * Math.abs(1 - 2 * x);
  }
  const { height } = props;
  const cw = height * 0.6;
  // Kanvas lebih besar dari kotak luar: ruang untuk tangan terangkat/terentang dan langkah
  const CW = Math.round(height * 1.6), CH = Math.round(height * 1.3);
  const talking = !!props.talking || action === "talk";
  const pose = profAiPose(action, t, ta, { dir: props.dir, talking, inPlace: props.inPlace });
  // Perpindahan jalan di luar canvas (canvas hanya selebar karakter); arah ikut flip
  const travel = pose.x * height * (props.flip ? -1 : 1);

  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !pa || !ready) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    if (!offRef.current) offRef.current = document.createElement("canvas");
    const off = offRef.current;
    if (off.width !== CW || off.height !== CH) { off.width = CW; off.height = CH; }
    const octx = off.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    const vr = pa.rig.views[viewName] ?? pa.rig.views.front;
    const isFront = vr === pa.rig.views.front;
    const expression: ProfAiExpression = props.expression ?? (action === "shock" && ta >= 0 && ta < 1.6 ? "surprised" : action === "think" ? "thinking" : action === "cheer" ? "happy" : "neutral");
    const exprFile = expression === "neutral" ? undefined : pa.src[EXPR_FILE[expression]];
    const blink = (expression === "neutral" || expression === "serious") && blinkAt(t, 11) > 0.35;
    const words = props.data.words ?? [];
    const mouth = talking ? pa.src[MOUTH_FILE[words.length ? profAiMouth(words, t) : (["closed", "small", "wide", "o"] as const)[Math.floor(t / 0.11) % 4]]] : exprFile;
    const s = height / vr.box.h;
    draw(ctx, octx, pa, vr, isFront, { ...pose, x: 0 }, { eyes: blink ? pa.src["front-blink.png"] : exprFile, mouth }, s, [CW / 2, height + (CH - height) * 0.9], height, props.shadow !== false);
  });

  if (!pa) return null;
  // Tampak depan + aksi yang bisa dikerjakan mesh = avatar mesh (lebih hidup). Gerak besar dan tampak lain = rig tulang.
  const mesh = pa.rig.mesh && pa.src[pa.rig.mesh.file];
  if (mesh && props.rig !== "bones" && viewName === "front" && turnSx === 1 && (PROF_AI_MESH_ACTIONS as readonly string[]).includes(action)) {
    return React.createElement(ProfAIMesh, { data: props.data, height, action: action as ProfAiMeshAction, expression: props.expression, talking: props.talking, dir: props.dir, from: props.from, flip: props.flip, shadow: props.shadow, style: props.style });
  }
  const top = -(CH - height) * 0.9;
  return React.createElement("div", { style: { position: "relative", width: cw, height, ...props.style } },
    React.createElement("canvas", { ref, width: CW, height: CH, style: { position: "absolute", left: (cw - CW) / 2, top, width: CW, height: CH, transformOrigin: `50% ${((height - top) / CH) * 100}%`, transform: `translateX(${travel.toFixed(2)}px) scale(${turnSx * (props.flip ? -1 : 1)}, 1)` } }));
}
