import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string; versionId: string }> };

/** Kode versi apa pun (termasuk 'gagal') untuk dibaca pengguna. Hanya tampilan; tidak pernah dijalankan dari sini. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, versionId } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(versionId).success) return NextResponse.json({ error: "Versi tidak valid" }, { status: 400 });
  const { data } = await createAdminClient().from("creative_versions").select("code_overlay,code_video").eq("id", versionId).eq("project_id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Versi tidak ditemukan" }, { status: 404 });
  return NextResponse.json({ overlay: data.code_overlay, video: data.code_video });
}
