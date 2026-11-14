// Fase 19: unduhan gambar + screenshot artikel dengan server lokal (tanpa internet, tanpa database).
// Pemeriksa alamat diganti khusus tes (server lokal memang diblokir anti-SSRF; itu juga dites).
// Chrome tidak ada (belum pernah render Remotion) = bagian screenshot dilewati dengan pesan. Jalankan: node apps/worker/test/fase19-media.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import zlib from "node:zlib";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { FFMPEG } from "../src/media.ts";
import { fetchImage } from "../src/opinion/fetch-image.ts";
import { findChrome, launchBrowser } from "../src/opinion/browser.ts";
import { screenshotArticle } from "../src/opinion/screenshot.ts";

const dir = mkdtempSync(path.join(os.tmpdir(), "fase19-"));
/** PNG merah polos tanpa alat luar (ffmpeg Remotion tidak punya filter lavfi). */
const png = (w: number, h: number) => {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([255, 0, 0]))]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
};
assert.ok(existsSync(FFMPEG) || FFMPEG === "ffmpeg", "ffmpeg tersedia untuk encode ulang");
const big = png(400, 300), small = png(100, 80);
const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(12);
const article = `<!doctype html><html><head><title>Uji</title><meta property="og:site_name" content="Koran Uji"><meta property="article:published_time" content="2026-11-01T08:00:00+07:00"></head>
<body style="margin:0;font:18px sans-serif"><header style="position:sticky;top:0;height:80px;background:#c00">HEADER LENGKET</header>
<div class="cookie-consent" style="position:fixed;bottom:0;left:0;right:0;height:200px;background:#333"><button>Setuju</button></div>
<main style="width:600px;margin:0 auto"><h1>Defisit Anggaran Naik Tajam Bulan Ini</h1><p>${para}</p>
<p>Menurut laporan resmi, defisit anggaran naik  tajam menjadi 2,9 persen dari PDB pada kuartal ketiga.</p><p>${para}</p>
<div class="advert">IKLAN BESAR</div><p>${para}</p></main></body></html>`;
const server = http.createServer((req, res) => {
  const send = (type: string, body: string | Buffer, status = 200) => { res.writeHead(status, { "content-type": type }); res.end(body); };
  if (req.url === "/img.png") return send("image/png", big);
  if (req.url === "/small.png") return send("image/png", small);
  if (req.url === "/go") { res.writeHead(302, { location: "/img.png" }); return res.end(); }
  if (req.url === "/page") return send("text/html", "<html>bukan gambar</html>");
  if (req.url === "/bad.svg") return send("image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
  if (req.url === "/ok.svg") return send("image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`);
  if (req.url === "/artikel") return send("text/html; charset=utf-8", article);
  if (req.url === "/blokir") return send("text/html", "<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>");
  send("text/plain", "404", 404);
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const allow = async (u: string) => new URL(u);

try {
  // ---- unduhan gambar
  const got = await fetchImage(`${base}/go`, path.join(dir, "t1"), path.join(dir, "out1"), undefined, undefined, allow);
  assert.equal(got.mime, "image/png", "PNG tetap PNG (transparansi)");
  assert.deepEqual([got.width, got.height], [400, 300]);
  assert.ok(existsSync(got.file) && got.file.endsWith(".png"));
  assert.ok(!existsSync(path.join(dir, "t1")), "berkas mentah dihapus setelah encode ulang");
  await assert.rejects(fetchImage(`${base}/page`, path.join(dir, "t2"), path.join(dir, "out2"), undefined, undefined, allow), /Bukan file gambar/);
  await assert.rejects(fetchImage(`${base}/small.png`, path.join(dir, "t3"), path.join(dir, "out3"), undefined, undefined, allow), /terlalu kecil/);
  await assert.rejects(fetchImage(`${base}/bad.svg`, path.join(dir, "t4"), path.join(dir, "out4"), undefined, undefined, allow), /SVG ditolak/);
  const svg = await fetchImage(`${base}/ok.svg`, path.join(dir, "t5"), path.join(dir, "out5"), undefined, undefined, allow);
  assert.equal(svg.mime, "image/svg+xml");
  // Pemeriksa bawaan: alamat lokal/internal ditolak
  await assert.rejects(fetchImage("http://127.0.0.1/img.png", path.join(dir, "t6"), path.join(dir, "out6")), /jaringan lokal/);
  await assert.rejects(fetchImage(`${base}/img.png`, path.join(dir, "t7"), path.join(dir, "out7")), /Port tidak didukung/);

  // ---- screenshot artikel
  let chrome = true;
  try { findChrome(); } catch { chrome = false; }
  if (!chrome) console.log("fase19-media: chrome-headless-shell tidak ada, tes screenshot dilewati");
  else {
    const browser = await launchBrowser();
    try {
      const shot = path.join(dir, "kutipan.png");
      const a = await screenshotArticle(browser, { url: `${base}/artikel`, fokus: "kutipan", kutipan: "defisit anggaran naik tajam menjadi 2,9 persen", sorot: true, layout: "landscape" }, shot, allow);
      assert.equal(a.kutipanDitemukan, true, "spasi ganda di halaman tetap cocok");
      assert.equal(a.pageTitle, "Defisit Anggaran Naik Tajam Bulan Ini", "judul dari halaman, bukan dari AI");
      assert.equal(a.publisher, "Koran Uji");
      assert.ok(a.date?.startsWith("2026-11-01"));
      assert.ok(readFileSync(shot).subarray(1, 4).toString() === "PNG");
      assert.ok(a.width < 1280 * 1.5, "dipotong ke kolom artikel, bukan selebar halaman");

      const b = await screenshotArticle(browser, { url: `${base}/artikel`, fokus: "kutipan", kutipan: "kalimat yang tidak ada di artikel", sorot: true, layout: "portrait" }, path.join(dir, "tidak-ada.png"), allow);
      assert.equal(b.kutipanDitemukan, false, "kutipan tidak ada = ditandai, tidak disorot di tempat lain");
      assert.ok(b.catatan.some((c) => /tidak ditemukan/.test(c)));

      const j = await screenshotArticle(browser, { url: `${base}/artikel`, fokus: "judul", sorot: false, layout: "portrait" }, path.join(dir, "judul.png"), allow);
      assert.equal(j.kutipanDitemukan, null);

      await assert.rejects(screenshotArticle(browser, { url: `${base}/blokir`, fokus: "judul", sorot: false, layout: "portrait" }, path.join(dir, "blokir.png"), allow), /verifikasi|hampir tidak berisi teks/);
      await assert.rejects(screenshotArticle(browser, { url: "http://localhost/artikel", fokus: "judul", sorot: false, layout: "portrait" }, path.join(dir, "lokal.png")), /jaringan lokal/, "pemeriksa bawaan menolak alamat lokal");
    } finally {
      await browser.close();
    }
  }
  console.log("fase19-media: semua tes lulus");
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
