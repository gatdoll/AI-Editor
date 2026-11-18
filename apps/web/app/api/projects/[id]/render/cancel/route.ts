import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Batalkan render MP4 yang menunggu atau berjalan (project video dan motion). Worker memeriksa status ini tiap
 * `VIDEO.renderCancelPollMs`, menghentikan Chrome/ffmpeg, membuang file setengah jadi, dan tidak mencatat hasil.
 * Video, EDL, dan hasil ekspor sebelumnya tidak tersentuh.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const { data, error } = await db
    .from("jobs")
    .update({ status: "cancelled", error: "Dibatalkan oleh pengguna", finished_at: new Date().toISOString() })
    .eq("project_id", id)
    .eq("type", "render")
    .in("status", ["queued", "running"])
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Tidak ada render yang sedang berjalan." }, { status: 409 });
  return NextResponse.json({ cancelled: data.length });
}
