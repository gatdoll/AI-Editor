// Fase 15: peran bahan gambar ("logo" atau "gambar"). Disimpan di file samping folder bahan project
// (projects/<id>/materials/roles.json), bukan kolom tabel: tidak perlu migrasi. Hanya Node.
import fs from "node:fs";
import path from "node:path";
import { resolveMediaPath } from "./index.ts";

/** "design" = PDF design system: hanya dibaca AI sebagai panduan gaya (warna, tipografi, spacing), tidak masuk video. */
export type MaterialRole = "logo" | "gambar" | "design";
export type ImageRole = "logo" | "gambar";

const rel = (projectId: string) => `projects/${projectId}/materials/roles.json`;

/** Tanpa pilihan pengguna: nama berkas berisi "logo" = logo. */
export const defaultRole = (label: string | null | undefined): ImageRole => (/logo/i.test(label ?? "") ? "logo" : "gambar");

export function loadRoles(projectId: string): Record<string, MaterialRole> {
  const file = resolveMediaPath(rel(projectId));
  if (!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v === "logo" || v === "gambar" || v === "design")) as Record<string, MaterialRole>;
  } catch { return {}; }
}

/** PDF yang ditandai sebagai design system. */
export const isDesignSystem = (roles: Record<string, MaterialRole>, m: { id: string; mime?: string | null }): boolean => m.mime === "application/pdf" && roles[m.id] === "design";

/** Peran gambar. Peran "design" tidak berlaku untuk gambar: kembali ke bawaan dari nama berkas. */
export function roleOf(roles: Record<string, MaterialRole>, m: { id: string; label?: string | null }): ImageRole {
  const r = roles[m.id];
  return r === "logo" || r === "gambar" ? r : defaultRole(m.label);
}

/** `role` null = hapus pilihan (kembali ke bawaan dari nama berkas). */
export async function setRole(projectId: string, id: string, role: MaterialRole | null): Promise<void> {
  const roles = loadRoles(projectId);
  if (role) roles[id] = role; else delete roles[id];
  const file = resolveMediaPath(rel(projectId));
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(roles, null, 2));
}
