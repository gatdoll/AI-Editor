// Fase 13: motion graphics berdiri sendiri. Pengaturan, data/angka, props komposisi Motion, kontrak, dan scope bahan.
import assert from "node:assert/strict";
import { MOTION_GFX } from "../../../config/index.ts";
import { buildMotionProps, motionCreativeData, normalizeMotion, parseTable, type MaterialInfo } from "../../../packages/remotion/src/motion-props.ts";
import { normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { checkScope, REMOTION_API } from "../../../packages/remotion/src/creative/compile.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";

// ---- pengaturan
assert.deepEqual(normalizeMotion({ durationS: 999 }), { durationS: MOTION_GFX.durationS.max }, "durasi dijepit");
assert.deepEqual(normalizeMotion({ durationS: "x" }), { durationS: MOTION_GFX.durationS.default });
assert.equal(normalizeMotion(null), undefined);
assert.equal(normalizeMotion({ durationS: 8, musicId: "bukan-uuid" })!.musicId, undefined);
assert.equal("motion" in normalizeStyle({}), false, "project video lama tidak berubah");
assert.equal(normalizeStyle({ motion: { durationS: 6 } } as never).motion!.durationS, 6);

// ---- data/angka: CSV kecil dengan koma, titik koma, atau tab; angka dikenali, persen dibuang tandanya
assert.deepEqual(parseTable("Bulan,Penjualan\nJan,120\nFeb,180"), { columns: ["Bulan", "Penjualan"], rows: [["Jan", 120], ["Feb", 180]] });
assert.deepEqual(parseTable("Kanal;Persen\nIG;45%\nTikTok;55%"), { columns: ["Kanal", "Persen"], rows: [["IG", 45], ["TikTok", 55]] });
assert.equal(parseTable("   "), undefined);

// ---- props komposisi Motion
const logo = "11111111-1111-4111-8111-111111111111", music = "22222222-2222-4222-8222-222222222222";
const materials: MaterialInfo[] = [
  { id: logo, label: "logo.png", mime: "image/png", width: 800, height: 400 },
  { id: music, label: "lagu.mp3", mime: "audio/mpeg", duration_s: 12.5 },
  { id: "33333333-3333-4333-8333-333333333333", label: "catatan.pdf", mime: "application/pdf" },
];
const colors = { text: "#fff", accent: "#0f0", dark: "#000" };
const base = { aspect: "9:16" as const, colors, materials, srcFor: (id: string) => `/api/assets/${id}/file` };
const p = buildMotionProps({ ...base, settings: { durationS: 5, table: "A,B\nx,1" } });
assert.deepEqual([p.width, p.height, p.durationInFrames], [1080, 1920, 150]);
assert.equal(p.assets.length, 2, "hanya gambar dan audio yang jadi bahan");
assert.deepEqual(p.assets[0], { id: logo, name: "logo.png", type: "image", src: `/api/assets/${logo}/file`, width: 800, height: 400 });
assert.equal(p.music, undefined, "musik hanya bila dipilih");
assert.deepEqual(p.table, { columns: ["A", "B"], rows: [["x", 1]] });
const withMusic = buildMotionProps({ ...base, settings: { durationS: 5, musicId: music, fitMusic: true } });
assert.equal(withMusic.durationInFrames, Math.round(12.5 * 30), "durasi mengikuti musik");
assert.equal(withMusic.music!.src, `/api/assets/${music}/file`);
assert.equal(buildMotionProps({ ...base, settings: { durationS: 5, musicId: music } }).durationInFrames, 150, "tanpa ikuti musik: durasi tetap");
const data = motionCreativeData(buildMotionProps({ ...base, settings: { durationS: 5 }, fileFor: (m) => `assets/${m.label}` }));
assert.equal(data.mode, "motion");
assert.deepEqual([data.words, data.joins], [[], []]);
assert.equal(data.assets![0].file, "assets/logo.png", "AI bisa melihat salinan bahan");

// ---- scope: gambar dari bahan boleh (Img), URL internet ditolak, namespace SVG tetap boleh
assert.ok((REMOTION_API as readonly string[]).includes("Img"));
const ok = `import { Img } from "remotion"; export default function O({ data }) { return <svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>; }`;
assert.deepEqual(checkScope(ok), [], "namespace SVG bukan unduhan");
assert.ok(checkScope(`export default () => <img src="https://contoh.com/a.png" />`).some((i) => /URL internet/.test(i.rule)));
assert.ok(checkScope(`export default () => <div style={{ backgroundImage: "url(//cdn.contoh.com/x.png)" }} />`).some((i) => /URL internet/.test(i.rule)));

// ---- kontrak: bagian motion hanya untuk project motion
assert.match(buildContract({ motion: true }), /Motion graphics \(data\.mode = "motion"\)/);
assert.doesNotMatch(buildContract(), /Motion graphics \(data\.mode/);

// ---- knowledge dari link: tolak jaringan lokal/internal (SSRF), HTML jadi teks bacaan
const { privateIp, checkUrl, htmlToText } = await import("../../web/lib/fetch-knowledge.ts");
for (const ip of ["127.0.0.1", "10.2.3.4", "192.168.1.5", "172.20.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:192.168.0.1"]) assert.equal(privateIp(ip), true, ip);
for (const ip of ["8.8.8.8", "104.16.1.1", "2606:4700::1111"]) assert.equal(privateIp(ip), false, ip);
for (const bad of ["http://localhost/x", "http://127.0.0.1:3000/api", "file:///C:/x", "http://user:pass@contoh.com/", "http://10.0.0.1/", "http://contoh.com:8080/"]) await assert.rejects(checkUrl(bad), undefined, bad);
const page = htmlToText(`<html><head><title>Produk &amp; Harga</title><style>.x{}</style></head><body><nav>menu</nav><h1>Paket Pro</h1><p>Harga Rp 99.000 per bulan.</p><script>alert(1)</script><ul><li>Fitur A</li><li>Fitur B</li></ul></body></html>`);
assert.equal(page.title, "Produk & Harga");
assert.match(page.text, /## Paket Pro/); assert.match(page.text, /Rp 99\.000/); assert.match(page.text, /- Fitur A/);
assert.doesNotMatch(page.text, /alert|menu|\.x\{/, "skrip, gaya, dan navigasi dibuang");
assert.match(buildContract({ motion: true }), /knowledge\.md/);

// ---- gelombang audio timeline: puncak per jendela, skala akar (suara pelan tetap terlihat), hening = 0
const { peaksFromPcm } = await import("../../web/lib/waveform.ts");
const pcm = Buffer.alloc(2 * 480);
pcm.writeInt16LE(32767, 2 * 10); pcm.writeInt16LE(-8192, 2 * 200); // jendela 1: penuh, jendela 2: 1/4, jendela 3: hening
assert.deepEqual([...peaksFromPcm(pcm, 160)], [255, 128, 0]);

console.log("fase13.test: pengaturan motion, CSV ke tabel, props Motion (bahan, musik, durasi ikut musik), data untuk AI, Img + tolak URL internet, kontrak motion, knowledge link (SSRF ditolak, HTML jadi teks), gelombang audio passed");
