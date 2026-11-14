import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, resolveMediaPath } from "@app/shared";

type Ctx = { params: Promise<{ id: string; versionId: string; index: string }> };

/** Still pratinjau ke-N dari satu versi. Path diambil dari baris DB dan harus berada di folder kreatif project ini. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, versionId, index } = await params;
  const n = Number(index);
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(versionId).success || !Number.isInteger(n) || n < 0) return NextResponse.json({ error: "Tidak valid" }, { status: 400 });
  const { data } = await createAdminClient().from("creative_versions").select("stills").eq("id", versionId).eq("project_id", id).maybeSingle();
  const rel = (data?.stills as string[] | undefined)?.[n];
  if (!rel || !rel.startsWith(`projects/${id}/creative/${versionId}/`) || !rel.endsWith(".png")) return NextResponse.json({ error: "Still tidak ditemukan" }, { status: 404 });
  try {
    const buf = await readFile(resolveMediaPath(rel));
    // Still sebuah versi tidak pernah berubah: aman di-cache lama
    return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "image/png", "cache-control": "private, max-age=31536000, immutable" } });
  } catch {
    return NextResponse.json({ error: "Berkas still hilang dari disk" }, { status: 404 });
  }
}
