// Membuat tekstur grain PNG 128x128 (RGBA: bintik putih/hitam dengan alpha acak) sebagai data URI.
// Memakai pencampuran biasa (bukan mix-blend-mode), karena blend mode membuat render ~1,5x lebih lambat.
// Pakai: node scripts/make-grain.mjs  (hasil: packages/remotion/src/grain-data.ts)
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const N = 128;
let seed = 123456789;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / Math.sqrt(0.5); }; // ~N(0,1)

const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  const row = y * (N * 4 + 1);
  raw[row] = 0; // filter: none
  for (let x = 0; x < N; x++) {
    const v = gauss() * 60;
    const o = row + 1 + x * 4;
    const c = v >= 0 ? 255 : 0; // bintik terang atau gelap
    raw[o] = raw[o + 1] = raw[o + 2] = c;
    raw[o + 3] = Math.min(255, Math.round(Math.abs(v) * 1.6));
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
writeFileSync("packages/remotion/src/grain-data.ts", `// Dihasilkan oleh scripts/make-grain.mjs. Jangan edit manual.\nexport const GRAIN_PNG = "data:image/png;base64,${png.toString("base64")}";\nexport const GRAIN_SIZE = ${N};\n`);
console.log(`grain-data.ts: ${png.length} byte PNG`);
