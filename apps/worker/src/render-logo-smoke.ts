// Fase 15: uji asap still komposisi Edited dengan kode kreatif yang menampilkan logo PNG pengguna lewat data.assets.
// Logo uji dibuat sendiri (PNG transparan, lingkaran + garis) agar tidak bergantung pada file pengguna.
// Jalankan: node apps/worker/src/render-logo-smoke.ts <video.mp4>  -> out/logo-smoke.png
import path from "node:path";
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { buildEditedProps, DEFAULT_STYLE } from "../../../packages/remotion/src/build-props.ts";
import { materialAssets } from "../../../packages/remotion/src/motion-props.ts";
import { probe } from "./media.ts";
import { renderEditedStill } from "./render.ts";
import { REPO_ROOT } from "./creative/workdir.ts";

const video = process.argv[2];
if (!video) throw new Error("Pemakaian: node apps/worker/src/render-logo-smoke.ts <video.mp4>");
const out = path.join(REPO_ROOT, "out");
await mkdir(out, { recursive: true });

// PNG RGBA 400x160: lingkaran oranye + balok hijau di latar transparan
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 4 + 1) + 1 + x * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const logoFile = path.join(out, "logo-uji.png");
await writeFile(logoFile, png(400, 160, (x, y) => ((x - 80) ** 2 + (y - 80) ** 2 < 70 ** 2 ? [255, 140, 0, 255] : x > 170 && x < 390 && y > 55 && y < 105 ? [40, 200, 120, 255] : [0, 0, 0, 0])));

const meta = await probe(video);
const durationS = Math.min(4, meta.durationS);
const creativeAssets = materialAssets([{ id: "logo-uji", label: "logo-uji.png", mime: "image/png", width: 400, height: 160, role: "logo" }], () => "", undefined, { imagesOnly: true });
const overlay = `import React from "react";
import { AbsoluteFill, Img } from "remotion";
export default function Overlay({ data }: CreativeProps) {
  const logo = (data.assets ?? []).find((a) => a.role === "logo");
  if (!logo) return null;
  const w = data.width * 0.35;
  return <AbsoluteFill><Img src={logo.src} style={{ position: "absolute", top: data.height * 0.05, right: data.width * 0.05, width: w, height: w * (logo.height ?? 1) / (logo.width ?? 1) }} /></AbsoluteFill>;
}`;
const built = buildEditedProps({
  segments: [{ start: 0, end: durationS }], source: { width: meta.width, height: meta.height, fps: meta.fps, durationS: meta.durationS }, words: [],
  style: DEFAULT_STYLE, seed: 1, creative: { overlay, replacesCaptions: false }, creativeAssets,
});
const file = path.join(out, "logo-smoke.png");
const logs: string[] = [];
await renderEditedStill({ sourceFile: video, outFile: file, props: built.props, frame: 15, scale: 0.5, materials: [{ id: "logo-uji", file: logoFile, type: "image/png" }], onBrowserLog: (t) => logs.push(t) });
console.log(`OK ${file}${logs.some((l) => /kreatif|error/i.test(l)) ? `\n${logs.filter((l) => /kreatif|error/i.test(l)).join("\n")}` : ""}`);
