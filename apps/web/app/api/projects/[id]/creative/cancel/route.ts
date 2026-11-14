import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Batalkan perintah kreatif yang menunggu atau berjalan. Worker memeriksa status ini tiap beberapa detik,
 * menghentikan CLI, dan mencatat versi 'gagal' dengan alasan "Dibatalkan". Tidak ada yang diterapkan.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const { data, error } = await db
    .from("jobs")
    .update({ status: "cancelled", error: "Dibatalkan oleh pengguna", finished_at: new Date().toISOString() })
    .eq("project_id", id)
    .eq("type", "creative")
    .in("status", ["queued", "running"])
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Tidak ada perintah kreatif yang sedang berjalan." }, { status: 409 });
  return NextResponse.json({ cancelled: data.length });
}
