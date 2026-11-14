// Membatalkan hasil sebuah prompt. Dipakai tombol "Batalkan" (web) dan perintah "batalkan" (worker).
// Prinsip: pembatalan TIDAK BOLEH menimpa keputusan yang dibuat pengguna SESUDAH prompt itu.
//  - usulan yang sudah disetujui/ditolak pengguna tidak dihapus
//  - gaya hanya dikembalikan bila belum diubah lagi
//  - kata hanya dikembalikan bila belum diubah lagi
import type { SupabaseClient } from "@supabase/supabase-js";

export type UndoSnapshot = {
  suggestionIds?: string[];
  styleBefore?: Record<string, unknown> | null;
  styleAfter?: Record<string, unknown> | null;
  transcriptId?: string | null;
  wordFixes?: Array<{ index: number; before: string; after: string }>;
};

/** JSON dengan urutan kunci tetap, untuk membandingkan dua objek gaya. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function hasChanges(u: UndoSnapshot | null | undefined): boolean {
  return !!u && ((u.suggestionIds?.length ?? 0) > 0 || !!u.styleAfter || (u.wordFixes?.length ?? 0) > 0);
}

export type UndoResult = { ok: boolean; messages: string[]; runId?: string };

/** Batalkan prompt tertentu, atau yang terakhir bila runId kosong. */
export async function undoPromptRun(db: SupabaseClient, projectId: string, runId?: string): Promise<UndoResult> {
  let q = db.from("prompt_runs").select("id,prompt,undo,undone,status").eq("project_id", projectId).eq("status", "done").eq("undone", false);
  q = runId ? q.eq("id", runId) : q.order("created_at", { ascending: false }).limit(20);
  const { data: runs } = await q;
  const run = (runs ?? []).find((r) => hasChanges(r.undo as UndoSnapshot));
  if (!run) return { ok: false, messages: [runId ? "Perintah itu tidak punya perubahan yang bisa dibatalkan (atau sudah dibatalkan)." : "Tidak ada perintah yang bisa dibatalkan."] };

  const u = run.undo as UndoSnapshot;
  const messages: string[] = [];

  // 1. usulan: hanya yang masih pending
  if (u.suggestionIds?.length) {
    const { data: rows } = await db.from("cut_suggestions").select("id,status").in("id", u.suggestionIds);
    const pendingIds = (rows ?? []).filter((r) => r.status === "pending").map((r) => r.id);
    const decided = (rows ?? []).length - pendingIds.length;
    if (pendingIds.length) await db.from("cut_suggestions").delete().in("id", pendingIds);
    messages.push(`${pendingIds.length} usulan potong dihapus${decided ? `; ${decided} usulan sudah Anda putuskan (setuju/tolak), jadi DIBIARKAN` : ""}.`);
  }

  // 2. gaya: hanya bila belum diubah sesudahnya
  if (u.styleAfter) {
    const { data: p } = await db.from("projects").select("style").eq("id", projectId).single();
    if (p && stableStringify(p.style) === stableStringify(u.styleAfter)) {
      await db.from("projects").update({ style: u.styleBefore ?? {} }).eq("id", projectId);
      messages.push("Gaya dikembalikan seperti sebelumnya.");
    } else messages.push("Gaya sudah Anda ubah lagi sesudah perintah itu, jadi DIBIARKAN.");
  }

  // 3. kata: hanya yang belum diubah sesudahnya
  if (u.wordFixes?.length && u.transcriptId) {
    const { data: tr } = await db.from("transcripts").select("words").eq("id", u.transcriptId).maybeSingle();
    if (tr) {
      const words = tr.words as Array<{ text: string }>;
      let reverted = 0;
      for (const f of u.wordFixes) if (words[f.index]?.text === f.after) { words[f.index] = { ...words[f.index], text: f.before }; reverted++; }
      if (reverted) await db.from("transcripts").update({ words }).eq("id", u.transcriptId);
      messages.push(`${reverted} kata di transkrip dikembalikan${reverted < u.wordFixes.length ? `; ${u.wordFixes.length - reverted} sudah Anda ubah lagi, DIBIARKAN` : ""}.`);
    }
  }

  await db.from("prompt_runs").update({ undone: true }).eq("id", run.id);
  return { ok: true, messages, runId: run.id };
}
