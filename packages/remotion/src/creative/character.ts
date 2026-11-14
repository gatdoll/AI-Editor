// Fase 25: karakter ber-rig untuk kode kreatif (`import { Character } from "character"`). Gambar bahan ASLI dipotong
// dengan clip-path menjadi kaki kiri/kanan, badan, dan kepala (latar dibuang topeng alfa dari rig), lalu digerakkan dari
// frame: napas, ayun kepala, kedip, mulut bicara, jalan, lompat, angguk, geleng, sorak, kaget, berpikir.
// Tanpa rig = gambar utuh dengan gerak napas/ayun sederhana (kode AI tetap jalan). Tanpa JSX agar bisa diimpor tes Node.
import React from "react";
import { Img, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { CharacterRig } from "../../../shared/src/rig.ts";
import { CHARACTER } from "@app/config";

export const CHARACTER_ACTIONS = ["idle", "talk", "walk", "jump", "nod", "shake", "cheer", "shock", "think"] as const;
export type CharacterAction = (typeof CHARACTER_ACTIONS)[number];

export type CharacterProps = {
  /** Satu entri data.assets (gambar). Ber-rig = `asset.rig` ada. */
  asset: { id: string; src: string; width?: number; height?: number; rig?: CharacterRig };
  /** Tinggi karakter di kanvas (piksel), dari kepala sampai sepatu. */
  height: number;
  /** Gerakan. Bawaan "idle" (napas + ayun kepala + kedip). */
  action?: CharacterAction;
  /** Mulut bergerak (sedang bicara). Bisa digabung dengan action apa pun. */
  talking?: boolean;
  /** Frame mulai aksi sekali jalan (jump, shock, nod, shake). Bawaan 0. */
  from?: number;
  /** Cermin horizontal (menghadap ke arah lain). */
  flip?: boolean;
  /** Bayangan lantai (bawaan true). */
  shadow?: boolean;
  /** Pembeda waktu kedip/ayun antar karakter (bawaan dari id aset). */
  seed?: number;
  /** Gaya kotak luar (posisi: position/left/top/transform). Ukuran kotak = kotak karakter. */
  style?: React.CSSProperties;
};

const h = React.createElement;
const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 0.5 - Math.cos(Math.PI * clamp01(x)) / 2;
const hash = (s: string) => { let n = 0; for (const c of s) n = (n * 31 + c.charCodeAt(0)) % 1000; return n; };

/** Pose pada detik `t` (sejak awal) dan `ta` (sejak `from`). Murni: diuji tanpa React. */
export function characterPose(action: CharacterAction, t: number, ta: number, seed: number, talking: boolean) {
  const C = CHARACTER;
  const ph = seed * 0.37;
  const p = { y: 0, rot: 0, sx: 1, sy: 1, breathe: C.breathe * Math.sin((TAU * t) / C.breathePeriodS + ph), headRot: C.headSway * Math.sin((TAU * t) / C.headSwayPeriodS + ph), headY: 0, headScale: 1, legL: 0, legR: 0, legRotL: 0, legRotR: 0, shadow: 1, mouth: 0 };
  if (talking || action === "talk") {
    const k = Math.floor(t * C.mouthRate);
    const r = random(`m${seed}-${k}`);
    p.mouth = r < 0.25 ? 0.1 : 0.35 + 0.65 * r;
    p.headRot += 2.2 * Math.sin(TAU * t * 0.9 + ph);
    p.headY += -0.006 * Math.abs(Math.sin(TAU * t * 1.8));
  }
  switch (action) {
    case "walk": {
      const w = TAU * t * C.stepsPerS / 2;
      p.y = -C.walkBob * Math.abs(Math.sin(w));
      p.legL = -C.legLift * Math.max(0, Math.sin(w));
      p.legR = -C.legLift * Math.max(0, -Math.sin(w));
      p.legRotL = 6 * Math.sin(w);
      p.legRotR = -6 * Math.sin(w);
      p.rot = 1.5 * Math.sin(w);
      break;
    }
    case "jump": {
      const d = C.jumpS;
      const x = ta / d;
      if (x >= 0 && x <= 1) {
        const crouch = x < 0.18 ? Math.sin((x / 0.18) * Math.PI) : 0;
        const air = x >= 0.18 && x <= 0.82 ? Math.sin(((x - 0.18) / 0.64) * Math.PI) : 0;
        const land = x > 0.82 ? Math.sin(((x - 0.82) / 0.18) * Math.PI) : 0;
        p.y = -C.jumpHeight * air;
        p.sy = 1 - 0.08 * (crouch + land) + 0.05 * air;
        p.sx = 1 + 0.06 * (crouch + land) - 0.03 * air;
        p.legL = p.legR = -C.legLift * 0.8 * air;
        p.shadow = 1 - 0.5 * air;
      }
      break;
    }
    case "cheer": {
      const b = Math.abs(Math.sin(TAU * t * 1.6));
      p.y = -C.jumpHeight * 0.35 * b;
      p.sy = 1 + 0.03 * b;
      p.headRot += 5 * Math.sin(TAU * t * 0.8);
      p.shadow = 1 - 0.25 * b;
      break;
    }
    case "nod": {
      const x = ta / 0.9;
      if (x >= 0 && x <= 1) { p.headY += 0.022 * Math.sin(x * TAU * 2) * (1 - x); p.headScale = 1 - 0.02 * Math.abs(Math.sin(x * TAU * 2)); }
      break;
    }
    case "shake": {
      const x = ta / 0.9;
      if (x >= 0 && x <= 1) p.headRot += 9 * Math.sin(x * TAU * 3) * (1 - x);
      break;
    }
    case "shock": {
      const x = ta / 0.6;
      if (x >= 0) {
        const pop = x <= 1 ? Math.sin(x * Math.PI) : 0;
        p.y = -C.jumpHeight * 0.3 * pop;
        p.headScale = 1 + 0.08 * ease(Math.min(1, x * 3)) * (x <= 1.5 ? 1 : Math.max(0, 1 - (x - 1.5)));
        p.headRot += x <= 1 ? 4 * Math.sin(x * TAU * 4) : 0;
        p.sy = 1 + 0.04 * pop;
      }
      break;
    }
    case "think":
      p.headRot += 7;
      p.rot = -1;
      break;
  }
  return p;
}

/** Kedip: 0 = terbuka, 1 = tertutup. */
export function blinkAt(t: number, seed: number): number {
  const period = CHARACTER.blinkEveryS + (seed % 7) * 0.23;
  const x = ((t + seed * 0.61) % period) / CHARACTER.blinkS;
  return x < 1 ? Math.sin(x * Math.PI) : 0;
}

export function Character(props: CharacterProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { asset, height } = props;
  const action = props.action ?? "idle";
  const seed = props.seed ?? hash(asset.id);
  const t = frame / fps;
  const ta = (frame - (props.from ?? 0)) / fps;
  const pose = characterPose(action, t, ta, seed, !!props.talking);
  const rig = asset.rig;

  if (!rig) {
    // Gambar utuh tanpa rig: napas + ayun saja
    const ar = asset.width && asset.height ? asset.width / asset.height : 0.75;
    const w = height * ar;
    return h("div", { style: { position: "relative", width: w, height, ...props.style } },
      h("div", { style: { position: "absolute", inset: 0, transformOrigin: "50% 100%", transform: `translateY(${pose.y * height}px) rotate(${pose.rot + pose.headRot * 0.3}deg) scale(${pose.sx * (props.flip ? -1 : 1)}, ${pose.sy * (1 + pose.breathe)})` } },
        h(Img, { src: asset.src, style: { width: "100%", height: "100%", objectFit: "contain" } })));
  }

  const s = height / rig.box.h;
  const W = rig.width * s, H = rig.height * s;
  const bx = rig.box.x * s, by = rig.box.y * s, bw = rig.box.w * s;
  const neckY = rig.neck.y * s, ov = rig.box.h * 0.035 * s;
  const hip = rig.legs ? rig.legs.hip * s : rig.height * s;
  const hipOv = rig.box.h * 0.03 * s;
  const masked: React.CSSProperties = { position: "absolute", left: 0, top: 0, width: W, height: H, maskImage: `url(${rig.mask})`, WebkitMaskImage: `url(${rig.mask})`, maskSize: `${W}px ${H}px`, WebkitMaskSize: `${W}px ${H}px`, maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" };
  const part = (key: string, clip: string, transform: string, origin: string, extra?: React.ReactNode) =>
    h("div", { key, style: { position: "absolute", left: 0, top: 0, width: W, height: H, transform, transformOrigin: origin } },
      h("div", { style: { ...masked, clipPath: clip } }, h(Img, { src: asset.src, style: { width: W, height: H, display: "block" } })),
      extra ?? null);
  const poly = (pts: Array<[number, number]>) => `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`;

  // Badan: dari leher (kolom leher sedikit lebih tinggi agar sambungan tertutup) sampai pinggul
  const nl = rig.neck.l * s, nr = rig.neck.r * s;
  const torsoClip = poly([[0, neckY], [nl, neckY], [nl, neckY - ov], [nr, neckY - ov], [nr, neckY], [W, neckY], [W, rig.legs ? hip + hipOv : H], [0, rig.legs ? hip + hipOv : H]]);
  const headClip = poly([[0, 0], [W, 0], [W, neckY], [0, neckY]]);
  const breatheY = pose.breathe;
  const torsoT = `scale(1, ${1 + breatheY})`;
  const torsoOrigin = `${rig.neck.cx * s}px ${hip}px`;
  const lift = (hip - neckY) * breatheY;
  const headT = `translateY(${-lift + pose.headY * height}px) rotate(${pose.headRot}deg) scale(${pose.headScale})`;
  const headOrigin = `${rig.neck.cx * s}px ${neckY}px`;

  // Wajah: kedip dan mulut (ikut transform kepala)
  const face: React.ReactNode[] = [];
  const bl = blinkAt(t, seed);
  if (rig.eyes && rig.skin && bl > 0.05) {
    for (const [i, e] of rig.eyes.entries()) {
      const rx = e.rx * s * 1.15, ry = e.ry * s * 1.15;
      face.push(h("div", { key: `e${i}`, style: { position: "absolute", left: e.x * s - rx, top: e.y * s - ry, width: rx * 2, height: ry * 2, borderRadius: "50%", overflow: "hidden" } },
        h("div", { style: { position: "absolute", left: 0, top: 0, width: "100%", height: `${bl * 100}%`, background: rig.skin, borderBottom: `${Math.max(1.5, ry * 0.14)}px solid #3a2a24` } })));
    }
  }
  if (rig.mouth && pose.mouth > 0.12) {
    const mw = rig.mouth.w * s * (0.42 + 0.18 * pose.mouth), mh = rig.mouth.w * s * 0.34 * pose.mouth;
    face.push(h("div", { key: "m", style: { position: "absolute", left: rig.mouth.x * s - mw / 2, top: rig.mouth.y * s - mh * 0.35, width: mw, height: mh, borderRadius: "45% 45% 50% 50% / 35% 35% 65% 65%", background: "#5b1d22", border: `${Math.max(1.5, mw * 0.05)}px solid #2b1414`, overflow: "hidden" } },
      h("div", { style: { position: "absolute", left: "20%", width: "60%", bottom: "-20%", height: "55%", borderRadius: "50%", background: "#d9646e" } })));
  }

  const layers: React.ReactNode[] = [];
  if (rig.legs) {
    const sp = rig.legs.split * s;
    const legOrigin = (x: number) => `${x}px ${hip}px`;
    layers.push(part("kl", poly([[0, hip], [sp, hip], [sp, H], [0, H]]), `translateY(${pose.legL * height}px) rotate(${pose.legRotL}deg)`, legOrigin((bx + sp) / 2)));
    layers.push(part("kr", poly([[sp, hip], [W, hip], [W, H], [sp, H]]), `translateY(${pose.legR * height}px) rotate(${pose.legRotR}deg)`, legOrigin((sp + bx + bw) / 2)));
  }
  layers.push(part("b", torsoClip, torsoT, torsoOrigin));
  layers.push(part("k", headClip, headT, headOrigin, face));

  const shadowW = bw * 0.62 * (0.75 + 0.25 * pose.shadow);
  return h("div", { style: { position: "relative", width: bw, height, ...props.style } },
    props.shadow === false ? null : h("div", { style: { position: "absolute", left: (bw - shadowW) / 2, top: height - height * 0.018, width: shadowW, height: height * 0.036, borderRadius: "50%", background: `rgba(0,0,0,${(0.16 * pose.shadow).toFixed(3)})` } }),
    h("div", { style: { position: "absolute", left: 0, top: 0, width: bw, height, transformOrigin: "50% 100%", transform: `translateY(${pose.y * height}px) rotate(${pose.rot}deg) scale(${pose.sx * (props.flip ? -1 : 1)}, ${pose.sy})` } },
      h("div", { style: { position: "absolute", left: -bx, top: -by, width: W, height: H } }, ...layers)));
}
