// Fase 27: Prof. AI (rig tulang + avatar mesh). Jalankan: node apps/worker/test/fase27.test.ts
import assert from "node:assert/strict";
import { parseProfAiRig, profAiData, PROF_AI_FILES } from "../../../packages/shared/src/prof-ai.ts";
import { profAiMouth, profAiPose, profAiWalk, PROF_AI_ACTIONS } from "../../../packages/remotion/src/creative/prof-ai.ts";
import { meshMouth, meshParams, PROF_AI_MESH_ACTIONS } from "../../../packages/remotion/src/creative/prof-ai-mesh.ts";
import { checkScope, compileCreative } from "../../../packages/remotion/src/creative/compile.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";

const view = { file: "front-tpose.png", width: 1086, height: 1086, box: { x: 157, y: 39, w: 772, h: 1006 }, neck: { y: 472, l: 480, r: 603, cx: 541 },
  arms: { left: { cut: 444, top: 485, bottom: 562, pivot: { x: 444, y: 523 }, tip: 158 }, right: { cut: 642, top: 484, bottom: 562, pivot: { x: 642, y: 523 }, tip: 927 } },
  legs: { hip: 808, split: 543, hem: 770, jointL: 481, jointR: 605, ankle: 969 } };
const rig = { version: 1, name: "Prof. AI", views: { front: view }, face: null, notes: [], mesh: { file: "prof-ai.mavatar", size: 1254, top: 45, foot: 1212, cx: 640 } };

// ---- skema
assert.ok(parseProfAiRig(rig));
assert.equal(parseProfAiRig({ ...rig, views: { front: { ...view, file: "../rahasia.png" } } }), null, "berkas di luar daftar ditolak");
assert.equal(parseProfAiRig({ ...rig, mesh: { ...rig.mesh, file: "lain.zip" } }), null);
assert.ok(PROF_AI_FILES.includes("prof-ai.mavatar"));
const d = profAiData(parseProfAiRig(rig)!, (id) => `http://x/${id}`);
assert.equal(d.src["prof-ai.mavatar"], "http://x/profai:prof-ai.mavatar");

// ---- rig tulang: pose murni, deterministik
for (const a of PROF_AI_ACTIONS) assert.deepEqual(profAiPose(a, 1.3, 0.7), profAiPose(a, 1.3, 0.7), a);
const w0 = profAiPose("walk", 0.1, 0.1), w1 = profAiPose("walk", 0.1 + 0.5 / profAiWalk().cyclesPerS, 0.1 + 0.5 / profAiWalk().cyclesPerS);
assert.ok(Math.sign(w0.legL.hip) !== Math.sign(w1.legL.hip), "kaki kiri berayun bolak-balik");
assert.ok(profAiPose("walk", 1, 1).x < 0, "jalan maju (ke kiri) sejauh langkah");
assert.equal(profAiPose("walk", 1, 1, { inPlace: true }).x, 0);
assert.ok(profAiPose("wave", 1, 1).armR.sh < 0, "lambai: lengan kanan terangkat");
assert.equal(profAiMouth([{ text: "halo", start: 0, end: 0.4 }], 0.5), "closed", "di luar kata mulut tertutup");

// ---- avatar mesh: parameter murni, mulut ikut vokal
for (const a of PROF_AI_MESH_ACTIONS) assert.deepEqual(meshParams(a, 2.1, 0.9, { talking: true }), meshParams(a, 2.1, 0.9, { talking: true }), a);
assert.deepEqual(meshMouth([{ text: "aaa", start: 0, end: 1 }], 1.5), { open: 0, form: 0 }, "jeda = mulut tertutup");
const ma = meshMouth([{ text: "aaa", start: 0, end: 1 }], 0.5), mi = meshMouth([{ text: "iii", start: 0, end: 1 }], 0.5), mo = meshMouth([{ text: "ooo", start: 0, end: 1 }], 0.5);
assert.ok(ma.open > mi.open && mo.form > 0.5 && mi.form < -0.5, "a lebar, i sempit, o bulat");
const shock = meshParams("shock", 1, 0.5, {});
assert.equal(shock.expression, "surprised");
assert.ok(shock.params.browY > 0.5 && shock.params.armSwingL > 0.5);
for (const [k, v] of Object.entries(meshParams("explain", 3, 3, { talking: true }).params)) {
  if (/^angle/.test(k)) assert.ok(Math.abs(v) <= 30, `${k} dalam batas runtime`);
  if (/^(armSwing|elbowBend)/.test(k)) assert.ok(v >= -1 && v <= 1, `${k} dalam batas runtime`);
}

// ---- kode kreatif boleh memakai ProfAI; kontrak menjelaskannya
const code = `import React from "react";\nimport { ProfAI } from "character";\nexport default function O({ data }: CreativeProps) { return <ProfAI data={data} height={600} action="explain" talking />; }`;
assert.deepEqual(checkScope(code), []);
assert.ok(compileCreative(code).ok);
const doc = buildContract({ motion: true });
assert.match(doc, /## Prof\. AI/);
assert.match(doc, /import \{ ProfAI \} from "character"/);

console.log("fase27.test: skema rig, pose tulang (jalan/lambai), parameter mesh (mulut vokal, kaget, batas runtime), compile + kontrak passed");
