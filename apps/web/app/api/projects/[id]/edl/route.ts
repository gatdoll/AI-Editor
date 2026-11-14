import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@app/shared";
import { saveEdlFromApproved } from "@app/shared/edl-save";
import { normalizeStyle } from "@app/remotion/src/build-props.ts";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  // Boleh dikosongkan: EDL dibangun dari SEMUA usulan yang disetujui di project.
  runId: z.string().uuid().optional(),
  // Pilihan gaya (aspek, preset, kamera, subtitle, efek, permintaan kamera). Disimpan di EDL agar render bisa direproduksi.
  style: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Simpan EDL dari usulan yang SUDAH DISETUJUI pengguna (gabungan semua analisis dan prompt).
 * Usulan pending/rejected dan 'unclear' tidak pernah ikut (aturan 2). Setiap simpan = versi baru.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });

  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("style").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });

  const style = normalizeStyle((parsed.data.style ?? project.style) as never);
  const r = await saveEdlFromApproved(db, id, style as unknown as Record<string, unknown>, parsed.data.runId ?? null);
  if (!r.edl) return NextResponse.json({ error: r.error }, { status: r.status ?? 500 });
  return NextResponse.json({ edl: r.edl }, { status: 201 });
}
