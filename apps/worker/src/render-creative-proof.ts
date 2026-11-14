// Fase 9.0: bukti bahwa kode kreatif (string, compile runtime) jalan di renderer sungguhan.
// Pakai: node src/render-creative-proof.ts            -> still + MP4 CreativeProof, ukur waktu dengan/tanpa kode kreatif
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { creativeProofDefaults } from "../../../packages/remotion/src/creative/sample.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = path.join(root, "out/creative-proof");
await fs.mkdir(out, { recursive: true });

const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: path.join(root, "packages/remotion/src/index.ts") });
console.log(`bundle ${((Date.now() - t0) / 1000).toFixed(1)} dtk`);

const errorsSeen: string[] = [];
const variants = {
  kreatif: creativeProofDefaults,
  polos: { ...creativeProofDefaults, overlay: "", video: "" },
  error: { ...creativeProofDefaults, overlay: creativeProofDefaults.overlay.replace("const t = frame / fps;", "const t = frame / fps; if (frame === 150) throw new Error(\"sengaja\");") },
};
for (const [name, inputProps] of Object.entries(variants)) {
  const composition = await selectComposition({ serveUrl, id: "CreativeProof", inputProps });
  if (name !== "polos") for (const frame of [20, 137, 150, 154, 158]) {
    await renderStill({ serveUrl, composition, inputProps, frame, output: path.join(out, `${name}-${frame}.png`), scale: 0.5, onBrowserLog: (l) => { if (l.text.includes("[kreatif]")) errorsSeen.push(l.text); } });
  }
  if (name === "error") continue;
  const t = Date.now();
  await renderMedia({ serveUrl, composition, inputProps, codec: "h264", crf: 23, outputLocation: path.join(out, `${name}.mp4`) });
  console.log(`${name}: ${composition.durationInFrames} frame dirender dalam ${((Date.now() - t) / 1000).toFixed(1)} dtk`);
}
console.log("log error kreatif dari browser render:", errorsSeen.length ? errorsSeen : "(tidak ada)");
console.log("->", out);
