// Fase 24: font tambahan Mode Kreatif. Pustaka Google Fonts (MEDIA_DIR/fonts/library, `npm run setup:fonts`) + font unggahan
// pengguna (bahan project). Pilihan per versi kreatif disimpan sebagai berkas (projects/<pid>/creative/<vid>/fonts.json): tanpa migrasi.
// Hanya Node.
import fs from "node:fs";
import path from "node:path";
import { FONT_LIBRARY } from "@app/config";
import { resolveMediaPath } from "./index.ts";

/** Satu file font yang dimuat komposisi. `file` = path relatif folder media. */
export type FontRef = { id: string; family: string; weight: number; file: string; source: "pustaka" | "unggahan" };
type LibraryEntry = { id: string; family: string; weight: number; file: string; specimen?: string };

const libRel = (name: string) => `${FONT_LIBRARY.dir}/${name}`;

export function listFontLibrary(): Array<LibraryEntry & { rel: string; specimenRel?: string }> {
  const file = resolveMediaPath(libRel("catalog.json"));
  if (!fs.existsSync(file)) return [];
  try {
    const list = (JSON.parse(fs.readFileSync(file, "utf8")).fonts ?? []) as LibraryEntry[];
    return list.filter((x) => /^[a-z0-9-]+$/.test(x.id) && /^[a-z0-9-]+\.ttf$/.test(x.file)).map((x) => ({ ...x, rel: libRel(x.file), ...(x.specimen && /^[a-z0-9-]+\.png$/.test(x.specimen) ? { specimenRel: libRel(x.specimen) } : {}) }));
  } catch { return []; }
}

/** Font pustaka berdasarkan id (mis. "anton-400"). */
export function libraryFont(id: string): FontRef | null {
  const x = listFontLibrary().find((f) => f.id === id);
  return x ? { id: x.id, family: x.family, weight: x.weight, file: x.rel, source: "pustaka" } : null;
}

/** Nama keluarga font unggahan: nama berkas tanpa ekstensi, dibersihkan (dipakai apa adanya di fontFamily). */
export const uploadedFamily = (label: string) => path.basename(label).replace(/\.(ttf|otf|woff2?)$/i, "").replace(/[^\w\s-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Font";

export const isFontFile = (name: string) => /\.(ttf|otf|woff2?)$/i.test(name);

const versionRel = (projectId: string, versionId: string) => `projects/${projectId}/creative/${versionId}/fonts.json`;

export function loadCreativeFonts(projectId: string, versionId: string): FontRef[] {
  const file = resolveMediaPath(versionRel(projectId, versionId));
  if (!fs.existsSync(file)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(file, "utf8")) as FontRef[];
    // Hanya berkas di pustaka atau di folder bahan project ini (mencegah path ke luar)
    return list.filter((f) => f && typeof f.family === "string" && typeof f.file === "string" && !f.file.includes("..")
      && (f.file.startsWith(`${FONT_LIBRARY.dir}/`) || f.file.startsWith(`projects/${projectId}/materials/`))).slice(0, FONT_LIBRARY.maxPerVersion);
  } catch { return []; }
}

export async function saveCreativeFonts(projectId: string, versionId: string, fonts: FontRef[]): Promise<void> {
  const file = resolveMediaPath(versionRel(projectId, versionId));
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(fonts.slice(0, FONT_LIBRARY.maxPerVersion), null, 2));
}

export const fontMime = (file: string) => (FONT_LIBRARY.mimes as Record<string, string>)[path.extname(file).toLowerCase()] ?? "font/ttf";
