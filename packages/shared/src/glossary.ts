// Daftar istilah pengguna (nama produk, merek, singkatan) untuk transkrip: petunjuk bagi Whisper (--prompt) dan ejaan
// yang benar bagi koreksi AI. Satu untuk semua project (dipakai sendiri). Berkas MEDIA_DIR/glossary.txt. Hanya Node.
import fs from "node:fs";
import path from "node:path";
import { resolveMediaPath } from "./index.ts";

const REL = "glossary.txt";
export const GLOSSARY_MAX_CHARS = 1500;

export const cleanGlossary = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f]+/g, " ").split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean).join(", ").slice(0, GLOSSARY_MAX_CHARS);

export function loadGlossary(): string {
  const file = resolveMediaPath(REL);
  try { return fs.existsSync(file) ? cleanGlossary(fs.readFileSync(file, "utf8")) : ""; } catch { return ""; }
}

export async function saveGlossary(text: string): Promise<string> {
  const clean = cleanGlossary(text);
  const file = resolveMediaPath(REL);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, clean);
  return clean;
}
