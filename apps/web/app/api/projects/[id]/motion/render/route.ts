import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@app/shared";
import { loadCreativeCode } from "@app/shared/creative-store";

type Ctx = { params: Promise<{ id: string }> };

/** Fase 13: render MP4 project motion graphics dari satu versi. Hanya satu render aktif per project. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = z.object({ versionId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Pilih versi yang akan diekspor." }, { status: 400 });
  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project || project.kind !== "motion") return NextResponse.json({ error: "Project motion graphics tidak ditemukan" }, { status: 404 });
  const loaded = await loadCreativeCode(db, id, parsed.data.versionId);
  if (!loaded.ok) return NextResponse.json({ error: `Versi tidak bisa diekspor: ${loaded.error}` }, { status: loaded.httpStatus });
  const { error } = await db.from("jobs").insert({ project_id: id, type: "render", payload: { mode: "motion", creativeVersionId: parsed.data.versionId } });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Render sedang berjalan" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
