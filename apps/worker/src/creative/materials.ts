// Fase 15: gambar/logo bahan project untuk Mode Kreatif video bicara (brief, still, ekspor). File asli hanya dibaca.
// Fase 21: plus isyarat waktu aset sendiri yang dipakai.
import { existsSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMediaPath } from "@app/shared";
import { loadRoles, roleOf } from "@app/shared/material-roles";
import { ownCues } from "@app/shared/own-assets-store";
import { withRigs } from "@app/shared/rig-store";
import type { MaterialInfo } from "../../../../packages/remotion/src/motion-props.ts";
import type { MotionFile } from "../render.ts";

export type ImageMaterials = { materials: MaterialInfo[]; files: Array<MotionFile & { workFile: string }> };

/** Gambar bahan project (yang filenya ada) beserta peran logo/gambar dan nama salinan aman untuk folder kerja AI. */
export async function loadImageMaterials(db: SupabaseClient, projectId: string): Promise<ImageMaterials> {
  const { data: rows } = await db.from("assets").select("*").eq("project_id", projectId).eq("kind", "material").order("created_at");
  const roles = loadRoles(projectId);
  const images = (rows ?? []).filter((r) => String(r.mime ?? "").startsWith("image/") && existsSync(resolveMediaPath(r.storage_path)));
  // Fase 21: aset sendiri yang dipakai membawa isyarat waktu (detik video mentah; build-props memetakannya ke timeline hasil)
  const cues = ownCues(projectId, images);
  return {
    materials: withRigs(projectId, images.map((r) => ({ id: r.id, label: r.label ?? path.basename(r.storage_path), mime: r.mime, width: r.width, height: r.height, role: roleOf(roles, { id: r.id, label: r.label }), ...(cues.has(r.id) ? { cue: cues.get(r.id) } : {}) }))),
    files: images.map((r, i) => ({
      id: r.id as string, file: resolveMediaPath(r.storage_path), type: r.mime as string,
      workFile: `assets/${String(i + 1).padStart(2, "0")}-${String(r.label ?? path.basename(r.storage_path)).replace(/[^\w.-]+/g, "_").slice(0, 60)}`,
    })),
  };
}
