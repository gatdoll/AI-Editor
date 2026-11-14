import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { LIMITS, REFERENCE } from "@app/config";
import { createAdminClient, freeDiskBytes, mediaDir, safeFileName } from "@app/shared";
import { referenceDir, saveReference } from "@app/shared/reference-store";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** Stream one reference directly to a separate directory; never creates a raw asset or ingestion job. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Project tidak valid" }, { status: 400 });
  const url = new URL(req.url);
  const fileName = url.searchParams.get("name") ?? "";
  const size = Number(req.headers.get("content-length"));
  const ext = path.extname(fileName).toLowerCase();
  if (!fileName || fileName.length > 300 || ![".mp4", ".mov", ".mkv", ".webm", ".m4v"].includes(ext)) return Response.json({ error: "Pilih video MP4, MOV, MKV, WebM, atau M4V." }, { status: 400 });
  if (!req.body || !Number.isSafeInteger(size) || size <= 0 || size > REFERENCE.maxBytes) return Response.json({ error: "Video referensi maksimal 150 MB dan tidak boleh kosong." }, { status: 413 });
  const { data } = await createAdminClient().from("projects").select("id").eq("id", id).maybeSingle();
  if (!data) return Response.json({ error: "Project tidak ditemukan" }, { status: 404 });
  const free = freeDiskBytes(mediaDir());
  if (free !== null && free < size + LIMITS.diskReserveBytes) return Response.json({ error: "Ruang disk tidak cukup untuk referensi." }, { status: 507 });
  const refId = crypto.randomUUID();
  const dir = referenceDir(id, refId);
  const file = `source${ext}`;
  const partPath = path.join(dir, file + ".part");
  await mkdir(dir, { recursive: true });
  let received = 0;
  try {
    await pipeline(Readable.fromWeb(req.body as never), new Transform({ transform(chunk, _encoding, done) {
      received += chunk.length;
      done(received > size || received > REFERENCE.maxBytes ? new Error("Data melebihi batas unggahan.") : null, chunk);
    } }), createWriteStream(partPath, { flags: "wx" }));
    if (received !== size) throw new Error("Unggahan terputus. Pilih file lagi.");
    await rename(partPath, path.join(dir, file));
    const label = safeFileName(fileName);
    await saveReference({ id: refId, projectId: id, kind: "upload", label, file, size });
    return Response.json({ id: refId, label }, { status: 201 });
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    return Response.json({ error: e instanceof Error ? e.message : "Unggahan gagal." }, { status: 400 });
  }
}
