// Fase 24: pustaka font Google Fonts (OFL) untuk Mode Kreatif di MEDIA_DIR/fonts/library + catalog.json + spesimen PNG.
// Pakai: npm run setup:fonts   (sekali saja; aman diulang: yang sudah ada dilewati)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
const env = existsSync(envFile) ? Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^MEDIA_DIR=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) : {};
const mediaDir = path.resolve(root, process.env.MEDIA_DIR ?? env.MEDIA_DIR ?? "data/media");
const cfg = readFileSync(path.join(root, "config/index.ts"), "utf8");
const block = cfg.slice(cfg.indexOf("export const FONT_LIBRARY"), cfg.indexOf("export const DENOISE"));
const dir = path.join(mediaDir, /dir:\s*"([^"]+)"/.exec(block)[1]);
const weights = /weights:\s*\[([^\]]+)\]/.exec(block)[1].split(",").map((x) => Number(x.trim()));
const families = [.../families:\s*\[([\s\S]*?)\]\s*,\s*\}/.exec(block)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const talentBlock = cfg.slice(cfg.indexOf("export const TALENT"), cfg.indexOf("export const FONT_LIBRARY"));
const venv = path.join(root, /venvDir:\s*"([^"]+)"/.exec(talentBlock)[1]);
if (!families.length) throw new Error("FONT_LIBRARY.families tidak terbaca");
mkdirSync(dir, { recursive: true });

const slug = (f) => f.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const catalogFile = path.join(dir, "catalog.json");
const old = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, "utf8")).fonts ?? [] : [];
const fonts = [];
for (const family of families) {
  for (const w of weights) {
    const id = `${slug(family)}-${w}`;
    const file = `${id}.ttf`;
    if (existsSync(path.join(dir, file))) { fonts.push(old.find((x) => x.id === id) ?? { id, family, weight: w, file }); continue; }
    const r = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${w}`);
    if (r.status === 400) continue; // berat ini tidak tersedia untuk keluarga ini
    if (!r.ok) throw new Error(`${family} ${w}: HTTP ${r.status}`);
    const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/.exec(await r.text())?.[1];
    if (!url) { console.log(`lewati ${family} ${w}: tidak ada TTF`); continue; }
    const f = await fetch(url);
    if (!f.ok) throw new Error(`${family} ${w}: unduh HTTP ${f.status}`);
    writeFileSync(path.join(dir, file), Buffer.from(await f.arrayBuffer()));
    fonts.push({ id, family, weight: w, file });
    console.log(`✓ ${family} ${w}`);
  }
}

// Spesimen: satu gambar per keluarga, satu baris per berat. Pakai ffmpeg dari imageio-ffmpeg (punya drawtext).
const py = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
if (!existsSync(py)) spawnSync(process.platform === "win32" ? "python" : "python3", ["-m", "venv", venv], { stdio: "inherit" });
spawnSync(py, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "imageio-ffmpeg==0.6.0"], { stdio: "inherit" });
const ffmpeg = spawnSync(py, ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8" }).stdout.trim();
let specimens = 0;
for (const family of families) {
  const list = fonts.filter((x) => x.family === family);
  if (!list.length) continue;
  const out = `${slug(family)}.png`;
  for (const x of list) x.specimen = out;
  if (existsSync(path.join(dir, out)) || !ffmpeg) continue;
  const rowH = 120;
  const filters = list.map((x, i) => `drawtext=fontfile=${x.file}:text='${family} ${x.weight}  ABCDEFG abcdefg 0123 KATA':fontsize=64:fontcolor=black:x=24:y=${i * rowH + 28}`).join(",");
  const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=white:s=1400x${list.length * rowH + 20}`, "-vf", filters, "-frames:v", "1", out], { cwd: dir, encoding: "utf8" });
  if (r.status === 0) specimens++; else console.log(`spesimen ${family} gagal: ${r.stderr?.slice(-200)}`);
}
writeFileSync(catalogFile, JSON.stringify({ version: 1, fonts }, null, 2));
console.log(`Pustaka font siap: ${new Set(fonts.map((x) => x.family)).size} keluarga, ${fonts.length} file, ${specimens} spesimen baru di ${dir}`);
