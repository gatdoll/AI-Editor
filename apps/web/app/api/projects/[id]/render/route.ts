import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@app/shared";
import { normalizeStyle } from "@app/remotion/src/build-props.ts";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  edlId: z.string().uuid().optional(),
  // Pilihan gaya untuk render ini (mis. 16:9 atau 9:16). Tanpa ini, memakai gaya yang tersimpan di EDL.
  style: z.record(z.string(), z.unknown()).optional(),
});

/** Antrekan render MP4 dari EDL (bawaan: EDL versi terbaru). Hanya satu render aktif per project. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });

  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("status").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  if (project.status !== "ready") {
    return NextResponse.json({ error: "Project belum siap (sedang diproses atau gagal)" }, { status: 409 });
  }

  let q = db.from("edl").select("id,version,params").eq("project_id", id);
  q = parsed.data.edlId ? q.eq("id", parsed.data.edlId) : q.order("version", { ascending: false }).limit(1);
  const { data: edl } = await q.maybeSingle();
  if (!edl) return NextResponse.json({ error: "Belum ada EDL. Simpan EDL dulu." }, { status: 409 });

  const style = normalizeStyle((parsed.data.style ?? (edl.params as { style?: unknown } | null)?.style) as never);
  const { error } = await db
    .from("jobs")
    .insert({ project_id: id, type: "render", payload: { edlId: edl.id, edlVersion: edl.version, style } });
  if (error) {
    // 23505 = sudah ada render aktif untuk project ini
    if (error.code === "23505") return NextResponse.json({ error: "Render sedang berjalan" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, edlVersion: edl.version }, { status: 201 });
}
