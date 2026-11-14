// Fase 14: uji asap render MP4 motion 2 detik dengan dua SFX dari pustaka (server lokal, sama dengan ekspor).
// Jalankan: node --env-file=.env apps/worker/src/render-sfx-smoke.ts  (butuh `npm run setup:sfx` sekali)
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { STYLES } from "@app/config";
import { normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { buildMotionProps } from "../../../packages/remotion/src/motion-props.ts";
import { renderMotion } from "./render.ts";
import { REPO_ROOT } from "./creative/workdir.ts";

const out = path.join(REPO_ROOT, "out", "sfx-smoke.mp4");
await mkdir(path.dirname(out), { recursive: true });
const style = normalizeStyle({ sfx: { cues: [{ id: "b-whoosh", at: 0.3, volume: 1 }, { id: "b-impact-berat", at: 1.2, volume: 1 }], useCreative: true }, params: { "audio.sfx": 1 } } as never);
const r = await renderMotion({
  materials: [], outFile: out, onProgress: () => {},
  props: (srcFor) => buildMotionProps({ aspect: "16:9", settings: { durationS: 2 }, colors: STYLES.bersih.colors, materials: [], srcFor, sfx: { style, creativeSfx: [], srcFor: (id) => srcFor(`sfx:${id}`) } }),
});
console.log(`OK ${out} (${r.durationInFrames} frame)`);
