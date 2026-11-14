// Fase 14: pustaka SFX di MEDIA_DIR/sfx (hanya Node). bawaan/manifest.json dari `npm run setup:sfx`; unggahan pengguna di
// unggahan/ dengan daftar library.json. Berlaku untuk semua project.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SFX } from "@app/config";
import { resolveMediaPath } from "./index.ts";
import { normalizeCues, type SfxCue, type SfxItem } from "./sfx.ts";

const BAWAAN = "sfx/bawaan/manifest.json";
const UNGGAHAN = "sfx/unggahan/library.json";

function readList(rel: string): SfxItem[] {
  const file = resolveMediaPath(rel);
  if (!fs.existsSync(file)) return [];
  try { return (JSON.parse(fs.readFileSync(file, "utf8")).items ?? []) as SfxItem[]; } catch { return []; }
}

/** Semua suara: bawaan dulu, lalu unggahan. */
export function listSfx(): SfxItem[] {
  return [...readList(BAWAAN), ...readList(UNGGAHAN)];
}

export function sfxPath(item: SfxItem): string {
  return resolveMediaPath(item.file);
}

export function getSfx(id: string): SfxItem | undefined {
  return listSfx().find((s) => s.id === id);
}

export async function addUploadedSfx(a: { name: string; tags: string[]; bytes: Buffer; ext: string; mime: string; durationS: number }): Promise<SfxItem> {
  const items = readList(UNGGAHAN);
  if (items.length >= SFX.upload.max) throw new Error(`Pustaka penuh (maks. ${SFX.upload.max} suara unggahan).`);
  const id = `u-${randomUUID()}`;
  const rel = `sfx/unggahan/${id}${a.ext}`;
  await fs.promises.mkdir(path.dirname(resolveMediaPath(rel)), { recursive: true });
  await fs.promises.writeFile(resolveMediaPath(rel), a.bytes);
  const item: SfxItem = { id, name: a.name, tags: a.tags, file: rel, mime: a.mime, durationS: a.durationS, source: "unggahan", license: "Unggahan pengguna" };
  await fs.promises.writeFile(resolveMediaPath(UNGGAHAN), JSON.stringify({ version: 1, items: [...items, item] }, null, 2));
  return item;
}

export async function removeUploadedSfx(id: string): Promise<boolean> {
  const items = readList(UNGGAHAN);
  const item = items.find((s) => s.id === id);
  if (!item) return false;
  await fs.promises.writeFile(resolveMediaPath(UNGGAHAN), JSON.stringify({ version: 1, items: items.filter((s) => s.id !== id) }, null, 2));
  await fs.promises.rm(resolveMediaPath(item.file), { force: true });
  return true;
}

/** Isyarat SFX versi Mode Kreatif (waktu hasil versi itu). File, bukan kolom tabel: tidak perlu migrasi. */
export const creativeSfxRel = (projectId: string, versionId: string) => `projects/${projectId}/creative/${versionId}/sfx.json`;

export function loadCreativeSfx(projectId: string, versionId: string): SfxCue[] {
  const file = resolveMediaPath(creativeSfxRel(projectId, versionId));
  if (!fs.existsSync(file)) return [];
  try { return normalizeCues(JSON.parse(fs.readFileSync(file, "utf8")), 86400).cues; } catch { return []; }
}

export async function saveCreativeSfx(projectId: string, versionId: string, cues: SfxCue[]): Promise<void> {
  const file = resolveMediaPath(creativeSfxRel(projectId, versionId));
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(cues, null, 2));
}
