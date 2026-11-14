// Folder kerja sementara untuk agen Mode Kreatif: skill (dipin ke commit), brief.json, contract.md, contoh komponen.
// Agen hanya bisa membaca/menulis di folder ini (lihat agentArgs). Hasilnya dibaca kode kita, tidak dipercaya begitu saja.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CREATIVE } from "@app/config";
import type { CreativeData } from "../../../../packages/remotion/src/creative/contract.ts";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * Di luar repo, agar CLAUDE.md proyek tidak ikut terbaca oleh agen. Path ASLI (realpath), bukan nama pendek Windows
 * (C:\Users\AILAB~1\...): Claude menyelesaikan path ke nama panjang, sehingga izin `./**` relatif ke cwd nama pendek
 * tidak pernah cocok dan semua Read di folder kerja ditolak (uji 28 Okt 2026).
 */
export function creativeWorkdir(jobId: string): string {
  // os.tmpdir() = WORKER_TMP (temp-dir.ts) di proses worker: di luar repo dan di luar drive sistem
  return path.join(realpathSync.native(os.tmpdir()), "editing-video-creative", jobId.replace(/[^\w-]/g, "_"));
}

export type SkillKey = keyof typeof CREATIVE.skills;
export type SkillRefs = Record<SkillKey, string>;

/** Bagian tiap skill yang disalin: sumber (relatif ke root repo) -> tujuan (relatif ke .claude/skills). */
export const SKILL_COPIES: Record<SkillKey, Array<{ from: string; to: string }>> = {
  remotion: [{ from: ".agents/skills/remotion-best-practices", to: "remotion-best-practices" }],
  shotcraft: [
    { from: `.cache/${CREATIVE.skills.shotcraft.dir}/SKILL.md`, to: "video-shotcraft/SKILL.md" },
    { from: `.cache/${CREATIVE.skills.shotcraft.dir}/references`, to: "video-shotcraft/references" },
    { from: `.cache/${CREATIVE.skills.shotcraft.dir}/assets/lib`, to: "video-shotcraft/assets/lib" },
  ],
  toolkit: [
    { from: `.cache/${CREATIVE.skills.toolkit.dir}/.claude/skills/remotion/SKILL.md`, to: "video-toolkit/SKILL.md" },
    { from: `.cache/${CREATIVE.skills.toolkit.dir}/.claude/skills/remotion/reference.md`, to: "video-toolkit/reference.md" },
    { from: `.cache/${CREATIVE.skills.toolkit.dir}/lib`, to: "video-toolkit/lib" },
  ],
  // Adaptor kita (SKILL.md) + bacaan dari skill asli. Alur interaktif, tools/ dan templates/ tidak disalin (tidak berlaku tanpa shell).
  animate: [
    { from: "apps/worker/src/creative/skills/animate-story.md", to: "animate-story/SKILL.md" },
    { from: `.cache/${CREATIVE.skills.animate.dir}/LICENSE`, to: "animate-story/animate/LICENSE" },
    { from: `.cache/${CREATIVE.skills.animate.dir}/plugins/animate/skills/animate/craft.md`, to: "animate-story/animate/craft.md" },
    { from: `.cache/${CREATIVE.skills.animate.dir}/plugins/animate/skills/animate/grammar`, to: "animate-story/animate/grammar" },
    { from: `.cache/${CREATIVE.skills.animate.dir}/plugins/animate/skills/animate/styles`, to: "animate-story/animate/styles" },
    { from: `.cache/${CREATIVE.skills.animate.dir}/plugins/animate/skills/animate/kit/core.js`, to: "animate-story/animate/kit/core.js" },
    { from: `.cache/${CREATIVE.skills.animate.dir}/plugins/animate/skills/animate/kit/morph.js`, to: "animate-story/animate/kit/morph.js" },
    { from: `.cache/${CREATIVE.skills.animate.dir}/plugins/animate/skills/animate/examples/history-of-ai`, to: "animate-story/animate/examples/history-of-ai" },
  ],
};

type Git = (args: string[], cwd: string) => { status: number | null; stdout: string; stderr: string };
const realGit: Git = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error?.message ?? "") };
};

/**
 * Pastikan sumber skill ada dan tepat di commit yang dipin. Checkout yang hilang diunduh (sparse, sama dengan
 * scripts/studio-reference.mjs). Checkout yang berbeda commit TIDAK diubah otomatis: job gagal dengan pesan jelas.
 */
export async function ensureSkillSources(root = REPO_ROOT, git: Git = realGit): Promise<SkillRefs> {
  if (!existsSync(path.join(root, ".agents/skills/remotion-best-practices/SKILL.md"))) {
    throw new Error("Skill remotion-best-practices tidak ada di .agents/skills/. Pasang ulang skill sebelum memakai Mode Kreatif.");
  }
  for (const key of ["shotcraft", "toolkit", "animate"] as const) {
    const ref = CREATIVE.skills[key];
    const dir = path.join(root, ".cache", ref.dir);
    const step = (args: string[], cwd = dir) => {
      const r = git(args, cwd);
      if (r.status !== 0) throw new Error(`Gagal mengunduh skill ${key} (git ${args[0]}): ${r.stderr.trim().slice(0, 300) || "git tidak tersedia"}`);
      return r.stdout.trim();
    };
    if (!existsSync(path.join(dir, ".git"))) {
      await mkdir(path.dirname(dir), { recursive: true });
      step(["clone", "--filter=blob:none", "--no-checkout", "--depth=1", ref.repo, dir], root);
      step(["sparse-checkout", "set", ...ref.sparse]);
      step(["fetch", "--depth=1", "origin", ref.sha]);
      step(["checkout", "--detach", ref.sha]);
    }
    const head = step(["rev-parse", "HEAD"]);
    if (head !== ref.sha) throw new Error(`Skill ${key} di ${dir} ada di commit ${head.slice(0, 12)}, bukan commit yang dipin ${ref.sha.slice(0, 12)}. Tidak diubah otomatis.`);
  }
  return { remotion: CREATIVE.skills.remotion.sha, shotcraft: CREATIVE.skills.shotcraft.sha, toolkit: CREATIVE.skills.toolkit.sha, animate: CREATIVE.skills.animate.sha };
}

/** Komponen awal: sah tetapi tidak menggambar apa pun. Bila tidak diubah agen, dianggap tidak ada overlay. */
export const STARTER_OVERLAY = `import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

// Ganti isi berkas ini. Baca contract.md dan brief.json lebih dulu.
export default function Overlay({ data }: CreativeProps) {
  const frame = useCurrentFrame();
  return <AbsoluteFill />;
}
`;

/** Bentuk `data` sama persis dengan props saat render; nilai `fonts` di sini nama tampilan, saat render nama keluarga yang dimuat. */
export type Brief = { prompt: string; data: CreativeData; /** Fase 14: suara yang boleh dipakai di sfx.json. */ sfxLibrary?: Array<{ id: string; name: string; tags: string[]; durationS: number }> };

export async function prepareWorkdir(a: { dir: string; root?: string; brief: Brief; contract: string }): Promise<void> {
  const root = a.root ?? REPO_ROOT;
  await rm(a.dir, { recursive: true, force: true });
  await mkdir(path.join(a.dir, ".claude", "skills"), { recursive: true });
  for (const parts of Object.values(SKILL_COPIES)) {
    for (const p of parts) {
      const from = path.join(root, p.from);
      if (!existsSync(from)) throw new Error(`Berkas skill tidak ditemukan: ${p.from}`);
      await cp(from, path.join(a.dir, ".claude", "skills", p.to), {
        recursive: true,
        filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) && !/\.(png|jpe?g|gif|mp4|mp3|wav|webm|mov)$/i.test(src),
      });
    }
  }
  // Fase 25: topeng alfa rig (base64) tidak berguna bagi AI; diganti ringkasan bagian yang bisa bergerak
  const brief = { ...a.brief, data: { ...a.brief.data, ...(a.brief.data.assets ? { assets: a.brief.data.assets.map(({ rig, ...x }) => (rig ? { ...x, rig: { kepala: true, kaki: rig.legs ? "kiri+kanan" : "menyatu", kedip: !!rig.eyes, mulut: !!rig.mouth, catatan: rig.notes } } : x)) } : {}) } };
  await writeFile(path.join(a.dir, "brief.json"), JSON.stringify(brief, null, 2));
  await writeFile(path.join(a.dir, "contract.md"), a.contract);
  await writeFile(path.join(a.dir, "CreativeOverlay.tsx"), STARTER_OVERLAY);
}

export type CreativeOutputs = { overlay?: string; video?: string; notes: string; replacesCaptions: boolean; /** Fase 14: isi mentah sfx.json (divalidasi kode kita). */ sfx?: string };

/**
 * Tulis kode versi dasar ke folder kerja (perintah lanjutan). `replaces-captions` dijaga di baris pertama notes.md
 * agar pilihan itu tidak hilang diam-diam. Mengembalikan isi yang terbaca kembali (pembanding "tidak berubah").
 */
export async function writeBase(dir: string, base: { overlay?: string; video?: string; notes: string; replacesCaptions: boolean; sfx?: unknown[] }): Promise<CreativeOutputs> {
  await writeFile(path.join(dir, "CreativeOverlay.tsx"), base.overlay ?? STARTER_OVERLAY);
  if (base.sfx?.length) await writeFile(path.join(dir, "sfx.json"), JSON.stringify(base.sfx, null, 2));
  if (base.video) await writeFile(path.join(dir, "CreativeVideo.tsx"), base.video);
  const body = base.notes.replace(/^\s*replaces-captions\s*\n?/i, "").trim();
  await writeFile(path.join(dir, "notes.md"), `${base.replacesCaptions ? "replaces-captions\n\n" : ""}${body}\n`);
  return readOutputs(dir);
}

async function readCapped(file: string, max: number): Promise<string | undefined> {
  if (!existsSync(file)) return undefined;
  const s = await stat(file);
  if (!s.isFile()) return undefined;
  // Berkas yang terlalu besar tetap dibaca sebagian agar validator melaporkan ukurannya, bukan diam
  if (s.size > max) return (await readFile(file, "utf8")).slice(0, max);
  return readFile(file, "utf8");
}

/** Baca hasil agen. Berkas lain yang mungkin ditulis agen diabaikan. */
export async function readOutputs(dir: string): Promise<CreativeOutputs> {
  const cap = CREATIVE.maxCodeBytes + 1024;
  const overlayRaw = await readCapped(path.join(dir, "CreativeOverlay.tsx"), cap);
  const video = await readCapped(path.join(dir, "CreativeVideo.tsx"), cap);
  const notes = ((await readCapped(path.join(dir, "notes.md"), CREATIVE.maxNotesChars)) ?? "").trim();
  const sfx = await readCapped(path.join(dir, "sfx.json"), 64 * 1024);
  const overlay = overlayRaw && overlayRaw.trim() !== STARTER_OVERLAY.trim() && overlayRaw.trim() ? overlayRaw : undefined;
  const first = notes.split(/\r?\n/).find((l) => l.trim())?.trim().toLowerCase();
  return { overlay, video: video?.trim() ? video : undefined, notes, replacesCaptions: first === "replaces-captions", ...(sfx?.trim() ? { sfx } : {}) };
}
