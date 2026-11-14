import { NextResponse } from "next/server";
import { createAdminClient } from "@app/shared";
import { undoPromptRun } from "@app/shared/prompt-undo";

type Ctx = { params: Promise<{ id: string }> };

/** Batalkan satu perintah. Tidak menimpa keputusan yang Anda buat sesudahnya (lihat prompt-undo.ts). */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = createAdminClient();
  const { data: run } = await db.from("prompt_runs").select("project_id").eq("id", id).maybeSingle();
  if (!run) return NextResponse.json({ error: "Perintah tidak ditemukan" }, { status: 404 });
  const r = await undoPromptRun(db, run.project_id, id);
  return NextResponse.json({ ok: r.ok, messages: r.messages }, { status: r.ok ? 200 : 409 });
}
