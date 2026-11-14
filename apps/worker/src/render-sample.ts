import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, "../../../packages/remotion/src/index.ts");
const out = path.resolve(here, "../../../out/sample.mp4");

const serveUrl = await bundle({ entryPoint: entry });
const composition = await selectComposition({ serveUrl, id: "Sample" });
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  outputLocation: out,
  chromiumOptions: { enableMultiProcessOnLinux: true },
});
console.log("Selesai:", out);
