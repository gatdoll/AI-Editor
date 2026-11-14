// Uji render dari EDL tersimpan tanpa antrean.
// Pakai: npm run render-smoke -w @app/worker -- <projectId> [16:9|9:16] [bersih|tebal|lembut] [--full] [--no-camera] [--no-captions] [--no-effects]
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createAdminClient, resolveMediaPath, type AssetRow } from "@app/shared";
import { buildEditedProps, normalizeStyle, seedFrom } from "../../../packages/remotion/src/build-props.ts";
import { cameraStateAt } from "../../../packages/remotion/src/camera-plan.ts";
import { probe } from "./media.ts";
import { renderEdited, renderEditedStill } from "./render.ts";
import { CACHE_DIR, hashFile } from "./storage.ts";

const [projectId, ...rest] = process.argv.slice(2);
if (!projectId) throw new Error("Pemakaian: npm run render-smoke -w @app/worker -- <projectId> [aspek] [gaya] [--full]");
const flags = new Set(rest.filter((r) => r.startsWith("--")));
const pos = rest.filter((r) => !r.startsWith("--"));

const db = createAdminClient();
const { data: edl } = await db.from("edl").select("*").eq("project_id", projectId).order("version", { ascending: false }).limit(1).single();
const { data: rawRow } = await db.from("assets").select("*").eq("project_id", projectId).eq("kind", "raw").single();
const raw = rawRow as AssetRow;
const { data: tr } = await db.from("transcripts").select("words").eq("asset_id", raw.id).order("created_at", { ascending: false }).limit(1).single();
const sourceFile = resolveMediaPath(raw.storage_path);
const saved = flags.has("--saved-style") ? (await db.from("projects").select("style").eq("id", projectId).single()).data?.style : undefined;

const style = normalizeStyle({
  ...saved,
  aspect: (pos[0] as never) ?? saved?.aspect ?? "16:9",
  styleId: (pos[1] as never) ?? saved?.styleId ?? "bersih",
  camera: flags.has("--no-camera") ? false : saved?.camera ?? true,
  captions: flags.has("--no-captions") ? false : saved?.captions ?? true,
  effects: flags.has("--no-effects") ? false : saved?.effects ?? true,
  params: {
    ...saved?.params,
    ...(rest.find((r) => r.startsWith("--energy=")) ? { "kamera.energi": rest.find((r) => r.startsWith("--energy="))!.split("=")[1] } : {}),
    ...(rest.find((r) => r.startsWith("--anim=")) ? { "teks.animasi": rest.find((r) => r.startsWith("--anim="))!.split("=")[1] } : {}),
  },
});
const fps = Number(raw.fps);
const built = buildEditedProps({
  segments: edl.segments,
  source: { width: raw.width!, height: raw.height!, fps, durationS: Number(raw.duration_s) },
  words: (tr!.words as { text: string; start: number; end: number }[]).map((w) => ({ text: w.text, start: w.start, end: w.end })),
  style,
  seed: seedFrom(edl.id),
});
console.log(`EDL v${edl.version}, gaya=${JSON.stringify(style)}`);
console.log(`hasil ${built.props.width}x${built.props.height} @${fps}fps, ${built.durationInFrames} frame (${(built.durationInFrames / fps).toFixed(2)} dtk)`);
console.log(`kamera: ${built.props.camera.length} gerakan, pelanggaran: ${built.cameraErrors.length}`);
for (const m of built.props.camera) console.log(`  ${m.start.toFixed(1)}-${m.end.toFixed(1)}s ${m.preset.padEnd(10)} scale ${m.from.scale.toFixed(3)}->${m.to.scale.toFixed(3)} x ${m.from.x.toFixed(3)}->${m.to.x.toFixed(3)} rot ${m.from.rot.toFixed(2)}->${m.to.rot.toFixed(2)}${m.continuous ? "" : "  (awal bebas)"}`);
console.log(`subtitle: ${built.props.pages.length} halaman`);
for (const p of built.props.pages.slice(0, 6)) console.log(`  ${p.start.toFixed(2)}-${p.end.toFixed(2)}s  ${p.tokens.map((t, i) => (p.lineStarts.includes(i) && i > 0 ? "\\n" : "") + t.text).join("")}`);

const dir = path.join(CACHE_DIR, "render-smoke");
// jangan hapus folder: hasil dari beberapa gaya/rasio dibandingkan berdampingan
await mkdir(dir, { recursive: true });

// frame diam: tengah halaman subtitle pertama, kedua, dan satu frame tanpa subtitle
const picks: number[] = [];
for (const p of built.props.pages.slice(0, 3)) picks.push(Math.round(((p.start + p.end) / 2) * fps));
if (picks.length === 0) picks.push(Math.round(fps));
const tag = `${style.aspect.replace(":", "x")}-${style.styleId}${style.params["teks.animasi"] ? "-" + style.params["teks.animasi"] : ""}${style.params["kamera.energi"] ? "-" + style.params["kamera.energi"] : ""}`;
for (const f of picks) {
  const out = path.join(dir, `${tag}-f${f}.png`);
  await renderEditedStill({ sourceFile, outFile: out, props: built.props, frame: f });
  const cam = cameraStateAt(built.props.camera, f / fps);
  console.log(`still: ${out}  (kamera scale ${cam.scale.toFixed(3)} x ${cam.x.toFixed(3)} rot ${cam.rot.toFixed(2)})`);
}

if (flags.has("--full")) {
  const before = await hashFile(sourceFile);
  const outFile = path.join(dir, `${tag}.mp4`);
  const t0 = Date.now();
  let last = -1;
  await renderEdited({
    sourceFile, outFile, props: built.props,
    onProgress: (f) => { const p = Math.floor(f * 10) * 10; if (p !== last) { last = p; process.stdout.write(`render ${p}% `); } },
  });
  const sec = (Date.now() - t0) / 1000;
  const out = await probe(outFile);
  console.log(`\nrender selesai ${sec.toFixed(1)} dtk (${(built.durationInFrames / sec).toFixed(1)} fps render)`);
  console.log(`hasil: ${out.durationS.toFixed(2)} dtk, ${out.width}x${out.height}, ${out.fps} fps, audio=${out.hasAudio}`);
  console.log(`ukuran sesuai aspek: ${out.width === built.props.width && out.height === built.props.height ? "YA" : "TIDAK"}; durasi sesuai: ${Math.abs(out.durationS - built.durationInFrames / fps) < 0.15 ? "YA" : "TIDAK"}`);
  const after = await hashFile(sourceFile);
  console.log(`file mentah utuh: ${before.sha256 === after.sha256 && after.sha256 === raw.sha256 ? "YA" : "TIDAK !!"}`);
  console.log("file:", outFile);
}
