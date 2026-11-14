// Siapkan voice over (Fase 17): venv Python 3.12 di .cache/py-voxcpm + voxcpm versi yang dipin di config + model VoxCPM2 (sekitar 5 GB).
// Butuh uv (docs.astral.sh/uv). Env VOICEOVER_TORCH_INDEX menimpa sumber PyTorch, mis. build CUDA di mesin ber-GPU.
// Pakai: npm run setup:voiceover   (sekali saja; aman diulang)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Dibaca dari config tanpa memuat TypeScript: cukup cari nilainya di dalam blok voiceover
const cfg = readFileSync(path.join(root, "config/index.ts"), "utf8").split("voiceover: {")[1] ?? "";
const read = (key) => new RegExp(`${key}:\\s*"([^"]+)"`).exec(cfg)?.[1];
const pkg = read("pythonPackage"), venvRel = read("venvDir"), modelRel = read("modelDir"), repo = read("modelRepo"), torchIndex = process.env.VOICEOVER_TORCH_INDEX ?? read("torchIndex");
if (!pkg || !venvRel || !modelRel || !repo || !torchIndex) throw new Error("MOTION_GFX.voiceover tidak lengkap di config/index.ts");
const venv = path.join(root, venvRel), modelDir = path.join(root, modelRel);
const py = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");

const run = (cmd, args) => {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(py)) run("uv", ["venv", "--python", "3.12", "--seed", venv]);
run("uv", ["pip", "install", "--python", py, "torch", "torchaudio", "--index-url", torchIndex]);
run("uv", ["pip", "install", "--python", py, pkg]);
// local_dir, bukan cache Hugging Face: cache butuh hak symlink yang tidak selalu ada di Windows
run(py, ["-c", `from huggingface_hub import snapshot_download; snapshot_download(${JSON.stringify(repo)}, local_dir=${JSON.stringify(modelDir)})`]);
console.log("Voice over siap.");
