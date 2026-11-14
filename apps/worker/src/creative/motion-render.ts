// Fase 13: render MP4 project motion graphics (tanpa rekaman). Versi kreatif yang dirender dicatat di job.
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMediaPath, type JobRow } from "@app/shared";
import { loadCreativeCode } from "@app/shared/creative-store";
import { loadCreativeSfx } from "@app/shared/sfx-library";
import { normalizeStyle } from "../../../../packages/remotion/src/build-props.ts";
import { renderMotion } from "../render.ts";
import { probe } from "../media.ts";
import { creativeErrorsFromLogs } from "./stills.ts";
import { fontServeFiles, prepareMotion } from "./handler.ts";
import { loadCreativeFonts } from "@app/shared/font-library";

type Ctx = { db: SupabaseClient; setProgress: (fraction: number) => Promise<void> };

export async function handleMotionRender(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  const versionId = job.payload.creativeVersionId;
  if (typeof versionId !== "string") throw new Error("Pilih versi motion yang akan diekspor.");
  const { data: project } = await db.from("projects").select("style,kind").eq("id", job.project_id).single();
  if (project?.kind !== "motion") throw new Error("Bukan project motion graphics");
  const loaded = await loadCreativeCode(db, job.project_id, versionId);
  if (!loaded.ok) throw new Error(`Versi motion tidak bisa diekspor: ${loaded.error}`);
  if (!loaded.code.overlay) throw new Error("Versi ini tidak punya kode animasi.");
  const prep = await prepareMotion(db, job.project_id, normalizeStyle(project.style as never));

  const rel = `projects/${job.project_id}/output/motion-${Date.now()}.mp4`;
  const finalFile = resolveMediaPath(rel);
  const partFile = `${finalFile}.part.mp4`;
  await mkdir(path.dirname(finalFile), { recursive: true });
  const logs: string[] = [];
  let last = 0;
  // Fase 24: font tambahan versi ini (pustaka / unggahan) ikut disajikan
  const fonts = loadCreativeFonts(job.project_id, versionId);
  const r = await renderMotion({
    materials: [...prep.files, ...fontServeFiles(fonts)],
    props: (srcFor) => prep.props(srcFor, loaded.code.overlay, loadCreativeSfx(job.project_id, versionId), loaded.code.replacesCaptions, fonts),
    outFile: partFile,
    onProgress: (f) => { if (f - last >= 0.02) { last = f; void setProgress(0.02 + f * 0.96); } },
    onBrowserLog: (t) => { if (t.includes("[kreatif]") && logs.length < 200) logs.push(t); },
  });
  const out = await probe(partFile);
  const expected = r.durationInFrames / prep.props(() => "").fps;
  if (Math.abs(out.durationS - expected) > 0.25) { await rm(partFile, { force: true }); throw new Error(`Durasi hasil ${out.durationS.toFixed(2)} dtk tidak sesuai (${expected.toFixed(2)} dtk)`); }
  await rename(partFile, finalFile);
  const size = (await stat(finalFile)).size;
  const { data: outAsset, error } = await db.from("assets")
    .insert({ project_id: job.project_id, kind: "output", storage_bucket: "local", storage_path: rel, size_bytes: size, duration_s: out.durationS, width: out.width, height: out.height, fps: out.fps })
    .select("id").single();
  if (error || !outAsset) throw new Error(`Gagal mencatat hasil render: ${error?.message}`);
  await db.from("jobs").update({ payload: { ...job.payload, outputAssetId: outAsset.id, creativeErrors: creativeErrorsFromLogs(logs).slice(0, 20) } }).eq("id", job.id);
}
