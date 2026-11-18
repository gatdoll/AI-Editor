// Fase 27: rig dan berkas Prof. AI di MEDIA_DIR/karakter/prof-ai/. Hanya Node.
import fs from "node:fs";
import { resolveMediaPath } from "./index.ts";
import { parseProfAiRig, PROF_AI_DIR, PROF_AI_FILES, PROF_AI_RIG_FILE, PROF_AI_SRC_PREFIX, type ProfAiFile, type ProfAiRig } from "./prof-ai.ts";

/** null = belum di-rig (`npm run setup:prof-ai`) atau berkas rusak. */
export function loadProfAiRig(): ProfAiRig | null {
  const file = resolveMediaPath(PROF_AI_RIG_FILE);
  if (!fs.existsSync(file)) return null;
  try { return parseProfAiRig(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { return null; }
}

export const profAiFilePath = (f: ProfAiFile) => resolveMediaPath(`${PROF_AI_DIR}/${f}`);

/** Berkas yang ada, sebagai bahan server lokal render (id `profai:<berkas>`). */
export function profAiServeFiles(): Array<{ id: string; file: string; type: string }> {
  return PROF_AI_FILES.filter((f) => fs.existsSync(profAiFilePath(f))).map((f) => ({ id: PROF_AI_SRC_PREFIX + f, file: profAiFilePath(f), type: f.endsWith(".mavatar") ? "application/zip" : "image/png" }));
}
