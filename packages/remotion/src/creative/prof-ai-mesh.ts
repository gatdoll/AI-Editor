// Fase 27: Prof. AI tampak depan memakai avatar mesh dari mesh-avatar-studio (runtime `mesh-avatar`, WebGL, MIT).
// Seluruh gambar dideformasi mesh: kepala menoleh 3D, mata/alis/mulut, rambut dan badan ber-fisika, lengan berayun,
// siku menekuk, berat badan berpindah. Runtime dijalankan `manual`: kita memajukan simulasi satu tick per frame dengan
// angka acak ber-seed, jadi frame N selalu sama (pratinjau = render). Mundur = simulasi diulang dari frame 0.
// Tanpa JSX agar bisa diimpor tes Node; runtime dimuat dinamis (hanya di browser).
import React, { useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import type { ProfAiData } from "../../../shared/src/prof-ai.ts";
import { PROF_AI } from "@app/config";

/** Aksi yang dikerjakan avatar mesh (sisanya: rig tulang). */
export const PROF_AI_MESH_ACTIONS = ["idle", "talk", "explain", "nod", "shake", "think", "shock", "jump"] as const;
export type ProfAiMeshAction = (typeof PROF_AI_MESH_ACTIONS)[number];
export type ProfAiMeshExpression = "neutral" | "happy" | "surprised" | "thinking" | "serious" | "sad" | "angry" | "shy" | "wink";

/** Ekspresi kita -> ekspresi runtime (LIVE_EXPRESSIONS). */
const EXPR: Record<ProfAiMeshExpression, string> = { neutral: "neutral", happy: "smile", surprised: "surprise", thinking: "neutral", serious: "halfLidded", sad: "sad", angry: "angry", shy: "shy", wink: "wink" };

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => 0.5 - Math.cos(Math.PI * clamp01(x)) / 2;
/** Derau halus deterministik (jumlah sinus tak sebanding). */
const drift = (t: number, k: number) => 0.6 * Math.sin(t * 1.13 + k) + 0.3 * Math.sin(t * 2.71 + 2 * k) + 0.1 * Math.sin(t * 4.37 + 3 * k);

// Vokal -> bukaan dan bentuk mulut runtime (mouthForm: -1 = "i", +1 = "o")
const VOWEL: Record<string, { open: number; form: number }> = { a: { open: 0.95, form: 0 }, e: { open: 0.6, form: -0.45 }, i: { open: 0.35, form: -0.85 }, o: { open: 0.75, form: 0.85 }, u: { open: 0.4, form: 0.75 } };

/** Target mulut pada detik `t` dari waktu kata (tanpa kata = tertutup). Murni. */
export function meshMouth(words: Array<{ text: string; start: number; end: number }>, t: number): { open: number; form: number } {
  const w = words.find((x) => t >= x.start && t < x.end);
  if (!w) return { open: 0, form: 0 };
  const letters = w.text.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return { open: 0.3, form: 0 };
  const p = (t - w.start) / Math.max(0.01, w.end - w.start);
  const f = p * letters.length, i = Math.min(letters.length - 1, Math.floor(f)), ph = f - i;
  const v = VOWEL[letters[i]];
  // Konsonan: mulut setengah menutup menuju vokal berikutnya
  if (!v) { const nx = letters.slice(i + 1).split("").find((c) => VOWEL[c]); return { open: 0.18, form: nx ? VOWEL[nx].form * 0.5 : 0 }; }
  // Tepi kata membuka/menutup halus
  const env = Math.min(1, p / 0.12, (1 - p) / 0.12);
  return { open: v.open * (0.75 + 0.25 * Math.sin(Math.PI * ph)) * clamp01(env + 0.25), form: v.form };
}

/** Parameter runtime untuk satu frame (detik `t` sejak awal, `ta` sejak `from`). Murni. */
export function meshParams(action: ProfAiMeshAction, t: number, ta: number, o: { talking?: boolean; dir?: "left" | "right" }): { params: Record<string, number>; expression?: ProfAiMeshExpression; y: number; sx: number; sy: number } {
  const M = PROF_AI.mesh;
  const D = M.headDrift;
  const ph = (TAU * t) / D.periodS;
  const P: Record<string, number> = {
    angleX: D.x * drift(ph, 0), angleY: D.y * drift(ph, 1.7), angleZ: D.z * drift(ph * 0.8, 3.1),
    bodyAngleX: 1.5 * drift(ph * 0.7, 4.2), bodyAngleZ: 1.2 * drift(ph * 0.6, 5.3),
  };
  let expression: ProfAiMeshExpression | undefined;
  let y = 0, sx = 1, sy = 1;
  const into = ease(ta / PROF_AI.blendS);
  if (o.talking || action === "talk" || action === "explain") P.angleY += M.talkNod * Math.abs(Math.sin(TAU * t * 1.6));
  switch (action) {
    case "talk":
      P.armSwingL = 0.25 * Math.max(0, Math.sin(TAU * t * 0.7));
      P.armSwingR = 0.25 * Math.max(0, -Math.sin(TAU * t * 0.7));
      P.elbowBendL = 0.35 * Math.max(0, Math.sin(TAU * t * 0.7));
      P.elbowBendR = 0.35 * Math.max(0, -Math.sin(TAU * t * 0.7));
      break;
    case "explain": {
      const E = M.explain, w = (TAU * t) / E.periodS;
      const l = Math.max(0, Math.sin(w)), r = Math.max(0, -Math.sin(w));
      P.angleX += E.head * Math.sin(w) * into;
      P.bodyAngleZ += E.body * Math.sin(w) * into;
      P.armSwingL = into * (0.2 + 0.8 * l); P.armSwingR = into * (0.2 + 0.8 * r);
      P.elbowBendL = into * l; P.elbowBendR = into * r;
      P.browY = 0.25 * Math.max(l, r);
      break;
    }
    case "nod": {
      const x = ta / 0.9;
      if (x >= 0 && x <= 1) P.angleY = -M.nod * Math.sin(x * TAU * 2) * (1 - x);
      break;
    }
    case "shake": {
      const x = ta / 0.9;
      if (x >= 0 && x <= 1) P.angleX = M.shake * Math.sin(x * TAU * 3) * (1 - x);
      break;
    }
    case "think": {
      const T = M.think;
      P.angleZ = T.roll * into; P.angleX = T.turn * into; P.angleY = 6 * into;
      P.gazeX = T.gazeX * into; P.gazeY = T.gazeY * into;
      P.browAngle = 0.5 * into; P.browY = 0.3 * into;
      P.mouthForm = -0.4 * into;
      P.elbowBendR = 0.8 * into; P.armSwingR = -0.4 * into;
      expression = "thinking";
      break;
    }
    case "shock": {
      if (ta >= 0) {
        const k = ease(ta / 0.12) * (ta <= 1.4 ? 1 : Math.max(0, 1 - (ta - 1.4) / 0.4));
        const pop = ta / 0.45 <= 1 ? Math.sin((ta / 0.45) * Math.PI) : 0;
        y = -0.05 * pop; sy = 1 + 0.03 * pop;
        P.angleY = -8 * k; P.browY = 1 * k; P.eyeLOpen = 1 + 0.22 * k; P.eyeROpen = 1 + 0.22 * k;
        P.armSwingL = k; P.armSwingR = k; P.elbowBendL = k; P.elbowBendR = k;
        P.mouthOpen = 0.55 * k; P.mouthForm = 0.8 * k;
        expression = k > 0.2 ? "surprised" : undefined;
      }
      break;
    }
    case "jump": {
      const x = ta / PROF_AI.jumpS;
      if (x >= 0 && x <= 1) {
        const crouch = x < 0.2 ? Math.sin((x / 0.2) * Math.PI) : 0;
        const air = x >= 0.2 && x <= 0.85 ? Math.sin(((x - 0.2) / 0.65) * Math.PI) : 0;
        const land = x > 0.85 ? Math.sin(((x - 0.85) / 0.15) * Math.PI) : 0;
        y = -PROF_AI.jumpHeight * air + 0.02 * (crouch + land);
        sy = 1 - 0.07 * (crouch + land) + 0.05 * air; sx = 1 + 0.05 * (crouch + land) - 0.03 * air;
        P.armSwingL = air; P.armSwingR = air; P.elbowBendL = 0.6 * air; P.elbowBendR = 0.6 * air;
        P.angleY = -6 * air;
        expression = "happy";
      }
      break;
    }
  }
  return { params: P, expression, y, sx, sy };
}

type MeshAvatarLike = {
  setParameters(v: Record<string, number>, w?: number): void;
  setExpression(name: string): void;
  setAutoIdle(on: boolean): void;
  setAutoMotion(on: boolean): void;
  advance(sec: number, fps?: number): void;
  destroy(): void;
};
type Sim = { avatar: MeshAvatarLike | null; frame: number; rng: number; mouth: number; form: number; expr: string; gen: number };

/** Angka acak runtime (kedip, lirik, napas) dari seed: hanya selama satu tick. */
function seeded<T>(sim: Sim, fn: () => T): T {
  const orig = Math.random;
  Math.random = () => { sim.rng = (Math.imul(sim.rng, 1664525) + 1013904223) >>> 0; return sim.rng / 4294967296; };
  try { return fn(); } finally { Math.random = orig; }
}

export type ProfAIMeshProps = {
  data: { profAi?: ProfAiData; words?: Array<{ text: string; start: number; end: number }> };
  height: number;
  action?: ProfAiMeshAction;
  expression?: ProfAiMeshExpression;
  talking?: boolean;
  dir?: "left" | "right";
  from?: number;
  flip?: boolean;
  shadow?: boolean;
  style?: React.CSSProperties;
};

export function ProfAIMesh(props: ProfAIMeshProps): React.ReactElement | null {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const pa = props.data.profAi;
  const geo = pa?.rig.mesh;
  const src = geo ? pa?.src[geo.file] : undefined;
  const sim = useRef<Sim>({ avatar: null, frame: -1, rng: PROF_AI.mesh.seed, mouth: 0, form: 0, expr: "neutral", gen: 0 });
  const [gen, setGen] = useState(0);
  // delayRender dipanggil sinkron saat render pertama agar Remotion menunggu avatar dimuat DAN frame digambar
  const handle = useRef<number | null>(null);
  if (handle.current === null && src && !sim.current.avatar && sim.current.gen === 0 && gen === 0) handle.current = delayRender("Prof. AI mesh: memuat avatar");

  const from = props.from ?? 0;
  const action = props.action ?? "idle";
  const talking = !!props.talking || action === "talk";
  const target = Math.max(0, frame);

  // Majukan simulasi sampai frame ini (dipakai tiap render dan langsung sesudah avatar dimuat)
  const step = useRef<() => void>(() => {});
  step.current = () => {
    const s = sim.current;
    if (!s.avatar) return;
    if (target < s.frame) {
      // Mundur: simulasi fisika harus diulang dari awal (avatar baru)
      s.avatar.destroy();
      sim.current = { avatar: null, frame: -1, rng: PROF_AI.mesh.seed, mouth: 0, form: 0, expr: "neutral", gen: s.gen + 1 };
      handle.current = delayRender("Prof. AI mesh: mundur, ulang simulasi");
      setGen(s.gen + 1);
      return;
    }
    const words = props.data.words ?? [];
    const k = PROF_AI.mesh.mouthSmooth;
    // Tick pengejar (bukan frame yang ditampilkan) digambar di kanvas 2 px: fisika tetap sama, kerja gambar hampir nol
    const cv = ref.current;
    const full = cv ? { w: cv.style.width, h: cv.style.height } : null;
    const shrink = (on: boolean) => { if (cv && full) { cv.style.width = on ? "2px" : full.w; cv.style.height = on ? "2px" : full.h; } };
    if (target - s.frame > 1) shrink(true);
    for (let f = s.frame + 1; f <= target; f++) {
      if (f === target) shrink(false);
      const t = f / fps, ta = (f - from) / fps;
      const mp = meshParams(action, t, ta, { talking, dir: props.dir });
      const want = talking ? meshMouth(words.length ? words : [], t) : { open: 0, form: 0 };
      if (talking && !words.length) { want.open = 0.25 + 0.5 * Math.abs(Math.sin(TAU * t * 2.3)); want.form = 0.6 * Math.sin(TAU * t * 1.1); }
      s.mouth += (want.open - s.mouth) * k;
      s.form += (want.form - s.form) * k;
      const params = { ...mp.params };
      if (talking) { params.mouthOpen = s.mouth; params.mouthForm = s.form; }
      const expr = EXPR[props.expression ?? mp.expression ?? "neutral"];
      if (expr !== s.expr) { s.avatar.setExpression(expr); s.expr = expr; }
      s.avatar.setParameters(params, 1);
      seeded(s, () => s.avatar!.advance(1 / fps, fps));
      s.frame = f;
    }
  };

  // Muat avatar (ulang sesudah mundur). Sesudah dimuat: langsung gambar frame ini, baru continueRender.
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !src || sim.current.avatar || sim.current.gen !== gen) return;
    let alive = true;
    const h = handle.current ?? delayRender("Prof. AI mesh: memuat ulang");
    handle.current = h;
    import("mesh-avatar").then((m) => m.loadMeshAvatar(cv, src, { manual: true, padTop: 0, padSide: 0 }))
      .then((av) => {
        if (!alive) { av.destroy(); return; }
        const a = av as unknown as MeshAvatarLike;
        a.setAutoMotion(false);
        sim.current = { avatar: a, frame: -1, rng: PROF_AI.mesh.seed, mouth: 0, form: 0, expr: "neutral", gen };
        step.current();
        handle.current = null;
        continueRender(h);
      }, (e) => { console.error(`[kreatif] Prof. AI mesh gagal dimuat: ${String(e)}`); handle.current = null; continueRender(h); });
    return () => { alive = false; };
  }, [src, gen]);
  // Lepas: hancurkan avatar; penanda delayRender yang masih menunggu dilepas agar render tidak macet
  useLayoutEffect(() => () => {
    sim.current.avatar?.destroy(); sim.current.avatar = null;
    if (handle.current !== null) { continueRender(handle.current); handle.current = null; }
  }, []);
  useLayoutEffect(() => { step.current(); });

  if (!pa || !geo || !src) return null;
  const { height } = props;
  const cw = height * 0.6;
  const s = height / (geo.foot - geo.top);
  const L = geo.size * s;
  const mp = meshParams(action, Math.max(0, frame) / fps, (frame - from) / fps, { talking, dir: props.dir });
  const shadowW = height * 0.36;
  return React.createElement("div", { style: { position: "relative", width: cw, height, ...props.style } },
    props.shadow === false ? null : React.createElement("div", { style: { position: "absolute", left: (cw - shadowW) / 2, top: height - height * 0.02, width: shadowW, height: height * 0.04, borderRadius: "50%", background: `rgba(0,0,0,${(PROF_AI.shadowOpacity * (1 + mp.y * 3)).toFixed(3)})` } }),
    React.createElement("div", { style: { position: "absolute", left: 0, top: 0, width: cw, height, transformOrigin: "50% 100%", transform: `translateY(${(mp.y * height).toFixed(2)}px) scale(${mp.sx * (props.flip ? -1 : 1)}, ${mp.sy})` } },
      React.createElement("canvas", { ref, style: { position: "absolute", left: cw / 2 - geo.cx * s, top: height - geo.foot * s, width: L, height: L } })));
}
