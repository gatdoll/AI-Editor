// Simpan EDL dari SEMUA usulan yang disetujui pengguna di project (gabungan analisis Claude, Codex, dan prompt).
// Dipakai bersama oleh API web (tombol "Simpan EDL") dan worker (prompt "render"), supaya hasilnya identik.
// Usulan pending/rejected dan 'unclear' tidak pernah ikut (aturan 2).
import type { SupabaseClient } from "@supabase/supabase-js";
import { VIDEO } from "@app/config";
import { buildEdl, cutSlack } from "./edl.ts";
import { applyManualEdl } from "./manual.ts";
import { arrangeEdl } from "./reel.ts";
import { loadReel } from "./reel-db.ts";

export type SavedEdl = { id: string; version: number; params: Record<string, unknown>; segments: Array<{ start: number; end: number }> };

/** EDL dari usulan yang disetujui + edit manual, TANPA menyimpan apa pun (dipakai juga oleh Mode Kreatif). */
export async function computeEdlFromApproved(
  db: SupabaseClient,
  projectId: string,
  style: Record<string, unknown>,
): Promise<{ edl?: ReturnType<typeof buildEdl>; approvedCount?: number; duration?: number; error?: string; status?: number }> {
  // Fase 16: semua video project pada satu sumbu waktu (reel); transkrip ada di video utama
  const reel = await loadReel(db, projectId);
  const asset = reel.primary;
  const duration = reel.durationS;
  if (!asset || !(duration > 0)) return { error: "Durasi video belum diketahui", status: 409 };

  const { data: approved, error } = await db
    .from("cut_suggestions")
    .select("start_s,end_s")
    .eq("project_id", projectId)
    .eq("status", "approved")
    .neq("kind", "unclear");
  if (error) return { error: error.message, status: 500 };

  const { data: tr } = await db
    .from("transcripts")
    .select("words")
    .eq("asset_id", asset.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const words = (tr?.words ?? []) as { start: number; end: number }[];

  const edl = arrangeEdl(applyManualEdl(buildEdl(
    duration,
    (approved ?? []).map((a) => {
      const cut = { start: Number(a.start_s), end: Number(a.end_s) };
      return { ...cut, ...cutSlack(words, cut) };
    }),
    VIDEO.cutPaddingSec,
  ), style.manual, duration), reel.clips, style.reelOrder as string[] | undefined, style.reelHidden as string[] | undefined);
  if (edl.segments.length === 0) return { error: "Semua video terpotong. EDL tidak disimpan.", status: 400 };
  return { edl, approvedCount: approved?.length ?? 0, duration };
}

export async function saveEdlFromApproved(
  db: SupabaseClient,
  projectId: string,
  style: Record<string, unknown>,
  runId: string | null,
): Promise<{ edl?: SavedEdl; error?: string; status?: number }> {
  const computed = await computeEdlFromApproved(db, projectId, style);
  if (!computed.edl) return { error: computed.error, status: computed.status };
  const { edl, duration } = computed;

  const { data: last } = await db.from("edl").select("version").eq("project_id", projectId).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;

  const { data, error: insErr } = await db
    .from("edl")
    .insert({
      project_id: projectId,
      run_id: runId,
      version,
      segments: edl.segments,
      params: {
        paddingSec: VIDEO.cutPaddingSec,
        approvedCount: computed.approvedCount ?? 0,
        appliedCuts: edl.appliedCuts,
        skippedTooShort: edl.skippedTooShort,
        removedS: edl.removedS,
        keptS: edl.keptS,
        sourceDurationS: duration,
        style,
      },
    })
    .select("id,version,params,segments")
    .single();
  if (insErr || !data) return { error: insErr?.message ?? "Gagal menyimpan EDL", status: 500 };
  return { edl: data as SavedEdl };
}
