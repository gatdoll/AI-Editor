// Fase 16: video mentah project sebagai reel (server: web API dan worker). Satu tempat yang menjawab "video mana saja,
// di posisi reel berapa, dan mana video utama". Transkrip project disimpan di video UTAMA (yang pertama diunggah) dalam
// waktu reel, jadi pembaca transkrip tidak perlu tahu ada beberapa file.
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetRow } from "./index.ts";
import { reelDuration, type ReelClip } from "./reel.ts";

export type Reel = {
  /** Video pertama yang diunggah: pemilik transkrip project. null = belum ada video. */
  primary: AssetRow | null;
  /** Semua video mentah, urut unggah (termasuk yang belum selesai diproses). */
  assets: AssetRow[];
  /** Video yang sudah punya posisi di reel (sudah diingest). */
  clips: ReelClip[];
  durationS: number;
};

/** Nama tampilan dari path penyimpanan `<uuid>-<nama aman>`. */
export const rawLabel = (a: Pick<AssetRow, "storage_path">) => path.basename(a.storage_path).replace(/^[0-9a-f-]{36}-/i, "");

export function reelOf(assets: AssetRow[]): Reel {
  const sorted = [...assets].sort((a, b) => a.created_at.localeCompare(b.created_at));
  // Migrasi Fase 16 belum dijalankan (kolom tidak ada): project satu video tetap jalan dengan offset 0
  const single = sorted.length === 1;
  const clips = sorted
    .filter((a) => Number(a.duration_s) > 0 && (a.reel_offset_s != null || single))
    .map((a) => ({ id: a.id, offset: Number(a.reel_offset_s ?? 0), duration: Number(a.duration_s), label: rawLabel(a) }));
  return { primary: sorted[0] ?? null, assets: sorted, clips, durationS: reelDuration(clips) };
}

export async function loadReel(db: SupabaseClient, projectId: string): Promise<Reel> {
  const { data, error } = await db.from("assets").select("*").eq("project_id", projectId).eq("kind", "raw").order("created_at");
  if (error) throw new Error(`Video project tidak bisa dibaca: ${error.message}`);
  return reelOf((data ?? []) as AssetRow[]);
}
