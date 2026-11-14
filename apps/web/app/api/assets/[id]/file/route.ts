import fs from "node:fs";
import path from "node:path";
import { mediaResponse } from "../../../../../lib/media-response.ts";
import { NextResponse } from "next/server";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { previewPath } from "@app/shared/derived-media";

type Ctx = { params: Promise<{ id: string }> };

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  // MOV berisi H.264 diputar Chrome bila disajikan sebagai video/mp4; "video/quicktime" sering ditolak pemutar
  ".mov": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

/**
 * Alirkan file dari disk ke pemutar, dengan dukungan Range agar bisa seek di video besar.
 * `?view=1` (pemutar): salinan pratinjau H.264 bila ada (Fase 11, mis. MOV HEVC), selain itu file mentah.
 * `?download=1` selalu file mentah.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = createAdminClient();
  // select("*"): kolom pratinjau (Fase 11) mungkin belum ada bila migrasi belum dijalankan
  const { data: asset } = await db.from("assets").select("*").eq("id", id).maybeSingle();
  if (!asset) return NextResponse.json({ error: "Aset tidak ditemukan" }, { status: 404 });

  const q = new URL(req.url).searchParams;
  // Status 'siap' dari worker; atau (migrasi belum dijalankan / belum diperiksa) salinan yang sudah ada di lokasi bakunya
  const rel = asset.preview_status === "siap" && typeof asset.preview_path === "string" ? asset.preview_path
    : asset.preview_status == null && asset.kind === "raw" ? previewPath(asset.project_id, asset.id) : null;
  if (q.get("view") === "1" && q.get("download") !== "1" && rel) {
    const previewFile = resolveMediaPath(rel);
    if (fs.existsSync(previewFile)) {
      const st = fs.statSync(previewFile);
      return mediaResponse(req, previewFile, "video/mp4", `"pv-${st.size}-${st.mtimeMs}"`, undefined);
    }
  }

  const file = resolveMediaPath(asset.storage_path);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "File tidak ada di disk" }, { status: 404 });

  const contentType = (typeof asset.mime === "string" && asset.mime) || TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
  const stat = fs.statSync(file);
  const etag = '"' + (asset.sha256 || stat.size + '-' + stat.mtimeMs) + '"';
  const name = new URL(req.url).searchParams.get("download") === "1" ? path.basename(file).replace(/[^\w.\-]/g, "_") : undefined;
  return mediaResponse(req, file, contentType, etag, name);
}

export const HEAD = GET;
