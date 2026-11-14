import fs from "node:fs";
import { NextResponse } from "next/server";
import { getSfx, sfxPath } from "@app/shared/sfx-library";
import { mediaResponse } from "../../../../../lib/media-response.ts";

type Ctx = { params: Promise<{ id: string }> };

/** File audio satu SFX (pratinjau dan dengar contoh), dengan dukungan Range. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const item = getSfx(decodeURIComponent(id));
  if (!item) return NextResponse.json({ error: "SFX tidak ditemukan" }, { status: 404 });
  const file = sfxPath(item);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "File SFX tidak ada di disk. Jalankan npm run setup:sfx." }, { status: 404 });
  const st = fs.statSync(file);
  return mediaResponse(req, file, item.mime, `"sfx-${st.size}-${st.mtimeMs}"`, undefined);
}
