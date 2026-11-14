// Siapkan analisis talent (Fase 24): venv Python di .cache/py-talent + model ONNX (sha256 dicek).
// Pakai: npm run setup:talent   (sekali saja; aman diulang)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Konstanta dibaca dari config tanpa memuat TypeScript
const cfg = readFileSync(path.join(root, "config/index.ts"), "utf8");
const block = cfg.slice(cfg.indexOf("export const TALENT"), cfg.indexOf("export const DENOISE"));
const venv = path.join(root, /venvDir:\s*"([^"]+)"/.exec(block)[1]);
const modelDir = path.join(root, /modelDir:\s*"([^"]+)"/.exec(block)[1]);
const pkgs = [.../pythonPackages:\s*\[([^\]]+)\]/.exec(block)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const models = [...block.matchAll(/\{ file: "([^"]+)", url: "([^"]+)", sha256: "([0-9a-f]{64})" \}/g)].map((m) => ({ file: m[1], url: m[2], sha256: m[3] }));
if (!pkgs.length || models.length !== 2) throw new Error("TALENT di config/index.ts tidak terbaca");
const py = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");

const run = (cmd, args) => {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!existsSync(py)) run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", venv]);
run(py, ["-m", "pip", "install", "--disable-pip-version-check", "-q", ...pkgs]);

mkdirSync(modelDir, { recursive: true });
for (const m of models) {
  const file = path.join(modelDir, m.file);
  const sha = (buf) => createHash("sha256").update(buf).digest("hex");
  if (existsSync(file) && sha(readFileSync(file)) === m.sha256) { console.log(`model ${m.file} sudah ada`); continue; }
  console.log(`mengunduh ${m.file}`);
  const r = await fetch(m.url);
  if (!r.ok) throw new Error(`Unduh ${m.file} gagal: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (sha(buf) !== m.sha256) throw new Error(`sha256 ${m.file} tidak cocok; berkas tidak dipakai`);
  writeFileSync(file, buf);
}
run(py, ["-c", "import onnxruntime, cv2, numpy, imageio_ffmpeg; print('talent siap: onnxruntime', onnxruntime.__version__, 'opencv', cv2.__version__)"]);
