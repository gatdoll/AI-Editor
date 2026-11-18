// Pembatalan render oleh pengguna: tombol Batalkan menandai job 'cancelled' di DB, penjaga ini memeriksanya berkala
// lalu menghentikan renderMedia (Chrome + ffmpeg) lewat cancelSignal Remotion. Tidak ada hasil yang dicatat.
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeCancelSignal } from "@remotion/renderer";
import { VIDEO } from "@app/config";

export const RENDER_CANCELLED = "Render dibatalkan oleh pengguna. Tidak ada file yang disimpan.";

export type RenderCancel = {
  /** Diteruskan ke renderMedia. */
  cancelSignal: ReturnType<typeof makeCancelSignal>["cancelSignal"];
  /** Sudah dibatalkan? Periksa sebelum mencoba ulang atau mencatat hasil. */
  cancelled: () => boolean;
  /** Periksa DB sekarang juga (dipakai tepat sebelum hasil dicatat). */
  check: () => Promise<boolean>;
  stop: () => void;
};

/** `isCancelled` dapat disuntik untuk tes; bawaan = status job di DB. */
export function watchRenderCancel(db: SupabaseClient | null, jobId: string, isCancelled?: () => Promise<boolean>, pollMs: number = VIDEO.renderCancelPollMs): RenderCancel {
  const { cancelSignal, cancel } = makeCancelSignal();
  let done = false;
  const read = isCancelled ?? (async () => {
    const { data } = await db!.from("jobs").select("status").eq("id", jobId).maybeSingle();
    return data?.status === "cancelled";
  });
  const check = async () => {
    if (done) return true;
    try { if (await read()) { done = true; cancel(); } } catch { /* DB sesaat tidak terjangkau: coba lagi di putaran berikutnya */ }
    return done;
  };
  const timer = setInterval(() => void check(), pollMs);
  return { cancelSignal, cancelled: () => done, check, stop: () => clearInterval(timer) };
}
