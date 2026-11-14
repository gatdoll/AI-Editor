import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { setRole } from "@app/shared/material-roles";
import { setNote } from "@app/shared/material-notes";
import { OWN_ASSETS } from "@app/config";

type Ctx = { params: Promise<{ id: string; mid: string }> };

/** Hapus satu bahan motion (baris + filenya). Hanya aset 'material' milik project ini; video mentah tidak bisa lewat sini. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, mid } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(mid).success) return NextResponse.json({ error: "Tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const { data: asset } = await db.from("assets").select("storage_path").eq("id", mid).eq("project_id", id).eq("kind", "material").maybeSingle();
  if (!asset) return NextResponse.json({ error: "Bahan tidak ditemukan" }, { status: 404 });
  const { error } = await db.from("assets").delete().eq("id", mid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await fs.promises.rm(resolveMediaPath(asset.storage_path), { force: true });
  await setRole(id, mid, null);
  await setNote(id, mid, "");
  return NextResponse.json({ ok: true });
}

// Peran "design" hanya diberikan saat unggah PDF (POST role=design), bukan lewat PATCH
const Patch = z.object({ role: z.enum(["logo", "gambar"]).optional(), note: z.string().max(OWN_ASSETS.noteMaxChars * 2).optional() })
  .refine((b) => b.role !== undefined || b.note !== undefined);

/** Fase 15: tandai gambar sebagai logo (dipakai apa adanya oleh AI) atau gambar biasa. Fase 21: ubah keterangan gambar. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, mid } = await params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(mid).success) return NextResponse.json({ error: "Tidak valid" }, { status: 400 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Isi peran (logo/gambar) atau keterangan" }, { status: 400 });
  const { data: asset } = await createAdminClient().from("assets").select("mime").eq("id", mid).eq("project_id", id).eq("kind", "material").maybeSingle();
  if (!asset) return NextResponse.json({ error: "Bahan tidak ditemukan" }, { status: 404 });
  if (!String(asset.mime ?? "").startsWith("image/")) return NextResponse.json({ error: "Peran dan keterangan hanya untuk gambar" }, { status: 400 });
  if (parsed.data.role) await setRole(id, mid, parsed.data.role);
  const note = parsed.data.note !== undefined ? await setNote(id, mid, parsed.data.note) : undefined;
  return NextResponse.json({ ...(parsed.data.role ? { role: parsed.data.role } : {}), ...(note !== undefined ? { note } : {}) });
}
