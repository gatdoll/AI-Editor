// Fase 21: status aset sendiri (projects/<id>/aset-sendiri/state.json). File samping, bukan tabel: tanpa migrasi. Hanya Node.
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMediaPath } from "./index.ts";
import { loadNotes } from "./material-notes.ts";
import type { AssetCue } from "./opinion.ts";
import { ownCuesFrom, type OwnState } from "./own-assets.ts";

const stateRel = (projectId: string) => `projects/${projectId}/aset-sendiri/state.json`;

export function loadOwn(projectId: string): OwnState | null {
  const file = resolveMediaPath(stateRel(projectId));
  if (!fs.existsSync(file)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as OwnState;
    return s?.version === 1 && Array.isArray(s.items) ? s : null;
  } catch { return null; }
}

export async function saveOwn(projectId: string, s: OwnState): Promise<void> {
  const file = resolveMediaPath(stateRel(projectId));
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  // Berkas sementara lalu ganti nama: pembaca tidak pernah melihat JSON setengah jadi
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2));
  await fs.promises.rename(tmp, file);
}

/** Buang item yang bahannya sudah dihapus pengguna. Mengembalikan true bila ada yang berubah. */
export function reconcileOwn(s: OwnState, materialIds: Set<string>): boolean {
  const before = s.items.length;
  s.items = s.items.filter((i) => materialIds.has(i.assetId));
  return s.items.length !== before;
}

/**
 * Isyarat aset sendiri per id bahan (detik video mentah). Dipakai rute bahan web (pratinjau) DAN worker (brief, still, render),
 * agar `data.assets[i].cue` sama di semua tempat. `rows` = bahan project (id + label) yang masih ada.
 */
export function ownCues(projectId: string, rows: Array<{ id: string; label?: string | null }>): Map<string, AssetCue> {
  const state = loadOwn(projectId);
  if (!state) return new Map();
  const notes = loadNotes(projectId);
  return ownCuesFrom(state, new Map(rows.map((r) => [r.id, { label: r.label ?? "gambar", note: notes[r.id] ?? "" }])));
}

/** Gambar bahan project (id, label, peran tidak dibaca di sini). */
export async function imageMaterialRows(db: SupabaseClient, projectId: string): Promise<Array<{ id: string; label: string | null; storage_path: string; mime: string }>> {
  const { data } = await db.from("assets").select("id,label,storage_path,mime").eq("project_id", projectId).eq("kind", "material").order("created_at");
  return (data ?? []).filter((r) => String(r.mime ?? "").startsWith("image/")) as Array<{ id: string; label: string | null; storage_path: string; mime: string }>;
}
