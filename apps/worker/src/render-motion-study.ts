import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { ASPECTS, type AspectId } from "@app/config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = path.join(root, "out/motion-study");
await fs.mkdir(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: path.join(root, "packages/remotion/src/index.ts") });
for (const aspect of ["16:9", "9:16"] as AspectId[]) {
  const inputProps = { aspect };
  const composition = await selectComposition({ serveUrl, id: "MotionShowcase", inputProps });
  const label = aspect === "16:9" ? "landscape" : "portrait";
  let last = -1;
  await renderMedia({ serveUrl, composition, inputProps, codec: "h264", crf: 20, concurrency: 4, outputLocation: path.join(out, `${label}.mp4`), onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; console.log(label, `${p * 10}%`); } } });
  for (const sec of [1.5, 7.5, 14.6]) await renderStill({ serveUrl, composition, inputProps, frame: Math.round(sec * composition.fps), output: path.join(out, `${label}-${sec}.png`) });
  console.log(`Rendered ${label}: ${ASPECTS[aspect].width}x${ASPECTS[aspect].height}`);
}
