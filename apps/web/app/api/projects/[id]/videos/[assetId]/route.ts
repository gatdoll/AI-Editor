import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { previewPath } from "@app/shared/derived-media";
import { loadReel } from "@app/shared/reel-db";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

const valid = (id: string, assetId: string) => z.string().uuid().safeParse(id).success && z.string().uuid().safeParse(assetId).success;

/**
 * Fase 16: hapus satu video dari project (panel Media), atas pilihan eksplisit pengguna. Baris aset + file mentah + salinan
 * pratinjau dihapus. Video utama (pemilik transkrip project) tidak bisa dihapus: sembunyikan dari timeline saja.
 * Posisi reel video lain tidak berubah, jadi cut/subtitle/judul di video lain tetap pas.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, assetId } = await params;
  if (!valid(id, assetId)) return NextResponse.json({ error: "Tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const reel = await loadReel(db, id);
  const asset = reel.assets.find((a) => a.id === assetId);
  if (!asset) return NextResponse.json({ error: "Video tidak ditemukan di project ini" }, { status: 404 });
  if (reel.primary?.id === assetId) return NextResponse.json({ error: "Video pertama menyimpan transkrip project dan tidak bisa dihapus. Sembunyikan dari timeline saja." }, { status: 409 });
  const { data: active } = await db.from("jobs").select("type,payload").eq("project_id", id).in("status", ["queued", "running"]);
  if ((active ?? []).length) return NextResponse.json({ error: `Masih ada proses berjalan (${active![0].type}). Tunggu selesai dulu.` }, { status: 409 });
  const { error } = await db.from("assets").delete().eq("id", assetId).eq("project_id", id).eq("kind", "raw");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  for (const rel of [asset.storage_path, `${asset.storage_path}.part`, previewPath(id, assetId)]) {
    const file = resolveMediaPath(rel);
    if (fs.existsSync(file)) { await fs.promises.chmod(file, 0o644).catch(() => {}); await fs.promises.rm(file, { force: true }); }
  }
  return NextResponse.json({ ok: true });
}

/** Proses ulang (ingest) satu video yang gagal atau belum diproses. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id, assetId } = await params;
  if (!valid(id, assetId)) return NextResponse.json({ error: "Tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const reel = await loadReel(db, id);
  const asset = reel.assets.find((a) => a.id === assetId);
  if (!asset) return NextResponse.json({ error: "Video tidak ditemukan di project ini" }, { status: 404 });
  if (!fs.existsSync(resolveMediaPath(asset.storage_path))) return NextResponse.json({ error: "Unggahan video ini belum selesai. Unggah file yang sama lagi untuk melanjutkan." }, { status: 409 });
  const { error } = await db.from("jobs").insert({ project_id: id, type: "ingest", payload: { assetId } });
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Video ini sedang diproses." : error.message }, { status: error.code === "23505" ? 409 : 500 });
  return NextResponse.json({ ok: true });
}
