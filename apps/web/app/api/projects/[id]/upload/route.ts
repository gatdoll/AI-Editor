import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { LIMITS, VIDEO } from "@app/config";
import { LOCAL_STORE, createAdminClient, freeDiskBytes, mediaDir, resolveMediaPath, safeFileName } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

const CHUNK_SIZE = 8 * 1024 * 1024;
const ALLOWED_EXT = [".mp4", ".mov", ".mkv", ".webm", ".m4v"];

const InitBody = z.object({
  fileName: z.string().min(1).max(300),
  size: z.number().int().positive(),
});

/**
 * Mulai (atau lanjutkan) unggahan. File ditulis ke disk lokal sebagai <nama>.part,
 * lalu diganti nama saat selesai. Tidak ada batas ukuran selain ruang disk.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = InitBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  const { fileName, size } = parsed.data;

  const lower = fileName.toLowerCase();
  if (!ALLOWED_EXT.some((e) => lower.endsWith(e))) {
    return NextResponse.json({ error: `Format tidak didukung. Pakai: ${ALLOWED_EXT.join(", ")}` }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });

  const safe = safeFileName(fileName);
  // Fase 16: satu project boleh punya banyak video. Unggahan yang terputus dilanjutkan bila file yang sama (nama + ukuran).
  const { data: raws } = await db.from("assets").select("*").eq("project_id", id).eq("kind", "raw");
  const resumable = (raws ?? []).find((a) => a.size_bytes === size && a.storage_path.endsWith(`-${safe}`) && fs.existsSync(resolveMediaPath(a.storage_path) + ".part"));
  if (resumable) {
    return NextResponse.json({ assetId: resumable.id, chunkSize: CHUNK_SIZE, received: fs.statSync(resolveMediaPath(resumable.storage_path) + ".part").size });
  }
  if ((raws?.length ?? 0) >= VIDEO.maxVideos) return NextResponse.json({ error: `Maksimal ${VIDEO.maxVideos} video per project.` }, { status: 409 });
  // Menambah video ke project yang sudah siap tidak mengubah status project (editor tetap bisa dipakai)
  const firstVideo = !(raws ?? []).some((a) => Number(a.duration_s) > 0);

  // Tolak di awal bila disk tidak muat, daripada gagal di tengah unggahan
  const free = freeDiskBytes(mediaDir());
  if (free !== null && size + LIMITS.diskReserveBytes > free) {
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1) + " GB";
    return NextResponse.json(
      { error: `Ruang disk tidak cukup: video ${gb(size)}, tersedia ${gb(free)} (disisakan ${gb(LIMITS.diskReserveBytes)} untuk hasil render).` },
      { status: 507 },
    );
  }

  const assetId = crypto.randomUUID();
  const rel = `projects/${id}/raw/${assetId}-${safe}`;
  const partPath = resolveMediaPath(rel) + ".part";
  fs.mkdirSync(path.dirname(partPath), { recursive: true });
  fs.writeFileSync(partPath, "", { flag: "wx" });

  const { error: insErr } = await db.from("assets").insert({
    id: assetId,
    project_id: id,
    kind: "raw",
    storage_bucket: LOCAL_STORE,
    storage_path: rel,
    size_bytes: size,
  });
  if (insErr) {
    fs.rmSync(partPath, { force: true });
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  if (firstVideo) await db.from("projects").update({ status: "uploading", error: null }).eq("id", id);
  return NextResponse.json({ assetId, chunkSize: CHUNK_SIZE, received: 0 });
}

/** Terima satu potongan. Offset harus sama dengan ukuran file sementara saat ini. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  const assetId = url.searchParams.get("assetId") ?? "";
  const offset = Number(url.searchParams.get("offset"));
  if (!z.string().uuid().safeParse(assetId).success || !Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "Parameter tidak valid" }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: asset } = await db
    .from("assets")
    .select("storage_path,size_bytes")
    .eq("id", assetId)
    .eq("project_id", id)
    .eq("kind", "raw")
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "Aset tidak ditemukan" }, { status: 404 });

  const partPath = resolveMediaPath(asset.storage_path) + ".part";
  if (!fs.existsSync(partPath)) {
    return NextResponse.json({ error: "Unggahan sudah selesai atau tidak ditemukan" }, { status: 409 });
  }
  const current = fs.statSync(partPath).size;
  if (current !== offset) {
    return NextResponse.json({ error: "Offset tidak cocok", received: current }, { status: 409 });
  }

  const chunk = Buffer.from(await req.arrayBuffer());
  if (chunk.length === 0 || chunk.length > CHUNK_SIZE) {
    return NextResponse.json({ error: "Ukuran potongan tidak valid" }, { status: 400 });
  }
  if (asset.size_bytes != null && current + chunk.length > asset.size_bytes) {
    return NextResponse.json({ error: "Data melebihi ukuran file yang dideklarasikan" }, { status: 400 });
  }
  fs.appendFileSync(partPath, chunk);
  return NextResponse.json({ received: current + chunk.length });
}
