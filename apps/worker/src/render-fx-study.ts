// Potret efek editing (transisi, kata kunci, slam, hook, lower third, tilt) pada proyek nyata, tanpa mengubah data.
// Pakai: node --env-file=../../.env src/render-fx-study.ts <projectId>   (web harus jalan untuk melayani file video)
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { createAdminClient, type Word } from "@app/shared";
import { buildEditedProps, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { planEffects } from "./prompt/effects.ts";
import { normalizeOps } from "@app/shared/ops";

const projectId = process.argv[2];
if (!projectId) throw new Error("projectId wajib");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const out = path.join(root, "out/fx-study");
await fs.mkdir(out, { recursive: true });

const db = createAdminClient();
const { data: asset } = await db.from("assets").select("*").eq("project_id", projectId).eq("kind", "raw").limit(1).single();
const { data: tr } = await db.from("transcripts").select("words").eq("asset_id", asset.id).order("created_at", { ascending: false }).limit(1).single();
const words = tr!.words as Word[];
const durationS = Number(asset.duration_s);
const key = words.filter((w) => w.text.replace(/[^\p{L}]/gu, "").length >= 5);
const aksen = key[2]?.text.replace(/[^\p{L}\p{N}]/gu, "") ?? words[3].text;
const slam = key[6]?.text.replace(/[^\p{L}\p{N}]/gu, "") ?? words[8].text;

const { ops, rejected } = normalizeOps([
  { type: "set_style", styleId: "modern", aspect: "9:16" },
  { type: "set_param", paramId: "transisi.jenis", value: "whip" },
  { type: "set_param", paramId: "kamera.guncang", value: "0.5" },
  { type: "set_param", paramId: "kamera.miring", value: "4" },
  { type: "set_param", paramId: "teks.font", value: "montserrat" },
  { type: "set_param", paramId: "teks.kataPerHalaman", value: "3" },
  { type: "set_param", paramId: "warna.aksen", value: "#B6FF00" },
  { type: "highlight_phrase", phrase: aksen, effect: "aksen" },
  { type: "highlight_phrase", phrase: slam, effect: "slam" },
  { type: "add_title", text: "", startS: 0, endS: 3, animation: "hook", position: "tengah" },
  { type: "add_title", text: "Nama Kreator", subtext: "Video Editor", startS: 4, endS: 9, animation: "lower-third", position: "tengah" },
]);
if (rejected.length) throw new Error(JSON.stringify(rejected));
const fx = await planEffects(ops, { words, durationS, style: normalizeStyle(null), existing: [], getSilences: async () => [] });
console.log(fx.messages.join("\n"));
const style = fx.style!;
// Satu cut buatan di tengah agar transisi whip terlihat
const cutAt = Math.min(durationS / 2, 6);
const segments = [{ start: 0, end: cutAt }, { start: cutAt + 0.6, end: durationS }];
const source = { width: asset.width ?? 1920, height: asset.height ?? 1080, fps: Number(asset.fps ?? 30), durationS };
const built = buildEditedProps({ segments, source, words: words.map((w) => ({ text: w.text, start: w.start, end: w.end })), style, seed: 7 });
const props = { ...built.props, src: `http://localhost:3000/api/assets/${asset.id}/file` };

const serveUrl = await bundle({ entryPoint: path.join(root, "packages/remotion/src/index.ts") });
const composition = await selectComposition({ serveUrl, id: "Edited", inputProps: props });
const fps = composition.fps;
const tok = (word: string) => built.props.pages.flatMap((p) => p.tokens).find((t) => t.hl && t.text.toLowerCase().includes(word.toLowerCase()));
const shots: Array<[string, number]> = [
  ["hook-awal", 0.25], ["hook-menyatu", 1.6],
  ["lower-third", 5],
  ["whip-sebelum", cutAt - 1 / fps * 2], ["whip-sesudah", cutAt + 1 / fps * 2],
  ["aksen", (tok(aksen)?.startMs ?? 0) / 1000 + 0.3],
  ["slam-masuk", (tok(slam)?.startMs ?? 0) / 1000 + 2 / fps], ["slam-mendarat", (tok(slam)?.startMs ?? 0) / 1000 + 0.4],
  ...built.props.fx!.tilts.slice(0, 1).map((t) => ["tilt", t.t + 0.3] as [string, number]),
];
for (const [name, sec] of shots) {
  const frame = Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(sec * fps)));
  await renderStill({ serveUrl, composition, inputProps: props, frame, output: path.join(out, `${name}.png`), scale: 0.4 });
  console.log(name, frame);
}
console.log("kata aksen:", aksen, "slam:", slam, "->", out);
