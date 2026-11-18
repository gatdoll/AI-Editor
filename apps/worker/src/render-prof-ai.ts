// Fase 27: video peraga Prof. AI (semua aksi, tampak, ekspresi, dan mulut bicara) lewat komposisi Motion yang sama dengan render.
// Kode overlay di bawah dijalankan seperti kode AI (compile runtime, modul "character").
// Jalankan: node --env-file=.env apps/worker/src/render-prof-ai.ts   (butuh `npm run setup:prof-ai` sekali)
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { STYLES } from "@app/config";
import { buildMotionProps } from "../../../packages/remotion/src/motion-props.ts";
import { profAiData } from "@app/shared/prof-ai";
import { loadProfAiRig, profAiServeFiles } from "@app/shared/prof-ai-store";
import { renderMotion, renderMotionStill } from "./render.ts";
import { REPO_ROOT } from "./creative/workdir.ts";

const rig = loadProfAiRig();
if (!rig) throw new Error("character.json belum ada / tidak valid: jalankan npm run setup:prof-ai");

// [label, durasi dtk, props ProfAI (JSX atribut)]
const SCENES: Array<[string, number, string]> = [
  // Avatar mesh (tampak depan): kepala 3D, rambut & badan ber-fisika, mata/alis/mulut, lengan dan kaki halus
  ["MESH idle: napas, kedip, lirik, rambut", 3.2, `action="idle"`],
  ["MESH talk: mulut ikut vokal", 3.6, `action="talk" talking`],
  ["MESH explain: kepala + lengan", 3.4, `action="explain" talking`],
  ["MESH nod", 1.8, `action="nod" from={6}`],
  ["MESH shake", 1.8, `action="shake" from={6}`],
  ["MESH think", 2.4, `action="think"`],
  ["MESH shock", 2.2, `action="shock" from={8}`],
  ["MESH jump", 1.8, `action="jump" from={6}`],
  ["MESH senyum", 1.8, `expression="happy"`],
  ["MESH sedih", 1.8, `expression="sad"`],
  ["MESH marah", 1.8, `expression="angry"`],
  ["MESH malu", 1.8, `expression="shy"`],
  ["MESH kedip sebelah", 1.8, `expression="wink"`],
  // Rig tulang: gerak besar dan tampak lain
  ["TULANG wave", 2.4, `action="wave"`],
  ["TULANG point (kiri)", 2, `action="point" dir="left"`],
  ["TULANG cheer", 2, `action="cheer"`],
  ["TULANG walk di tempat (3/4)", 3, `action="walk" inPlace`],
  ["TULANG walk melintas", 3, `action="walk" WALK`],
];

const words = "Halo semuanya, aku Prof AI. Hari ini kita belajar bareng, oke?".split(" ");
const overlay = `import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { ProfAI } from "character";

const WORDS = ${JSON.stringify(words.map((w, i) => ({ text: w, start: 0.25 + i * 0.3, end: 0.25 + i * 0.3 + 0.26 })))};

function Scene({ data, label, i, n, walk, children }: any) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const H = data.height * (walk ? 0.34 : 0.62);
  const x = walk === 1 ? data.width - H * 0.25 : walk === 2 ? H * 0.25 : data.width / 2;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", top: data.safeArea.top + 20, left: 0, right: 0, textAlign: "center", fontFamily: data.fonts.jakarta, fontWeight: 800, fontSize: 54, color: "#1d2433" }}>{label}</div>
      <div style={{ position: "absolute", top: data.safeArea.top + 96, left: 0, right: 0, textAlign: "center", fontFamily: data.fonts.jakarta, fontWeight: 500, fontSize: 34, color: "#6b7280" }}>{i + 1} / {n}</div>
      <div style={{ position: "absolute", left: x - H * 0.3, top: data.height * 0.86 - H }}>{children(H)}</div>
    </AbsoluteFill>
  );
}

export default function Overlay({ data }: CreativeProps) {
  const { fps } = useVideoConfig();
  const talk = { ...data, words: WORDS };
  let at = 0;
  const scenes = [
${SCENES.map(([label, dur, attrs], i) => {
  const walk = attrs.includes("WALKR") ? 2 : attrs.includes("WALK") ? 1 : 0;
  const a = attrs.replace(/WALKR?/, "");
  return `    (() => { const f = Math.round(at * fps); at += ${dur}; return <Sequence key={${i}} from={f} durationInFrames={Math.round(${dur} * fps)}><Scene data={data} label=${JSON.stringify(label)} i={${i}} n={${SCENES.length}} walk={${walk}}>{(H: number) => <ProfAI data={${a.includes("talking") ? "talk" : "data"}} height={H} ${a} />}</Scene></Sequence>; })(),`;
}).join("\n")}
  ];
  return <AbsoluteFill style={{ background: "linear-gradient(#f4efe6, #e6dccb)" }}>{scenes}</AbsoluteFill>;
}
`;

const total = SCENES.reduce((s, x) => s + x[1], 0);
const outDir = path.join(REPO_ROOT, "out", "prof-ai");
await mkdir(outDir, { recursive: true });
const materials = profAiServeFiles();
const props = (srcFor: (id: string) => string) => ({
  ...buildMotionProps({ aspect: "9:16", settings: { durationS: total }, colors: STYLES.bersih.colors, materials: [], srcFor, overlay }),
  durationInFrames: Math.round(total * 30),
  profAi: profAiData(rig, srcFor),
});
const logs: string[] = [];
const onBrowserLog = (t: string) => { if (/kreatif|error/i.test(t)) logs.push(t); };

// Still tengah tiap adegan untuk lembar periksa
let at = 0;
for (const [i, [, dur]] of process.argv.includes("--video") ? [] : SCENES.entries()) {
  const frame = Math.round((at + dur * 0.55) * 30);
  at += dur;
  await renderMotionStill({ materials, props, frame, outFile: path.join(outDir, `still-${String(i + 1).padStart(2, "0")}.png`), scale: 0.4, onBrowserLog });
}
if (process.argv.includes("--stills")) process.exit(0);
const t0 = Date.now();
let lastPct = -10;
const r = await renderMotion({ materials, outFile: path.join(outDir, "prof-ai-peraga.mp4"), props, onBrowserLog, onProgress: (p) => { const pct = Math.floor(p * 100); if (pct >= lastPct + 10) { lastPct = pct; console.log(`render ${pct}% (${((Date.now() - t0) / 1000).toFixed(0)} dtk)`); } } });
console.log(`OK ${outDir} (${r.durationInFrames} frame)`);
if (logs.length) console.log("log browser:", logs.slice(0, 10));
