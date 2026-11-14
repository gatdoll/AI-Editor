import { NextResponse } from "next/server";
import { removeUploadedSfx } from "@app/shared/sfx-library";

type Ctx = { params: Promise<{ id: string }> };

/** Hapus SFX unggahan. Suara bawaan tidak bisa dihapus dari sini. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!id.startsWith("u-")) return NextResponse.json({ error: "Suara bawaan tidak bisa dihapus." }, { status: 400 });
  return (await removeUploadedSfx(id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "SFX tidak ditemukan" }, { status: 404 });
}
