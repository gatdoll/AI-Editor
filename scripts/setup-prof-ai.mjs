// Fase 27: rig Prof. AI sekali jalan dari MEDIA_DIR/karakter/prof-ai/ (venv talent: npm run setup:talent dulu).
// Hasil: character.json + check.png (lembar periksa titik sendi). Titik yang dikoreksi di "manual" pada character.json dipertahankan.
// Pakai: npm run setup:prof-ai
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = readFileSync(path.join(root, "config/index.ts"), "utf8");
const venv = path.join(root, /export const TALENT = \{[\s\S]*?venvDir:\s*"([^"]+)"/.exec(cfg)[1]);
const py = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
if (!existsSync(py)) { console.error("venv talent belum ada: jalankan npm run setup:talent dulu"); process.exit(1); }
const dir = path.join(process.env.MEDIA_DIR ?? path.join(root, "data", "media"), "karakter", "prof-ai");
if (!existsSync(dir)) { console.error(`folder tidak ada: ${dir}`); process.exit(1); }
const r = spawnSync(py, ["-I", path.join(root, "apps/worker/py/prof_ai_rig.py"), dir], { stdio: "inherit" });
if (r.status === 0) console.log(`Periksa ${path.join(dir, "check.png")}`);
process.exit(r.status ?? 1);
