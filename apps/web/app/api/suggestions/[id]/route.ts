import { NextResponse } from "next/server";
import { loadReel } from "@app/shared/reel-db";
import { z } from "zod";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

const Body = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
    start_s: z.number().min(0).optional(),
    end_s: z.number().min(0).optional(),
  })
  .refine((b) => b.status !== undefined || b.start_s !== undefined || b.end_s !== undefined, "Tidak ada yang diubah");

/** Pengguna menyetujui, menolak, atau menggeser batas satu usulan. Satu-satunya jalan usulan jadi 'approved' (aturan 2). */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body tidak valid" }, { status: 400 });

  const db = createAdminClient();
  const { data: cur } = await db.from("cut_suggestions").select("*").eq("id", id).maybeSingle();
  if (!cur) return NextResponse.json({ error: "Usulan tidak ditemukan" }, { status: 404 });
  if (cur.kind === "unclear" && parsed.data.status === "approved") {
    return NextResponse.json({ error: "Bagian 'tidak bisa dinilai' tidak bisa dipotong dari sini. Atur batasnya sendiri bila perlu." }, { status: 400 });
  }

  const start = parsed.data.start_s ?? cur.start_s;
  const end = parsed.data.end_s ?? cur.end_s;
  if (!(end > start)) return NextResponse.json({ error: "Akhir harus setelah awal" }, { status: 400 });

  // Batas tidak boleh keluar dari durasi video (lewat project, karena usulan dari prompt tidak punya analysis_run)
  const reel = await loadReel(db, cur.project_id);
  if (reel.durationS > 0 && end > reel.durationS + 0.001) {
    return NextResponse.json({ error: "Akhir melewati durasi video" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.status) patch.status = parsed.data.status;
  if (parsed.data.start_s !== undefined) patch.start_s = start;
  if (parsed.data.end_s !== undefined) patch.end_s = end;

  const { data, error } = await db.from("cut_suggestions").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suggestion: data });
}
