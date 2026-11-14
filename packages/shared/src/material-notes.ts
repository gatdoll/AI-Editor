// Fase 21: keterangan per bahan (tulisan pengguna tentang isi gambar, dipakai AI untuk mencocokkan dengan transkrip).
// File samping projects/<id>/materials/notes.json, mengikuti pola roles.json: tanpa migrasi. Hanya Node.
import fs from "node:fs";
import path from "node:path";
import { OWN_ASSETS } from "@app/config";
import { resolveMediaPath } from "./index.ts";

const rel = (projectId: string) => `projects/${projectId}/materials/notes.json`;

/** Bersihkan keterangan: tanpa karakter kontrol, spasi dirapikan, dipotong ke batas. */
export const cleanNote = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, OWN_ASSETS.noteMaxChars);

export function loadNotes(projectId: string): Record<string, string> {
  const file = resolveMediaPath(rel(projectId));
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [k, cleanNote(v as string)]));
  } catch { return {}; }
}

/** Kosong = hapus keterangan. */
export async function setNote(projectId: string, id: string, note: string): Promise<string> {
  const notes = loadNotes(projectId);
  const clean = cleanNote(note);
  if (clean) notes[id] = clean; else delete notes[id];
  const file = resolveMediaPath(rel(projectId));
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(notes, null, 2));
  await fs.promises.rename(tmp, file);
  return clean;
}
