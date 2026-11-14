// Fase 14: siapkan pustaka SFX bawaan di MEDIA_DIR/sfx/bawaan + manifest.json.
// - Kurasi dari paket Kenney (CC0): Interface Sounds + Impact Sounds. Unduh lewat alur resmi kenney.nl bila belum ada.
// - Whoosh/riser/downlifter/sub-drop dibuat sendiri (scripts/sfx-synth.py), bebas lisensi.
// Pakai: npm run setup:sfx   (aman diulang; butuh venv .cache/py-denoise dari npm run setup:denoise)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/).filter((l) => /^MEDIA_DIR=/.test(l)).map((l) => l.split("=")));
const mediaDir = path.resolve(root, env.MEDIA_DIR ?? "data/media");
const out = path.join(mediaDir, "sfx", "bawaan");
const src = path.join(root, ".cache", "sfx-src");
mkdirSync(out, { recursive: true });
mkdirSync(src, { recursive: true });

const compositor = path.join(root, "node_modules", "@remotion", readdirSync(path.join(root, "node_modules", "@remotion")).find((n) => n.startsWith("compositor-")));
const ffmpeg = path.join(compositor, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const ffprobe = path.join(compositor, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8" }); if (r.status !== 0) throw new Error(`${path.basename(cmd)}: ${r.stderr || r.stdout}`); return r.stdout; };

// ---- unduh paket Kenney (alur resmi: halaman -> link bertanda tangan -> zip)
for (const pack of ["interface-sounds", "impact-sounds"]) {
  const dir = path.join(src, pack);
  if (existsSync(path.join(dir, "License.txt"))) continue;
  const page = await (await fetch(`https://kenney.nl/assets/${pack}`, { headers: { "user-agent": "Mozilla/5.0" } })).text();
  const id = /data-download-id='([0-9a-f]+)'/.exec(page)?.[1];
  const link = await (await fetch(`https://kenney.nl/download-link/${id}`, { headers: { "user-agent": "Mozilla/5.0", referer: `https://kenney.nl/assets/${pack}` } })).json();
  const zip = path.join(src, `${pack}.zip`);
  writeFileSync(zip, Buffer.from(await (await fetch(link.url)).arrayBuffer()));
  mkdirSync(dir, { recursive: true });
  run(process.platform === "win32" ? "tar" : "unzip", process.platform === "win32" ? ["-xf", zip, "-C", dir] : ["-o", zip, "-d", dir]);
  console.log(`diunduh: ${pack}`);
}

// ---- kurasi: nama yang dipahami AI dan pengguna, tag untuk dicari
const KENNEY = [
  ["click", "interface-sounds", "click_002.ogg", ["klik", "tombol", "ui"]],
  ["tick", "interface-sounds", "tick_001.ogg", ["detik", "ketik", "kecil"]],
  ["pop", "interface-sounds", "drop_002.ogg", ["muncul", "teks", "kata kunci"]],
  ["pluck", "interface-sounds", "pluck_001.ogg", ["muncul", "lembut"]],
  ["select", "interface-sounds", "select_003.ogg", ["pilih", "sorot"]],
  ["ding", "interface-sounds", "confirmation_001.ogg", ["benar", "angka", "sukses"]],
  ["notifikasi", "interface-sounds", "confirmation_003.ogg", ["notif", "pesan", "info"]],
  ["ting", "interface-sounds", "glass_002.ogg", ["kilau", "highlight"]],
  ["error", "interface-sounds", "error_005.ogg", ["salah", "gagal", "peringatan"]],
  ["glitch", "interface-sounds", "glitch_002.ogg", ["digital", "transisi"]],
  ["switch", "interface-sounds", "switch_003.ogg", ["ganti", "toggle"]],
  ["scroll", "interface-sounds", "scroll_002.ogg", ["gulir", "daftar"]],
  ["impact-ringan", "impact-sounds", "impactSoft_medium_000.ogg", ["tekan", "penegasan", "lembut"]],
  ["impact-berat", "impact-sounds", "impactPunch_heavy_000.ogg", ["penegasan", "kuat", "zoom"]],
  ["metal", "impact-sounds", "impactMetal_medium_001.ogg", ["dentang", "keras"]],
  ["bell", "impact-sounds", "impactBell_heavy_000.ogg", ["lonceng", "momen"]],
];
const items = [];
const probe = (f) => Number(run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim());
for (const [name, pack, file, tags] of KENNEY) {
  const from = path.join(src, pack, "Audio", file);
  const to = path.join(out, `${name}.ogg`);
  copyFileSync(from, to);
  items.push({ id: `b-${name}`, name, tags, file: `sfx/bawaan/${name}.ogg`, mime: "audio/ogg", durationS: Math.round(probe(to) * 1000) / 1000, source: "bawaan", license: `CC0 - Kenney ${pack === "interface-sounds" ? "Interface Sounds" : "Impact Sounds"} (kenney.nl)` });
}
for (const pack of ["interface-sounds", "impact-sounds"]) copyFileSync(path.join(src, pack, "License.txt"), path.join(out, `LICENSE-kenney-${pack}.txt`));

// ---- buatan sendiri
const py = path.join(root, ".cache", "py-denoise", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const synthDir = path.join(src, "synth");
console.log(run(existsSync(py) ? py : "python", ["-I", path.join(root, "scripts", "sfx-synth.py"), synthDir]).trim().split("\n").join(", "));
const SYNTH_TAGS = {
  "whoosh-cepat": ["transisi", "cepat", "masuk"], whoosh: ["transisi", "geser", "masuk"], "swoosh-tinggi": ["transisi", "ringan"],
  "whoosh-turun": ["keluar", "transisi"], riser: ["menuju", "ketegangan", "sebelum momen"], downlifter: ["turun", "selesai", "keluar"], "sub-drop": ["penegasan", "dentuman", "zoom"],
};
for (const [name, tags] of Object.entries(SYNTH_TAGS)) {
  const to = path.join(out, `${name}.mp3`);
  run(ffmpeg, ["-y", "-v", "error", "-i", path.join(synthDir, `${name}.wav`), "-c:a", "libmp3lame", "-b:a", "160k", to]);
  items.push({ id: `b-${name}`, name, tags, file: `sfx/bawaan/${name}.mp3`, mime: "audio/mpeg", durationS: Math.round(probe(to) * 1000) / 1000, source: "bawaan", license: "Buatan sendiri (sintesis), bebas lisensi" });
}
writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ version: 1, items }, null, 2));
console.log(`pustaka SFX bawaan: ${items.length} suara di ${out}`);
