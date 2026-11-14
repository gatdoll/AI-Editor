// Render beberapa frame (PNG) sebuah project pada rasio tertentu TANPA mengubah DB, untuk memeriksa tata letak rasio baru.
// Pakai: node --env-file=../../.env src/render-aspect-still.ts <projectId atau awalannya> <rasio, mis. 4:5> [detik,...] [polos]
// Jalur sama dengan render: EDL dari persetujuan -> buildEditedProps -> renderEditedStill. Versi kreatif aktif ikut.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ASPECTS, type AspectId } from "@app/config";
import { createAdminClient, resolveMediaPath, type AssetRow, type Word } from "@app/shared";
import { computeEdlFromApproved } from "@app/shared/edl-save";
import { loadCreativeCode } from "@app/shared/creative-store";
import { buildEditedProps, normalizeStyle, seedFrom } from "../../../packages/remotion/src/build-props.ts";
import { renderEditedStill } from "./render.ts";
import { REPO_ROOT } from "./creative/workdir.ts";

const [idArg, aspectArg, timesArg] = process.argv.slice(2);
if (!idArg || !aspectArg || !(aspectArg in ASPECTS)) {
  console.error(`Pakai: render-aspect-still.ts <projectId> <${Object.keys(ASPECTS).join("|")}> [detik,...]`);
  process.exit(1);
}
const db = createAdminClient();
const { data: projects } = await db.from("projects").select("id,name,style");
const project = (projects ?? []).find((p) => p.id.startsWith(idArg));
if (!project) throw new Error(`Project ${idArg} tidak ditemukan`);
const { data: assetRow } = await db.from("assets").select("*").eq("project_id", project.id).eq("kind", "raw").limit(1).single();
const raw = assetRow as AssetRow;
const sourceFile = resolveMediaPath(raw.storage_path);
if (!existsSync(sourceFile)) throw new Error("File mentah tidak ada di disk");
const { data: tr } = await db.from("transcripts").select("words").eq("asset_id", raw.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
const words = ((tr?.words ?? []) as Word[]).map((w) => ({ text: w.text, start: w.start, end: w.end }));

// Rasio hanya diganti di memori; gaya project di DB tidak diubah
const style = normalizeStyle({ ...(project.style ?? {}), aspect: aspectArg as AspectId } as never);
const edl = await computeEdlFromApproved(db, project.id, style as unknown as Record<string, unknown>);
if (!edl.edl) throw new Error(edl.error);
// Argumen keempat "polos" = tanpa lapisan kreatif (memeriksa subtitle/judul bawaan)
const loaded = style.creativeId && process.argv[5] !== "polos" ? await loadCreativeCode(db, project.id, style.creativeId) : null;
const fps = Number(raw.fps);
const built = buildEditedProps({ segments: edl.edl.segments, source: { width: raw.width!, height: raw.height!, fps, durationS: Number(raw.duration_s) }, words, style, seed: seedFrom(JSON.stringify(edl.edl.segments)), creative: loaded?.ok ? loaded.code : null });

const total = built.durationInFrames / fps;
const times = timesArg ? timesArg.split(",").map(Number) : [0.25, 0.5, 0.75].map((f) => f * total);
const dir = path.join(REPO_ROOT, "out", "aspect-still", aspectArg.replace(":", "x"));
await mkdir(dir, { recursive: true });
for (const t of times) {
  const outFile = path.join(dir, `${project.id.slice(0, 8)}-${t.toFixed(1)}s.png`);
  await renderEditedStill({ sourceFile, outFile, props: built.props, frame: Math.min(built.durationInFrames - 1, Math.round(t * fps)), scale: 0.5 });
  console.log(outFile);
}
console.log(`${project.name}: ${built.props.width}x${built.props.height}, ${built.props.pages.length} halaman subtitle, kreatif ${loaded?.ok ? "ya" : "tidak"}`);
