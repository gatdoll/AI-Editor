// Fase 12: bagian video mentah yang DIPERTAHANKAN sekarang (cut yang disetujui + trim/hapus manual di gaya project).
// Dipakai agar transkrip hanya dibuat dari video yang sudah dipotong. Sama dengan EDL yang dirender.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Interval } from "@app/shared/edl";
import { computeEdlFromApproved } from "@app/shared/edl-save";
import { transcriptSegments } from "@app/shared/transcript-segments";

export async function keptSegments(db: SupabaseClient, projectId: string): Promise<{ segments: Interval[] } | { error: string }> {
  const { data: project } = await db.from("projects").select("style").eq("id", projectId).maybeSingle();
  const r = await computeEdlFromApproved(db, projectId, (project?.style ?? {}) as Record<string, unknown>);
  if (!r.edl) return { error: r.error ?? "Potongan video tidak bisa dihitung" };
  const segments = transcriptSegments(r.edl.segments);
  if (!segments.length) return { error: "Tidak ada bagian video yang dipertahankan." };
  return { segments };
}
