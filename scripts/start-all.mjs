// Menyalakan web (Next.js) dan worker sekaligus, lalu membuka browser. Pakai: node scripts/start-all.mjs
// Dipanggil oleh "Mulai Aplikasi.bat" supaya tidak perlu mengetik perintah di terminal.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Port web: APP_PORT di env (mis. bila 3000 dipakai aplikasi lain), bawaan 3000
const PORT = Number(process.env.APP_PORT) || 3000;
const isWin = process.platform === "win32";
const openBrowser = (url) => { if (isWin && !process.env.NO_BROWSER) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref(); };
const say = (m) => console.log(m);
const fail = (m) => { console.error(`\nTIDAK BISA MEMULAI: ${m}\n`); process.exit(1); };

// ------------------------------------------------------------ prasyarat
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) fail(`Node.js versi ${process.versions.node} terlalu lama. Pasang Node.js 22 atau lebih baru dari nodejs.org.`);

const envFile = path.join(ROOT, ".env");
if (!fs.existsSync(envFile)) fail("File .env belum ada. Salin .env.example menjadi .env lalu isi kunci Supabase.");
const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }));
const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter((k) => !env[k]);
if (missing.length) fail(`Isi dulu di file .env: ${missing.join(", ")}`);
if (!fs.existsSync(path.join(ROOT, "node_modules"))) fail("Paket belum terpasang. Jalankan sekali: npm install");

// Supabase terjangkau dan tabelnya ada?
try {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/projects?select=id&limit=1`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404 || r.status === 400) fail("Tabel database belum ada. Jalankan file SQL di folder supabase/migrations (urut) lewat SQL Editor Supabase.");
  if (r.status === 401 || r.status === 403) fail("Kunci Supabase ditolak. Pastikan SUPABASE_SERVICE_ROLE_KEY berisi kunci SECRET (sb_secret_...), bukan kunci publishable.");
  say("OK  database Supabase terjangkau");
} catch (e) {
  fail(`Tidak bisa menghubungi Supabase (${e.message}). Periksa koneksi internet dan SUPABASE_URL di .env.`);
}

// Port 3000 sudah dipakai? (kemungkinan aplikasi sudah berjalan)
const portBusy = await new Promise((res) => {
  const s = net.connect(PORT, "127.0.0.1");
  s.once("connect", () => { s.destroy(); res(true); });
  s.once("error", () => res(false));
});
if (portBusy) {
  say(`Port ${PORT} sudah dipakai: aplikasi kemungkinan sudah berjalan. Membuka http://localhost:${PORT}`);
  openBrowser(`http://localhost:${PORT}`);
  process.exit(0);
}

// ------------------------------------------------------------ jalankan
const children = [];
function run(name, args, onLine) {
  const child = spawn("npm", args, { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  children.push(child);
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        if (line.trim()) { out.write(`[${name}] ${line}\n`); onLine?.(line); }
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => { if (!stopping) { console.error(`\n[${name}] berhenti (kode ${code}). Menghentikan semuanya.`); stopAll(code ?? 1); } });
}

let opened = false;
let stopping = false;
function stopAll(code = 0) {
  stopping = true;
  for (const c of children) {
    try {
      if (isWin) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      else c.kill("SIGTERM");
    } catch { /* sudah mati */ }
  }
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

say("\nMenyalakan aplikasi... (tutup jendela ini atau tekan Ctrl+C untuk menghentikan)\n");
run("web", ["run", "dev", "-w", "@app/web", "--", "-p", String(PORT)], (line) => {
  if (!opened && /Ready in/.test(line)) {
    opened = true;
    say(`\n>>> Aplikasi siap di http://localhost:${PORT} <<<\n`);
    openBrowser(`http://localhost:${PORT}`);
  }
});
run("worker", ["run", "worker"]);
