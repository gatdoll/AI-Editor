// Fase 25: rig karakter yang sudah dibuat (projects/<pid>/rig/<assetId>.json). File samping, tanpa migrasi. Hanya Node.
import fs from "node:fs";
import { resolveMediaPath } from "./index.ts";
import { parseRig, rigRel, type CharacterRig } from "./rig.ts";

export function loadRig(projectId: string, assetId: string): CharacterRig | null {
  const file = resolveMediaPath(rigRel(projectId, assetId));
  if (!fs.existsSync(file)) return null;
  try { return parseRig(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { return null; }
}

/** Tambahkan `rig` ke bahan gambar yang sudah di-rig. Dipakai rute bahan web (pratinjau) dan worker (still + render). */
export function withRigs<T extends { id: string; mime?: string | null }>(projectId: string, materials: T[]): Array<T & { rig?: CharacterRig }> {
  return materials.map((m) => {
    if (!String(m.mime ?? "").startsWith("image/")) return m;
    const rig = loadRig(projectId, m.id);
    return rig ? { ...m, rig } : m;
  });
}
