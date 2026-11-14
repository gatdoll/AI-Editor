// Render MP4 penuh dengan satu versi Mode Kreatif TANPA mengubah DB (tidak mengaktifkan versi, tidak menulis aset).
// Pakai: npm run render-creative -w @app/worker -- <projectId> <versionId>
// Jalur sama dengan handleRender: EDL dari persetujuan -> loadCreativeCode -> buildEditedProps -> renderEdited.
// Memeriksa: durasi/ukuran/audio hasil, error kode kreatif per frame dari log renderer, dan hash file mentah tidak berubah.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createAdminClient, resolveMediaPath, type AssetRow, type Word } from "@app/shared";
import { computeEdlFromApproved } from "@app/shared/edl-save";
import { loadCreativeCode } from "@app/shared/creative-store";
import { buildEditedProps, normalizeStyle, seedFrom } from "../../../packages/remotion/src/build-props.ts";
import { renderEdited } from "./render.ts";
import { probe } from "./media.ts";
import { hashFile } from "./storage.ts";
import { creativeErrorsFromLogs } from "./creative/stills.ts";
import { REPO_ROOT } from "./creative/workdir.ts";

const [projectId, versionId] = process.argv.slice(2);
if (!projectId || !versionId) {
  console.error("Pakai: npm run render-creative -w @app/worker -- <projectId> <versionId>");
  process.exit(1);
}
const db = createAdminClient();
const { data: project } = await db.from("projects").select("style").eq("id", projectId).single();
const { data: assetRow } = await db.from("assets").select("*").eq("project_id", projectId).eq("kind", "raw").limit(1).single();
const raw = assetRow as AssetRow;
const sourceFile = resolveMediaPath(raw.storage_path);
if (!existsSync(sourceFile)) throw new Error("File mentah tidak ada di disk");
const before = (await hashFile(sourceFile)).sha256;

const { data: tr } = await db.from("transcripts").select("words").eq("asset_id", raw.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
const words = ((tr?.words ?? []) as Word[]).map((w) => ({ text: w.text, start: w.start, end: w.end }));
// Gaya project + versi yang diuji (hanya di memori; project di DB tidak diubah)
const style = normalizeStyle({ ...(project?.style ?? {}), creativeId: versionId } as never);
const edl = await computeEdlFromApproved(db, projectId, style as unknown as Record<string, unknown>);
if (!edl.edl) throw new Error(edl.error);
const loaded = await loadCreativeCode(db, projectId, style.creativeId!);
if (!loaded.ok) throw new Error(loaded.error);
const fps = Number(raw.fps);
// Argumen ketiga "polos" = render pembanding tanpa layer kreatif (untuk membedakan masalah kode kreatif dari renderer)
const plain = process.argv[4] === "polos";
const built = buildEditedProps({ segments: edl.edl.segments, source: { width: raw.width!, height: raw.height!, fps, durationS: Number(raw.duration_s) }, words, style, seed: seedFrom(JSON.stringify(edl.edl.segments)), creative: plain ? null : loaded.code });

const outFile = path.join(REPO_ROOT, "out", "creative-render", `${versionId}${plain ? "-polos" : ""}.mp4`);
await mkdir(path.dirname(outFile), { recursive: true });
const logs: string[] = [];
const t0 = Date.now();
let last = 0;
await renderEdited({
  sourceFile, outFile, props: built.props,
  onBrowserLog: (t) => { if (t.includes("[kreatif]")) logs.push(t); },
  onProgress: (f) => { if (f - last >= 0.25) { last = f; console.log(`render ${Math.round(f * 100)}%`); } },
});
const out = await probe(outFile);
const after = (await hashFile(sourceFile)).sha256;
const errors = creativeErrorsFromLogs(logs);
console.log(JSON.stringify({
  file: outFile,
  detik: ((Date.now() - t0) / 1000).toFixed(1),
  ukuran: `${out.width}x${out.height}`, harapan: `${built.props.width}x${built.props.height}`,
  durasi: out.durationS.toFixed(2), harapanDurasi: (built.durationInFrames / fps).toFixed(2),
  audio: out.hasAudio,
  kataKreatif: built.props.creative?.words.length ?? 0,
  errorKreatif: errors,
  fileMentahUtuh: before === after,
}, null, 2));
if (before !== after) process.exitCode = 1;
