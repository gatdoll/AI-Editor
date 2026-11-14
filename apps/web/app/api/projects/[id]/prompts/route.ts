import { NextResponse } from "next/server";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

/** Riwayat perintah (terbaru di bawah), tanpa snapshot pembatalan yang besar. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = createAdminClient();
  const { data, error } = await db
    .from("prompt_runs")
    .select("id,prompt,provider,status,reply,ops,rejected,messages,undone,error,duration_ms,created_at,finished_at,undo")
    .eq("project_id", id)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: jobs } = await db.from("jobs").select("payload,status,progress").eq("project_id", id).eq("type", "prompt").order("created_at", { ascending: false }).limit(100);
  const byRun = new Map((jobs ?? []).map((job) => [job.payload?.promptRunId, job]));
  // hanya beri tahu apakah ada yang bisa dibatalkan dan berapa usulan yang dibuat; snapshot lengkap tetap di server
  const prompts = (data ?? []).map(({ undo, ...r }) => {
    const u = (undo ?? {}) as { suggestionIds?: string[]; styleAfter?: unknown; wordFixes?: unknown[] };
    return {
      ...r,
      reference: byRun.get(r.id)?.payload?.reference ?? null,
      referenceReport: byRun.get(r.id)?.payload?.referenceReport ?? null,
      progress: byRun.get(r.id)?.progress ?? 0,
      canUndo: r.status === "done" && !r.undone && ((u.suggestionIds?.length ?? 0) > 0 || !!u.styleAfter || (u.wordFixes?.length ?? 0) > 0),
      createdSuggestions: u.suggestionIds?.length ?? 0,
    };
  });
  return NextResponse.json({ prompts });
}
