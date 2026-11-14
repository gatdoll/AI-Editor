import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Minta worker memeriksa apakah video bisa diputar browser, dan membuat salinan pratinjau H.264 bila tidak (Fase 11).
 * Untuk project lama yang diunggah sebelum fitur ini. Tidak membuat job kedua bila sudah ada yang menunggu.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Aset tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const { data: asset } = await db.from("assets").select("id,project_id,kind").eq("id", id).maybeSingle();
  if (!asset || asset.kind !== "raw") return NextResponse.json({ error: "Aset mentah tidak ditemukan" }, { status: 404 });
  // Fase 16: per video (project bisa punya beberapa video)
  const { data: pendingAll } = await db.from("jobs").select("id,payload").eq("project_id", asset.project_id).eq("type", "preview").in("status", ["queued", "running"]);
  const pending = (pendingAll ?? []).find((j) => (j.payload as { assetId?: string })?.assetId === id);
  if (pending) return NextResponse.json({ jobId: pending.id, queued: false });
  const { data, error } = await db.from("jobs").insert({ project_id: asset.project_id, type: "preview", payload: { assetId: id } }).select("id").single();
  if (error) {
    const hint = /jobs_type_check/.test(error.message) ? " Jalankan migrasi 20261029090000_fase11_pratinjau_noise.sql di SQL Editor Supabase." : "";
    return NextResponse.json({ error: `Gagal mengantre salinan pratinjau: ${error.message}.${hint}` }, { status: 500 });
  }
  return NextResponse.json({ jobId: data.id, queued: true });
}
