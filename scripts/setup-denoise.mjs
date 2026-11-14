// Siapkan Python untuk reduksi noise (Fase 11): venv di .cache/py-denoise + noisereduce versi yang dipin di config.
// Pakai: npm run setup:denoise   (sekali saja; aman diulang)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Dibaca dari config tanpa memuat TypeScript: cukup cari string versinya
const { readFileSync } = await import("node:fs");
const cfg = readFileSync(path.join(root, "config/index.ts"), "utf8");
const pkg = /pythonPackage:\s*"([^"]+)"/.exec(cfg)?.[1];
const venvRel = /venvDir:\s*"([^"]+)"/.exec(cfg)?.[1];
if (!pkg || !venvRel) throw new Error("DENOISE.pythonPackage / venvDir tidak ditemukan di config/index.ts");
const venv = path.join(root, venvRel);
const py = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");

const run = (cmd, args) => {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(py)) run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", venv]);
run(py, ["-m", "pip", "install", "--disable-pip-version-check", "-q", pkg]);
run(py, ["-c", "import noisereduce, scipy, numpy; print('noisereduce siap:', noisereduce.__version__ if hasattr(noisereduce, '__version__') else 'ok')"]);
