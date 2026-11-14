// Memuat kode versi Mode Kreatif untuk pratinjau (web) dan render (worker), lewat SATU fungsi yang sama.
// Versi yang hilang, milik project lain, gagal, atau tanpa kode TIDAK diam-diam dilewati: pemanggil menerima
// error dan menampilkannya / menggagalkan render (aturan 7).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { SfxCue } from "./sfx.ts";

export type CreativeCodeRow = { overlay?: string; video?: string; replacesCaptions: boolean; /** Fase 14: isyarat SFX versi (file sfx.json; diisi pemanggil Node lewat loadCreativeSfx). */ sfx?: SfxCue[];
  /** Fase 24: font tambahan versi (fonts.json; diisi pemanggil lewat loadCreativeFonts; `src` diisi web/server lokal). */ fonts?: Array<{ id: string; family: string; weight: number; src: string }> };

export type LoadedCreative =
  | { ok: true; id: string; status: string; code: CreativeCodeRow }
  | { ok: false; error: string; httpStatus: number };

/**
 * Selaraskan status 'aktif' dengan style.creativeId (satu-satunya sumber kebenaran versi aktif).
 * Yang lain diturunkan ke 'draft' DULU (indeks unik: satu aktif per project), baru versi baru dinaikkan.
 */
export async function syncActiveCreative(db: SupabaseClient, projectId: string, creativeId: string | undefined): Promise<string | null> {
  let demote = db.from("creative_versions").update({ status: "draft" }).eq("project_id", projectId).eq("status", "aktif");
  if (creativeId) demote = demote.neq("id", creativeId);
  const { error: e1 } = await demote;
  if (e1) return e1.message;
  if (!creativeId) return null;
  const { error: e2 } = await db.from("creative_versions").update({ status: "aktif" }).eq("id", creativeId).eq("project_id", projectId).eq("status", "draft");
  return e2?.message ?? null;
}

export async function loadCreativeCode(db: SupabaseClient, projectId: string, versionId: string): Promise<LoadedCreative> {
  const { data, error } = await db
    .from("creative_versions")
    .select("id,project_id,status,code_overlay,code_video,replaces_captions")
    .eq("id", versionId)
    .maybeSingle();
  if (error) return { ok: false, error: `Versi kreatif tidak bisa dibaca: ${error.message}`, httpStatus: 500 };
  if (!data || data.project_id !== projectId) return { ok: false, error: "Versi kreatif tidak ditemukan di project ini.", httpStatus: 404 };
  if (data.status === "gagal") return { ok: false, error: "Versi kreatif ini gagal divalidasi dan tidak bisa dipakai.", httpStatus: 409 };
  if (!data.code_overlay && !data.code_video) return { ok: false, error: "Versi kreatif ini tidak punya kode.", httpStatus: 409 };
  return {
    ok: true,
    id: data.id as string,
    status: data.status as string,
    code: { overlay: (data.code_overlay as string | null) ?? undefined, video: (data.code_video as string | null) ?? undefined, replacesCaptions: data.replaces_captions === true },
  };
}

/** Folder screenshot masalah milik satu job kreatif (relatif ke folder media). Sekali pakai: dihapus worker setelah job selesai. */
export const creativeScreenshotDir = (projectId: string, jobId: string) => `projects/${projectId}/creative-screenshots/${jobId}`;
