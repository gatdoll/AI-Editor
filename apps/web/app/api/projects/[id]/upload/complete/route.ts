import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, resolveMediaPath } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ assetId: z.string().uuid() });

/** Selesaikan unggahan: ganti nama .part, kunci hanya-baca (aturan 1), antrekan job ingest. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });

  const db = createAdminClient();
  const { data: asset } = await db
    .from("assets")
    .select("*")
    .eq("id", parsed.data.assetId)
    .eq("project_id", id)
    .eq("kind", "raw")
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "Aset tidak ditemukan" }, { status: 404 });

  const finalPath = resolveMediaPath(asset.storage_path);
  const partPath = finalPath + ".part";

  if (fs.existsSync(partPath)) {
    const size = fs.statSync(partPath).size;
    if (size !== asset.size_bytes) {
      return NextResponse.json(
        { error: `Unggahan belum lengkap (${size} dari ${asset.size_bytes} byte)`, received: size },
        { status: 409 },
      );
    }
    fs.renameSync(partPath, finalPath);
    fs.chmodSync(finalPath, 0o444);
  } else if (!fs.existsSync(finalPath)) {
    return NextResponse.json({ error: "File tidak ditemukan di disk" }, { status: 409 });
  }

  // Cegah job ganda untuk video yang SAMA (Fase 16: tiap video punya ingest sendiri)
  const { data: active } = await db
    .from("jobs")
    .select("id,payload")
    .eq("project_id", id)
    .eq("type", "ingest")
    .in("status", ["queued", "running"]);
  if (!(active ?? []).some((j) => (j.payload as { assetId?: string })?.assetId === asset.id)) {
    const { error } = await db.from("jobs").insert({ project_id: id, type: "ingest", payload: { assetId: asset.id } });
    // 23505 = job ingest aktif sudah ada (permintaan ganda, atau indeks lama satu-per-project: worker memproses semua
    // video yang belum diingest dalam job yang sedang berjalan)
    if (error && error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data: others } = await db.from("assets").select("duration_s").eq("project_id", id).eq("kind", "raw").neq("id", asset.id);
  // Video tambahan untuk project yang sudah siap: status project tidak diubah
  if (!(others ?? []).some((a) => Number(a.duration_s) > 0)) await db.from("projects").update({ status: "ingesting", error: null }).eq("id", id);
  return NextResponse.json({ ok: true });
}
