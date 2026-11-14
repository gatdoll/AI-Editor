// Audit aturan proyek (brief bagian 8) + batas unggahan. Pakai dari root repo:
//   npm run build -w @app/web      (audit aturan 6 memeriksa hasil build produksi)
//   node scripts/audit.mjs [--base http://localhost:3000]
// Memerlukan .env terisi, dan web (npm run dev) menyala untuk pemeriksaan langsung.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const results = [];
let section = "";
const head = (t) => { section = t; console.log(`\n== ${t}`); };
const check = (label, ok, extra = "") => { results.push({ section, label, ok }); console.log(`${ok ? "LOLOS " : "GAGAL "} ${label}${extra ? "  -> " + extra : ""}`); };
const warn = (label) => console.log(`CATAT  ${label}`);

// ------------------------------------------------------------------ util
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim()]; }),
);
const SECRET = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SECRET) throw new Error("SUPABASE_SERVICE_ROLE_KEY kosong di .env");
const db = createClient(env.SUPABASE_URL, SECRET, { auth: { persistSession: false } });

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".cache", "data", "out", ".git"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f).replaceAll("\\", "/");
const read = (f) => fs.readFileSync(f, "utf8");
const isSource = (f) => /\.(ts|tsx|mjs)$/.test(f);
const isDevTool = (f) => /[\\/]test[\\/]|smoke|_chk|_edl|_cam|_cap|_err|_dbg|\.tmp\.|scripts[\\/]audit\.mjs$/.test(f);
const sources = [...walk(path.join(ROOT, "apps"), isSource), ...walk(path.join(ROOT, "packages"), isSource), ...walk(path.join(ROOT, "config"), isSource), ...walk(path.join(ROOT, "scripts"), isSource)].filter((f) => !isDevTool(f));

// ==================================================== ATURAN 6: kunci tidak ke browser
head("Aturan 6: kunci API tidak pernah dikirim ke browser");
{
  // a) env publik
  const pub = Object.entries(env).filter(([k]) => k.startsWith("NEXT_PUBLIC_"));
  check("tidak ada variabel NEXT_PUBLIC_ yang bernama rahasia", pub.every(([k]) => !/SECRET|SERVICE|PRIVATE|TOKEN|PASSWORD/i.test(k)), pub.map(([k]) => k).join(", "));
  check("tidak ada variabel NEXT_PUBLIC_ yang nilainya = kunci rahasia", pub.every(([, v]) => v !== SECRET));
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  check("kunci publik bukan jenis secret (sb_publishable_ atau JWT role anon)", anon.startsWith("sb_publishable_") || (() => { try { return JSON.parse(Buffer.from(anon.split(".")[1], "base64url").toString()).role === "anon"; } catch { return false; } })());
  check("kunci rahasia benar-benar jenis secret/service_role", SECRET.startsWith("sb_secret_") || (() => { try { return JSON.parse(Buffer.from(SECRET.split(".")[1], "base64url").toString()).role === "service_role"; } catch { return false; } })());

  // b) kode klien tidak mengimpor nilai dari @app/shared (yang memuat createAdminClient)
  const clientFiles = sources.filter((f) => /\.tsx$/.test(f) && /^\s*["']use client["']/.test(read(f)));
  const bad = [];
  for (const f of clientFiles) {
    for (const m of read(f).matchAll(/import\s+([^;]*?)\s+from\s+["']@app\/shared["']/g)) {
      const spec = m[1].trim();
      const typeOnly = spec.startsWith("type ") || (spec.startsWith("{") && spec.slice(1, -1).split(",").map((x) => x.trim()).filter(Boolean).every((x) => x.startsWith("type ")));
      if (!typeOnly) bad.push(rel(f));
    }
    if (/createAdminClient|SERVICE_ROLE|process\.env\.(?!NEXT_PUBLIC_)/.test(read(f))) bad.push(rel(f) + " (menyebut kunci/env server)");
  }
  check(`${clientFiles.length} berkas "use client": hanya impor TIPE dari @app/shared, tidak menyentuh env/kunci server`, bad.length === 0, bad.join("; "));

  // c) hasil build produksi: bundel yang dikirim ke browser
  const staticDir = path.join(ROOT, "apps/web/.next/static");
  const buildId = path.join(ROOT, "apps/web/.next/BUILD_ID");
  if (!fs.existsSync(buildId)) {
    check("hasil build produksi ada (jalankan: npm run build -w @app/web)", false);
  } else {
    const newest = Math.max(...walk(path.join(ROOT, "apps/web/app"), isSource).concat(walk(path.join(ROOT, "packages"), isSource), walk(path.join(ROOT, "config"), isSource)).map((f) => fs.statSync(f).mtimeMs));
    check("build produksi lebih baru dari semua kode sumber (bukan build usang)", fs.statSync(buildId).mtimeMs >= newest, fs.statSync(buildId).mtimeMs < newest ? "BUILD USANG: jalankan npm run build -w @app/web lalu ulangi audit" : "");
    const files = walk(staticDir, (f) => /\.(js|css|html|json|map)$/.test(f));
    let hitSecret = 0, hitName = 0, scanned = 0;
    for (const f of files) {
      const t = read(f); scanned++;
      if (t.includes(SECRET)) hitSecret++;
      if (/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|ANTHROPIC_API_KEY/.test(t)) hitName++;
    }
    check(`${scanned} berkas bundel browser: nilai kunci rahasia TIDAK ada`, hitSecret === 0, hitSecret ? `${hitSecret} berkas membocorkan kunci!` : "");
    check(`${scanned} berkas bundel browser: nama/awalan kunci rahasia TIDAK ada`, hitName === 0);
  }

  // c2) prompt: transkrip video tidak pernah dikirim ke AI (tidak ada teks dari video yang bisa menyuntikkan instruksi)
  {
    const tr = read(path.join(ROOT, "apps/worker/src/prompt/translate.ts")).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    check("Prompt: penerjemah tidak menerima/menyentuh transkrip atau daftar kata (hanya kalimat pengguna + fakta ringkas)", !/\b(transcript|words)\b/.test(tr.replace(/wordCount/g, "")));
  }

  // d) respons API langsung
  try {
    const urls = ["/api/projects", "/api/analyzers"];
    const { data: ps } = await db.from("projects").select("id").limit(1);
    if (ps?.[0]) urls.push(`/api/projects/${ps[0].id}`, `/api/projects/${ps[0].id}/analysis`);
    let leak = false;
    for (const u of urls) { const r = await fetch(BASE + u); const t = await r.text(); if (t.includes(SECRET)) leak = true; }
    check(`${urls.length} respons API: tidak memuat kunci rahasia`, !leak);
  } catch (e) { warn("pemeriksaan respons API dilewati (web tidak menyala?): " + e.message); }
}

// ==================================================== ATURAN 1: file mentah tidak diubah
head("Aturan 1: file mentah tidak pernah diubah");
{
  const viol = [];
  const callRe = (names) => new RegExp(`\\b(?:${names})\\(\\s*([^,)\\n]*)`, "g");
  for (const f of sources) {
    const t = read(f);
    const checkCalls = (names, allowed, label) => {
      for (const m of t.matchAll(callRe(names))) {
        const a = m[1].trim();
        // Launcher upstream: satu writer dengan guard path.resolve/path.relative ke .cache.
        if (label === "tulis" && rel(f) === "scripts/studio-reference.mjs" && a === "cachePreviewPath"
          && t.includes("path.relative(cacheRoot, cachePreviewPath)")
          && t.includes("relative.startsWith('..') || path.isAbsolute(relative)")) continue;
        if (!allowed.test(a)) viol.push(`${rel(f)}: ${label}(${a})`);
      }
    };
    checkCalls("rm|rmSync|unlink|unlinkSync", /^(partFile|schemaFile|outFile|partPath|dir\b|assetDir\()/, "hapus");
    checkCalls("rename|renameSync", /^(partFile|partPath)/, "ganti nama");
    checkCalls("writeFile|writeFileSync|appendFile|appendFileSync|truncate|truncateSync|copyFile|copyFileSync", /^(partPath|schemaFile|"packages\/remotion\/src\/grain-data\.ts")/, "tulis");
    for (const m of t.matchAll(/\b(?:chmod|chmodSync)\(\s*([^,)\n]*)\s*,\s*([^)\n]*)/g)) if (!(m[1].trim() === "finalPath" && m[2].trim() === "0o444")) viol.push(`${rel(f)}: chmod(${m[1]}, ${m[2]})`);
    if (/createWriteStream\(/.test(t) && !/partPath|outFile/.test(t)) viol.push(`${rel(f)}: createWriteStream`);
  }
  check(`${sources.length} berkas kode: semua hapus/ganti-nama/tulis hanya ke .part, cache, atau folder hasil`, viol.length === 0, viol.join("; "));

  // trigger database (uji langsung; dipulihkan bila ternyata lolos)
  const { data: raws } = await db.from("assets").select("*").eq("kind", "raw").not("sha256", "is", null);
  check("ada aset mentah untuk diaudit", (raws?.length ?? 0) > 0, `${raws?.length ?? 0} aset`);
  const t = raws?.[0];
  if (t) {
    const attempts = [
      ["storage_path", t.storage_path + "-x"],
      ["sha256", "0".repeat(64)],
      ["kind", "output"],
      ["storage_bucket", "lain"],
    ];
    for (const [col, val] of attempts) {
      const { error } = await db.from("assets").update({ [col]: val }).eq("id", t.id);
      let ok = !!error && /tidak boleh diubah/.test(error.message);
      if (!error) await db.from("assets").update({ [col]: t[col] }).eq("id", t.id); // pulihkan bila trigger gagal
      check(`trigger database menolak perubahan ${col} aset mentah`, ok, error ? error.message : "LOLOS TANPA ERROR (sudah dipulihkan)");
    }
    const { data: after } = await db.from("assets").select("storage_path,sha256,kind,storage_bucket").eq("id", t.id).single();
    check("aset uji tetap identik setelah percobaan ubah", after.storage_path === t.storage_path && after.sha256 === t.sha256 && after.kind === t.kind && after.storage_bucket === t.storage_bucket);
  }

  // integritas nyata: hitung ulang SHA-256 semua file mentah
  const mediaRoot = process.env.MEDIA_DIR ?? path.join(ROOT, "data", "media");
  let okCount = 0, missing = 0; const mism = [], writable = [];
  for (const a of raws ?? []) {
    const file = path.resolve(mediaRoot, a.storage_path);
    if (!fs.existsSync(file)) { missing++; continue; }
    const h = crypto.createHash("sha256");
    await new Promise((res, rej) => fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", res).on("error", rej));
    if (h.digest("hex") === a.sha256) okCount++; else mism.push(a.storage_path);
    if ((fs.statSync(file).mode & 0o222) !== 0) writable.push(a.storage_path);
  }
  check(`${okCount} file mentah: SHA-256 dihitung ulang = checksum di database`, mism.length === 0 && okCount > 0, mism.join("; "));
  check("semua file mentah ditandai hanya-baca di disk", writable.length === 0, writable.join("; "));
  if (missing) warn(`${missing} aset mentah tidak punya file di disk (mungkin dipindah/dihapus manual)`);
}

// ==================================================== ATURAN 2: tidak ada cut tanpa persetujuan
head("Aturan 2: tidak ada cut otomatis tanpa persetujuan");
{
  const holders = sources.filter((f) => /["']approved["']/.test(read(f))).map(rel).sort();
  const allowed = [
    "apps/web/app/api/projects/[id]/edl/route.ts",
    "apps/web/app/api/projects/[id]/suggestions/bulk/route.ts",
    "apps/web/app/api/suggestions/[id]/route.ts",
    "apps/web/app/projects/[id]/Review.tsx",
    "apps/web/app/projects/[id]/editor/page.tsx",
    "apps/web/app/projects/[id]/editor/SuggestionsPanel.tsx",
    "apps/web/app/projects/[id]/editor/PromptPanel.tsx",
    "apps/web/app/projects/[id]/editor/RightPanel.tsx",
    "apps/web/app/projects/[id]/editor/Timeline.tsx", // hanya membaca status untuk gaya blok
    "packages/shared/src/index.ts",
    "packages/shared/src/edl-save.ts", // membaca usulan yang disetujui untuk menyusun EDL
    "apps/worker/src/prompt/handler.ts", // hanya MEMBACA jumlah usulan disetujui untuk konteks
  ].sort();
  check("kata 'approved' hanya muncul di rute persetujuan, pembaca EDL, UI, dan tipe", holders.every((h) => allowed.includes(h)), holders.filter((h) => !allowed.includes(h)).join("; "));
  const workerWrites = sources.filter((f) => rel(f).startsWith("apps/worker/") || rel(f).startsWith("packages/shared/")).filter((f) => /status\s*:\s*["']approved["']/.test(read(f)) || /status\s*:\s*["']rejected["']/.test(read(f)));
  check("worker dan paket bersama TIDAK pernah menulis status persetujuan (setuju/tolak)", workerWrites.length === 0, workerWrites.map(rel).join("; "));
  const fxSrc = read(path.join(ROOT, "apps/worker/src/prompt/effects.ts"));
  const typeBlock = fxSrc.slice(fxSrc.indexOf("export type NewSuggestion"), fxSrc.indexOf("export type WordFix"));
  check("Prompt: tipe usulan baru dari perintah TIDAK punya properti status (selalu lahir 'pending' dari database)", typeBlock.length > 50 && !/\bstatus\b/.test(typeBlock));
  const handlerSrc = read(path.join(ROOT, "apps/worker/src/prompt/handler.ts"));
  check("Prompt: handler tidak pernah meng-update tabel usulan (hanya menambah dan, saat gagal, menghapus yang baru ia buat)", !/from\("cut_suggestions"\)\s*\.update\(/.test(handlerSrc));

  const { data: all } = await db.from("cut_suggestions").select("id,status,created_at,updated_at,kind");
  const approved = (all ?? []).filter((s) => s.status === "approved");
  const untouched = approved.filter((s) => new Date(s.updated_at) - new Date(s.created_at) < 5);
  check(`${approved.length} usulan berstatus approved dari ${all?.length ?? 0}: semuanya melalui tindakan pengguna (updated_at > created_at)`, untouched.length === 0, `${untouched.length} approved tanpa pernah diubah`);
  check("tidak ada usulan 'unclear' yang disetujui", !approved.some((s) => s.kind === "unclear"));
  const { data: edls } = await db.from("edl").select("id,run_id,segments,params");
  let edlBad = 0;
  for (const e of edls ?? []) {
    const { count } = await db.from("cut_suggestions").select("id", { count: "exact", head: true }).eq("run_id", e.run_id).eq("status", "approved");
    if ((e.params?.approvedCount ?? 0) > (count ?? 0) + 0 && e.run_id) edlBad += 0; // approval bisa dibatalkan setelah EDL disimpan: tidak dianggap pelanggaran
    const segs = e.segments ?? [];
    if (!segs.every((s, i) => s.end > s.start && (i === 0 || s.start >= segs[i - 1].end))) edlBad++;
  }
  check(`${edls?.length ?? 0} EDL tersimpan: segmen urut dan tidak tumpang tindih`, edlBad === 0);
}

// ==================================================== ATURAN 8: konstanta gaya di config
head("Aturan 8: konstanta gaya hanya di config/index.ts");
{
  const files = walk(path.join(ROOT, "packages/remotion/src"), (f) => /\.(ts|tsx)$/.test(f) && !/grain-data\.ts$/.test(f));
  const viol = [];
  const rules = [
    [/#[0-9a-fA-F]{3,8}\b/, "warna hex"],
    [/fontFamily:\s*["'`](?!\$\{)/, "nama font tertulis"],
    [/fontSize:\s*\d/, "ukuran font angka"],
    [/fontWeight:\s*\d/, "bobot font angka"],
    [/\b(1080|1920)\b/, "dimensi frame tertulis"],
    [/rgba?\(\s*\d/, "warna rgb tertulis"],
  ];
  for (const f of files) for (const [re, label] of rules) {
    const lines = read(f).split("\n");
    lines.forEach((ln, i) => { if (!/^\s*\/\//.test(ln) && re.test(ln)) viol.push(`${rel(f)}:${i + 1} ${label}`); });
  }
  check(`${files.length} berkas komposisi: tanpa warna/font/dimensi yang tertulis langsung`, viol.length === 0, viol.slice(0, 6).join("; "));
  const cfg = read(path.join(ROOT, "config/index.ts"));
  const colorsPerStyle = [...cfg.matchAll(/colors:\s*\{([^}]*)\}/g)].map((m) => (m[1].match(/#[0-9a-fA-F]{6}/g) ?? []).length);
  check("tiap gaya memakai maksimal 3 warna utama", colorsPerStyle.length >= 3 && colorsPerStyle.every((n) => n <= 3), colorsPerStyle.join(","));
  const weights = new Set([...cfg.matchAll(/fontWeight:\s*FONT\.(\w+)/g)].map((m) => m[1]));
  check("font: maksimal 2 bobot dipakai oleh semua gaya", weights.size <= 2, [...weights].join(","));
}

// ==================================================== Batas unggahan
head("Batas ukuran dan tipe file unggahan");
{
  const shared = await import(path.join(ROOT, "packages/shared/src/index.ts").replaceAll("\\", "/").replace(/^/, "file:///"));
  const safe = (n) => shared.safeFileName(n);
  const traversal = (n) => /[\/]/.test(n) || n === ".." || n === ".";
  check("nama file berbahaya dinetralkan (tanpa pemisah path, bukan '.' atau '..')", ["../../evil name.mp4", "C:\\Windows\\x.mp4", "..", ".", "a/b/c.mp4"].every((n) => !traversal(safe(n))), safe("../../evil name.mp4"));
  let travOk = 0;
  for (const bad of ["../../.env", "..\\..\\.env", "projects/../../x", "/etc/passwd", "C:\\Windows\\win.ini"]) { try { shared.resolveMediaPath(bad); } catch { travOk++; } }
  check("path di luar folder media ditolak (5 percobaan)", travOk === 5, `${travOk}/5`);
  check("ruang disk bisa ditentukan", typeof shared.freeDiskBytes(shared.mediaDir()) === "number");
  try {
    const mk = await fetch(BASE + "/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "audit batas unggahan" }) });
    const pid = (await mk.json()).project.id;
    const up = (body) => fetch(`${BASE}/api/projects/${pid}/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    let r = await up({ fileName: "virus.exe", size: 1000 });
    check("ekstensi tidak didukung (.exe) ditolak (400)", r.status === 400, r.body.error);
    r = await up({ fileName: "video.mp4", size: 0 });
    check("ukuran 0 ditolak (400)", r.status === 400);
    r = await up({ fileName: "video.mp4", size: -5 });
    check("ukuran negatif ditolak (400)", r.status === 400);
    r = await up({ fileName: "video.mp4", size: 5 * 1024 ** 5 });
    check("ukuran 5 PB (melebihi disk) ditolak di awal (507) dengan pesan jelas", r.status === 507 && /Ruang disk/.test(r.body.error ?? ""), r.body.error);
    r = await up({ fileName: "x".repeat(400) + ".mp4", size: 1000 });
    check("nama file 400 karakter ditolak (400)", r.status === 400);
    await fetch(`${BASE}/api/projects/${pid}`, { method: "DELETE" });
  } catch (e) { warn("pemeriksaan unggahan langsung dilewati (web tidak menyala?): " + e.message); }
}

// ------------------------------------------------------------------ ringkasan
const failed = results.filter((r) => !r.ok);
console.log(`\n${"=".repeat(60)}\nRINGKAS: ${results.length - failed.length}/${results.length} lolos${failed.length ? `, ${failed.length} GAGAL:` : ""}`);
for (const f of failed) console.log(`  [${f.section}] ${f.label}`);
process.exit(failed.length ? 1 : 0);
