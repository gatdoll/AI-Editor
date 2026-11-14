// Fase 9.2: worker Mode Kreatif tanpa CLI dan tanpa Chrome (agen, renderer, dan git disuntik).
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CREATIVE } from "../../../config/index.ts";
import { AGENT_TOOLS, agentArgs, agentEnv, runAgent } from "../src/analyze/providers.ts";
import { pickStillFrames, creativeErrorsFromLogs } from "../src/creative/stills.ts";
import { creativeWorkdir, ensureSkillSources, prepareWorkdir, readOutputs, SKILL_COPIES, STARTER_OVERLAY, writeBase } from "../src/creative/workdir.ts";
import { checkCode, firstPrompt, renderAndCheck, runCreativeLoop, screenshotInstruction, designSystemInstruction, unchangedFromBase, type Validation } from "../src/creative/loop.ts";
import { checkScope } from "../../../packages/remotion/src/creative/compile.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { buildCreativeTimeline, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { SAMPLE_OVERLAY, SAMPLE_VIDEO } from "../../../packages/remotion/src/creative/sample.ts";
import type { CreativeData } from "../../../packages/remotion/src/creative/contract.ts";

const repo = path.resolve(import.meta.dirname, "../../..");
const tmp = await mkdtemp(path.join(os.tmpdir(), "creative-worker-test-"));

// ---- argumen CLI agen: tool terbatas ke folder kerja, tanpa Bash/jaringan, tanpa pengaturan pengguna
const args = agentArgs({ model: "claude-opus-5-5", maxTurns: 60, systemPrompt: "x" });
const after = (flag: string) => args[args.indexOf(flag) + 1];
assert.equal(after("--tools"), "Read,Write,Edit,Glob,Grep,Skill");
assert.deepEqual([...AGENT_TOOLS], ["Read", "Write", "Edit", "Glob", "Grep", "Skill"]);
const allowed = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--permission-mode"));
assert.deepEqual(allowed, ["Read(./**)", "Write(./**)", "Edit(./**)", "Glob(./**)", "Grep(./**)", "Skill"], "setiap tool berkas dibatasi ke folder kerja");
assert.equal(after("--permission-mode"), "dontAsk");
assert.equal(after("--setting-sources"), "project");
assert.equal(after("--model"), "claude-opus-5-5");
assert.equal(after("--max-turns"), "60");
assert.ok(!args.some((a) => /Bash|WebFetch|WebSearch/.test(a)), "tidak ada shell atau jaringan");
assert.ok(!args.includes("--disable-slash-commands"), "skill harus tetap bisa dipakai");
assert.ok(!agentArgs({ maxTurns: 1, systemPrompt: "x" }).includes("--model"));

// ---- env agen: kunci dibuang, sesi login CLI tetap
const env = agentEnv({ PATH: "p", SUPABASE_SERVICE_ROLE_KEY: "s", SUPABASE_URL: "u", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", CLAUDE_CODE_OAUTH_TOKEN: "c", GITHUB_TOKEN: "g", HOME: "h" });
assert.deepEqual(Object.keys(env).sort(), ["CLAUDE_CODE_OAUTH_TOKEN", "HOME", "PATH"]);
await assert.rejects(runAgent("codex", { prompt: "", cwd: tmp, systemPrompt: "", timeoutMs: 1, maxTurns: 1 }), /hanya mendukung Claude/);
await assert.rejects(runAgent("claude", { prompt: "", cwd: tmp, systemPrompt: "", timeoutMs: 1, maxTurns: 1, model: "gpt-x" }), /tidak ada di daftar/);

// ---- frame still: awal/tengah/sambungan/akhir di tengah kata, dalam batas, tanpa kembar
const words = [{ text: "a", start: 0.5, end: 0.9 }, { text: "b", start: 4, end: 4.4 }, { text: "c", start: 8, end: 8.6 }];
const f1 = pickStillFrames({ durationInFrames: 300, fps: 30, words, joins: [5.2], joinOffsetFrames: 3 });
assert.deepEqual(f1.map((f) => f.label), ["awal", "tengah", "sambungan", "akhir"]);
assert.deepEqual(f1.map((f) => f.frame), [21, 126, 159, 249]);
const f2 = pickStillFrames({ durationInFrames: 90, fps: 30, words: [], joins: [], joinOffsetFrames: 3 });
assert.ok(f2.every((f) => f.frame >= 0 && f.frame < 90) && new Set(f2.map((f) => f.frame)).size === f2.length);
const f3 = pickStillFrames({ durationInFrames: 1, fps: 30, words: [], joins: [], joinOffsetFrames: 3 });
assert.deepEqual(f3, [{ label: "awal", frame: 0 }], "video 1 frame: satu still");
assert.ok(pickStillFrames({ durationInFrames: 100, fps: 30, words, joins: [3.3], joinOffsetFrames: 3 }).every((f) => f.frame <= 99), "kata di luar durasi dipotong ke frame terakhir");
// sambungan di 0,13 dtk (kasus uji nyata 28 Okt) tertumpuk dengan frame awal: pakai sambungan di tengah video
const fj = pickStillFrames({ durationInFrames: 999, fps: 30, words, joins: [0.133, 6, 6.5], joinOffsetFrames: 3 });
assert.equal(fj.find((f) => f.label === "sambungan")!.frame, 183);
assert.equal(pickStillFrames({ durationInFrames: 300, fps: 30, words, joins: [0.1], joinOffsetFrames: 3 }).find((f) => f.label === "sambungan")!.frame, 6, "hanya sambungan di tepi: tetap dipakai");
assert.deepEqual(creativeErrorsFromLogs(["x", "[kreatif] overlay: frame 3: boom", "[kreatif] overlay: frame 3: boom", "Error: [kreatif] video: y"]), ["overlay: frame 3: boom", "video: y"]);

// ---- sumber skill: pin sama dengan skrip studio, checkout salah commit tidak diubah, checkout hilang diunduh
const studio = readFileSync(path.join(repo, "scripts/studio-reference.mjs"), "utf8");
for (const key of ["shotcraft", "toolkit"] as const) {
  assert.ok(studio.includes(CREATIVE.skills[key].sha), `pin ${key} sama dengan scripts/studio-reference.mjs`);
  assert.ok(studio.includes(CREATIVE.skills[key].repo));
}
assert.ok(readFileSync(path.join(repo, "docs/motion-sources.md"), "utf8").includes(CREATIVE.skills.remotion.sha), "pin remotion sama dengan docs/motion-sources.md");
const fakeRoot = path.join(tmp, "root");
await assert.rejects(ensureSkillSources(fakeRoot, () => ({ status: 0, stdout: "", stderr: "" })), /remotion-best-practices tidak ada/);
await mkdir(path.join(fakeRoot, ".agents/skills/remotion-best-practices"), { recursive: true });
await writeFile(path.join(fakeRoot, ".agents/skills/remotion-best-practices/SKILL.md"), "---\nname: remotion-best-practices\n---\n");
const calls: string[][] = [];
const okGit = (a: string[], cwd: string) => {
  calls.push(a);
  if (a[0] === "rev-parse") return { status: 0, stdout: (cwd.includes("shotcraft") ? CREATIVE.skills.shotcraft.sha : cwd.includes("animate") ? CREATIVE.skills.animate.sha : CREATIVE.skills.toolkit.sha) + "\n", stderr: "" };
  return { status: 0, stdout: "", stderr: "" };
};
const refs = await ensureSkillSources(fakeRoot, okGit);
assert.deepEqual(refs, { remotion: CREATIVE.skills.remotion.sha, shotcraft: CREATIVE.skills.shotcraft.sha, toolkit: CREATIVE.skills.toolkit.sha, animate: CREATIVE.skills.animate.sha });
assert.deepEqual(calls.filter((c) => c[0] !== "rev-parse").map((c) => c[0]), ["clone", "sparse-checkout", "fetch", "checkout", "clone", "sparse-checkout", "fetch", "checkout", "clone", "sparse-checkout", "fetch", "checkout"], "checkout hilang diunduh sparse di commit yang dipin");
assert.ok(calls.some((c) => c[0] === "fetch" && c.includes(CREATIVE.skills.shotcraft.sha)));
for (const k of ["shotcraft", "toolkit", "animate"] as const) await mkdir(path.join(fakeRoot, ".cache", CREATIVE.skills[k].dir, ".git"), { recursive: true });
await assert.rejects(ensureSkillSources(fakeRoot, (a) => ({ status: 0, stdout: a[0] === "rev-parse" ? "deadbeef" : "", stderr: "" })), /bukan commit yang dipin/);
await assert.rejects(ensureSkillSources(fakeRoot, () => ({ status: 1, stdout: "", stderr: "fatal: x" })), /fatal: x/);

// ---- folder kerja memakai path asli (bukan nama pendek 8.3 Windows), agar izin ./** cocok
const wd = creativeWorkdir("job/../x");
assert.ok(wd.startsWith(realpathSync.native(os.tmpdir())), wd);
assert.ok(!/~\d/.test(wd), `tanpa nama pendek: ${wd}`);
assert.ok(!wd.includes(".."), "id job dibersihkan");

// ---- folder kerja: skill disalin (tanpa node_modules/.git/media), brief + contract + komponen awal
for (const parts of Object.values(SKILL_COPIES)) for (const p of parts) {
  const from = path.join(fakeRoot, p.from);
  if (/\.md$/.test(p.from)) { await mkdir(path.dirname(from), { recursive: true }); await writeFile(from, `# ${p.to}`); }
  else { await mkdir(path.join(from, "node_modules/x"), { recursive: true }); await writeFile(path.join(from, "resep.md"), "r"); await writeFile(path.join(from, "contoh.png"), "png"); await writeFile(path.join(from, "node_modules/x/i.js"), "n"); }
}
const work = path.join(tmp, "work");
const data: CreativeData = { width: 1080, height: 1920, fps: 30, durationInFrames: 300, aspect: "9:16", words, joins: [5.2], colors: { text: "#FFFFFF", accent: "#B6FF00", dark: "#000000" }, fonts: { jakarta: "a", montserrat: "b", inter: "c" } };
await prepareWorkdir({ dir: work, root: fakeRoot, brief: { prompt: "judul besar", data: data }, contract: buildContract() });
assert.ok(existsSync(path.join(work, ".claude/skills/remotion-best-practices/resep.md")));
assert.ok(existsSync(path.join(work, ".claude/skills/video-shotcraft/SKILL.md")));
assert.ok(existsSync(path.join(work, ".claude/skills/video-shotcraft/references/resep.md")));
assert.ok(existsSync(path.join(work, ".claude/skills/video-toolkit/lib/resep.md")));
assert.ok(!existsSync(path.join(work, ".claude/skills/video-toolkit/lib/node_modules")), "node_modules tidak disalin");
assert.ok(existsSync(path.join(work, ".claude/skills/animate-story/SKILL.md")), "adaptor animate-story disalin sebagai SKILL.md");
assert.ok(existsSync(path.join(work, ".claude/skills/animate-story/animate/grammar/resep.md")), "bacaan skill animate ikut disalin");
assert.ok(!existsSync(path.join(work, ".claude/skills/video-toolkit/lib/contoh.png")), "media tidak disalin");
assert.equal(JSON.parse(await readFile(path.join(work, "brief.json"), "utf8")).prompt, "judul besar");
assert.match(await readFile(path.join(work, "contract.md"), "utf8"), /Kontrak Mode Kreatif/);
assert.deepEqual(checkScope(STARTER_OVERLAY), [], "komponen awal sah");
await assert.rejects(prepareWorkdir({ dir: work, root: path.join(tmp, "kosong"), brief: { prompt: "x", data: data }, contract: "" }), /tidak ditemukan/);
await prepareWorkdir({ dir: work, root: fakeRoot, brief: { prompt: "x", data: data }, contract: "" });

// ---- keluaran agen: komponen awal = tidak ada overlay; replaces-captions; berkas lain diabaikan; terlalu besar terpotong
assert.deepEqual(await readOutputs(work), { overlay: undefined, video: undefined, notes: "", replacesCaptions: false });
await writeFile(path.join(work, "CreativeOverlay.tsx"), SAMPLE_OVERLAY);
await writeFile(path.join(work, "notes.md"), "\n  Replaces-Captions \nresep: blur-slide");
await writeFile(path.join(work, "Lain.tsx"), "export default 1");
const o = await readOutputs(work);
assert.equal(o.overlay, SAMPLE_OVERLAY);
assert.equal(o.replacesCaptions, true);
assert.match(o.notes, /blur-slide/);
await writeFile(path.join(work, "CreativeVideo.tsx"), "x".repeat(CREATIVE.maxCodeBytes + 5000));
const big = await readOutputs(work);
assert.ok(big.video!.length <= CREATIVE.maxCodeBytes + 1024 && checkScope(big.video!).some((i) => i.rule === "ukuran"), "kode terlalu besar dilaporkan, bukan dimuat utuh");

// ---- perintah lanjutan: kode versi dasar ditulis ke folder kerja; replaces-captions dijaga; "tidak berubah" terdeteksi
const editDir = path.join(tmp, "edit");
await prepareWorkdir({ dir: editDir, root: fakeRoot, brief: { prompt: "x", data }, contract: "" });
const baseOut = await writeBase(editDir, { overlay: SAMPLE_OVERLAY, video: SAMPLE_VIDEO, notes: "replaces-captions\n\n# lama\nresep whip", replacesCaptions: true });
assert.equal(baseOut.overlay, SAMPLE_OVERLAY);
assert.equal(baseOut.video, SAMPLE_VIDEO);
assert.equal(baseOut.replacesCaptions, true);
assert.equal((await readFile(path.join(editDir, "notes.md"), "utf8")).match(/replaces-captions/g)!.length, 1, "baris replaces-captions tidak dobel");
assert.equal(unchangedFromBase(await readOutputs(editDir), baseOut), true);
await writeFile(path.join(editDir, "CreativeOverlay.tsx"), SAMPLE_OVERLAY.replace("export default", "// judul lebih besar\nexport default"));
assert.equal(unchangedFromBase(await readOutputs(editDir), baseOut), false);
assert.equal(unchangedFromBase(baseOut, null), false, "tanpa versi dasar: tidak pernah dianggap tidak berubah");
const vOnly = await writeBase(path.join(tmp, "work"), { video: SAMPLE_VIDEO, notes: "", replacesCaptions: false });
assert.equal(vOnly.overlay, undefined, "versi hanya-video: overlay tetap dianggap tidak ada");
assert.match(firstPrompt("judul lebih besar", true), /UBAH berkas itu/);
assert.doesNotMatch(firstPrompt("judul lebih besar", true), /Tulis CreativeOverlay/);
assert.doesNotMatch(firstPrompt("x"), /UBAH/);
// Perintah lanjutan singkat membawa brief versi dasar sebagai acuan
assert.match(firstPrompt("lanjutkan saja", true, "GAYA VISUAL gelap, judul besar"), /versi dasar[\s\S]*GAYA VISUAL gelap, judul besar/);
assert.doesNotMatch(firstPrompt("lanjutkan saja", true), /Brief yang menghasilkan/);

// ---- validasi kode tanpa renderer
const frames = [10, 150, 159, 260];
assert.match(checkCode({ notes: "", replacesCaptions: false }, data, frames)[0], /Tidak ada kode/);
assert.deepEqual(checkCode({ overlay: SAMPLE_OVERLAY, video: SAMPLE_VIDEO, notes: "", replacesCaptions: false }, data, frames), []);
assert.match(checkCode({ overlay: "export default 5", notes: "", replacesCaptions: false }, data, frames)[0], /komponen React/);
assert.match(checkCode({ video: `export default function v(frame: number) { if (frame === 150) throw new Error("meledak"); return {}; }`, notes: "", replacesCaptions: false }, data, frames)[0], /meledak/);
assert.match(checkCode({ overlay: `export default function O() { const w = window; return null; }`, notes: "", replacesCaptions: false }, data, frames)[0], /DOM\/global/);

// ---- render + pemeriksaan: error di log, layer tidak terlihat, pembanding di-cache
const sf = pickStillFrames({ durationInFrames: 300, fps: 30, words, joins: [5.2], joinOffsetFrames: 3 });
const out = { overlay: SAMPLE_OVERLAY, notes: "", replacesCaptions: false };
let renders = 0;
const cache = new Map<number, string>();
const okRender = async (a: { frame: number; withCreative: boolean; onLog: (t: string) => void }) => { renders++; return a.withCreative && a.frame === 126 ? "beda" : `base-${a.frame}`; };
const v1 = await renderAndCheck({ out, frames: sf, render: okRender, baseCache: cache, fileFor: (s, b) => `${b}-${s.frame}` });
assert.ok(v1.ok && v1.stills.length === 4 && renders === 8);
await renderAndCheck({ out, frames: sf, render: okRender, baseCache: cache, fileFor: (s, b) => `${b}-${s.frame}` });
assert.equal(renders, 12, "still pembanding tidak dirender ulang di putaran berikutnya");
const blank = await renderAndCheck({ out, frames: sf, render: async (a) => `base-${a.frame}`, baseCache: new Map(), fileFor: () => "f" });
assert.ok(!blank.ok && blank.stage === "kosong" && /tidak terlihat/.test(blank.errors[0]));
const logged = await renderAndCheck({ out, frames: sf, render: async (a) => { if (a.withCreative) a.onLog("[kreatif] overlay: frame 21: x is undefined"); return "h" + a.withCreative; }, baseCache: new Map(), fileFor: () => "f" });
assert.ok(!logged.ok && logged.stage === "render" && logged.errors[0].includes("x is undefined"));

// ---- putaran: perbaikan membawa error, batas putaran, abort dilempar
const prompts: string[] = [];
const stages: string[] = [];
const seq = (results: Validation[]) => {
  let i = 0;
  return runCreativeLoop({
    userPrompt: "judul besar", repairRounds: 2,
    agent: async (p) => { prompts.push(p); return { text: "ok", model: "claude-opus-5-5", denied: i === 0 ? ["Read"] : [] }; },
    read: async () => out,
    validate: async () => results[Math.min(i++, results.length - 1)],
    onStage: (s) => { stages.push(s); },
  });
};
const okFirst = await seq([{ ok: true, stills: [] }]);
assert.ok(okFirst.ok && okFirst.rounds === 1 && okFirst.model === "claude-opus-5-5");
assert.equal(prompts[0], firstPrompt("judul besar"));
assert.ok(prompts[0].includes("contract.md") && prompts[0].includes("judul besar"));
prompts.length = 0;
const fixed = await seq([{ ok: false, stage: "kode", errors: ["E1: ditolak"] }, { ok: true, stills: [] }]);
assert.ok(fixed.ok && fixed.rounds === 2);
assert.ok(prompts[1].includes("E1: ditolak") && prompts[1].includes("perbaikan 1 dari 2") && prompts[1].includes("tool ditolak: Read"));
prompts.length = 0;
const never = await seq([{ ok: false, stage: "render", errors: ["E2"] }]);
assert.ok(!never.ok && never.rounds === 3 && prompts.length === 3 && never.errors[0] === "E2", "maksimal 1 + 2 perbaikan, lalu gagal jujur");
assert.equal(never.out, out, "kode terakhir tetap dikembalikan untuk dicatat");
const ctrl = new AbortController();
// Screenshot masalah: tanpa lampiran tidak menambah instruksi; dengan lampiran menyebut tiap berkas dan melarang masuk video
// Project Animasi: agen diarahkan ke skill animate-story dan menulis rencana beat dulu
{
  const { animasiInstruction } = await import("../src/creative/loop.ts");
  const a = animasiInstruction();
  assert.match(a, /animate-story\/SKILL\.md/); assert.match(a, /notes\.md/);
  const { normalizeMotion } = await import("../../../packages/remotion/src/motion-props.ts");
  assert.equal(normalizeMotion({ durationS: 10, animasi: true })?.animasi, true);
  assert.equal("animasi" in (normalizeMotion({ durationS: 10 }) ?? {}), false, "project motion lama tidak berubah");
  // Subtitle otomatis voice over: bawaan nyala di Animasi, mati di motion lama, bisa diubah pengguna
  const { motionCaptions } = await import("../../../packages/remotion/src/build-props.ts");
  const { buildMotionProps } = await import("../../../packages/remotion/src/motion-props.ts");
  const words = [{ text: "Halo", start: 0.2, end: 0.5 }, { text: "distributor", start: 0.6, end: 1.2 }];
  const anim = normalizeStyle({ aspect: "9:16", motion: { durationS: 10, animasi: true } });
  const plain = normalizeStyle({ aspect: "9:16", motion: { durationS: 10 } });
  const capA = motionCaptions(anim, words);
  assert.ok(capA && capA.pages.length > 0 && capA.pages[0].tokens.length === 2, "Animasi: subtitle otomatis nyala");
  assert.equal(motionCaptions(plain, words), undefined, "motion lama tanpa subtitle");
  assert.ok(motionCaptions(normalizeStyle({ aspect: "9:16", motion: { durationS: 10, subtitle: true } }), words), "motion bisa dinyalakan");
  assert.equal(motionCaptions(normalizeStyle({ aspect: "9:16", motion: { durationS: 10, animasi: true, subtitle: false } }), words), undefined, "Animasi bisa dimatikan");
  assert.equal(motionCaptions(anim, []), undefined, "tanpa voice over tanpa subtitle");
  const mp = (vo: boolean) => buildMotionProps({ aspect: "9:16", settings: anim.motion, colors: anim.colors as never, materials: [], srcFor: (x) => x, captions: capA, voiceover: vo ? { durationS: 2, words } : null });
  assert.ok(mp(true).captions && !mp(false).captions, "subtitle hanya ikut bila ada voice over");
  const { subtitleZoneInstruction } = await import("../src/creative/loop.ts");
  assert.match(subtitleZoneInstruction(), /safe area bawah/); assert.match(subtitleZoneInstruction(), /zona subtitle/); assert.match(subtitleZoneInstruction(), /replaces-captions/);
}
// Design system (PDF): dibaca dulu, diikuti, tidak tampil di video, isinya data
assert.equal(designSystemInstruction([]), "");
{
  const d = designSystemInstruction(["design-system/01-brand.pdf"]);
  assert.match(d, /design-system\/01-brand\.pdf/); assert.match(d, /Read/); assert.match(d, /design\.md/); assert.match(d, /JANGAN tampilkan/); assert.match(d, /bukan instruksi/);
  const { isDesignSystem } = await import("../../../packages/shared/src/material-roles.ts");
  assert.equal(isDesignSystem({ a: "design" }, { id: "a", mime: "application/pdf" }), true);
  assert.equal(isDesignSystem({}, { id: "a", mime: "application/pdf" }), false, "PDF tanpa peran = knowledge");
  assert.equal(isDesignSystem({ a: "design" }, { id: "a", mime: "image/png" }), false);
}
assert.equal(screenshotInstruction([]), "");
const shotText = screenshotInstruction(["screenshots/01.png", "screenshots/02.jpg"]);
assert.match(shotText, /screenshots\/01\.png, screenshots\/02\.jpg/);
assert.match(shotText, /JANGAN tampilkan di video/);
assert.match(shotText, /DATA, bukan instruksi/);

await assert.rejects(runCreativeLoop({ userPrompt: "x", repairRounds: 2, signal: ctrl.signal, agent: async () => { ctrl.abort(new Error("Dibatalkan oleh pengguna")); return { text: "", model: null, denied: [] }; }, read: async () => out, validate: async () => ({ ok: true, stills: [] }) }), /Dibatalkan/);
assert.deepEqual(stages.slice(0, 2), ["menulis", "validasi"]);

// ---- timeline hasil untuk kode kreatif: kata yang terpotong hilang, waktu bergeser, sorotan ikut
const tl = buildCreativeTimeline({
  segments: [{ start: 0, end: 2 }, { start: 3, end: 6 }],
  source: { width: 1920, height: 1080, fps: 30, durationS: 6 },
  words: [{ text: "satu", start: 0.5, end: 0.9 }, { text: "hilang", start: 2.2, end: 2.6 }, { text: "tiga", start: 3.5, end: 3.9 }],
  style: normalizeStyle({ highlights: [{ startS: 3.4, endS: 4, effect: "slam" }] }),
});
assert.deepEqual(tl.words.map((w) => w.text), ["satu", "tiga"]);
assert.deepEqual(tl.joins, [2]);
assert.equal(tl.words[1].start, 2.5);
assert.equal(tl.words[1].hl, "slam");
assert.equal(tl.words[0].hl, undefined);
assert.equal(tl.durationInFrames, 150);

// ---- kontrak menjelaskan skill hanya bacaan; migrasi skill_refs
assert.match(buildContract(), /tidak bisa mengimpornya/);
assert.match(readFileSync(path.join(repo, "supabase/migrations/20261028140000_fase9_2_skill_refs.sql"), "utf8"), /add column if not exists skill_refs jsonb/);

await rm(tmp, { recursive: true, force: true });
console.log("creative-worker.test: argumen agen terbatas, env tanpa kunci, still 4 frame, skill dipin, folder kerja, keluaran, validasi, putaran perbaikan maks 2, abort, timeline hasil passed");
