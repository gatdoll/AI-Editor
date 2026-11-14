import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

const Body = z
  .object({
    runId: z.string().uuid().optional(),
    promptRunId: z.string().uuid().optional(),
    kind: z.enum(["retake", "correction", "filler", "pause", "custom"]).optional(),
    status: z.enum(["approved", "rejected", "pending"]),
  })
  .refine((b) => b.runId || b.promptRunId || b.kind, "Tentukan cakupan: runId, promptRunId, atau kind");

/** Setujui/tolak semua usulan 'pending' dalam satu cakupan (jenis, analisis, atau satu perintah). Tetap tindakan eksplisit pengguna. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  const { runId, promptRunId, kind, status } = parsed.data;

  const db = createAdminClient();
  // 'pending' = kembalikan semuanya di cakupan itu; selain itu hanya yang masih pending. 'unclear' tidak pernah ikut.
  let q = db.from("cut_suggestions").update({ status }).eq("project_id", id).neq("kind", "unclear");
  if (runId) q = q.eq("run_id", runId);
  if (promptRunId) q = q.eq("prompt_run_id", promptRunId);
  if (kind) q = q.eq("kind", kind);
  if (status !== "pending") q = q.eq("status", "pending");
  const { data, error } = await q.select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ changed: data?.length ?? 0 });
}
