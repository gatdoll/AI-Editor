import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveMediaPath } from "@app/shared";
import { isCandidatePath } from "@app/shared/opinion-store";

type Ctx = { params: Promise<{ id: string }> };
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };

/** Fase 19: berkas kandidat aset (gambar unduhan, screenshot artikel). Hanya folder kandidat project ini. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const rel = new URL(req.url).searchParams.get("path") ?? "";
  if (!z.string().uuid().safeParse(id).success || !isCandidatePath(id, rel)) return NextResponse.json({ error: "Tidak valid" }, { status: 400 });
  const type = TYPES[path.extname(rel).toLowerCase()];
  const file = resolveMediaPath(rel);
  if (!type || !fs.existsSync(file)) return NextResponse.json({ error: "Berkas tidak ditemukan" }, { status: 404 });
  const body = await fs.promises.readFile(file);
  // SVG dari internet: CSP ketat agar tidak bisa menjalankan apa pun bila dibuka langsung
  return new NextResponse(new Uint8Array(body), { headers: { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
}
