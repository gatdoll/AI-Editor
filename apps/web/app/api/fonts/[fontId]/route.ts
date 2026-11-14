import fs from "node:fs";
import { NextResponse } from "next/server";
import { resolveMediaPath } from "@app/shared";
import { listFontLibrary } from "@app/shared/font-library";
import { mediaResponse } from "../../../../lib/media-response.ts";

type Ctx = { params: Promise<{ fontId: string }> };

/** Fase 24: satu file font pustaka (Google Fonts, OFL) untuk pratinjau. Hanya id yang ada di catalog.json. */
export async function GET(req: Request, { params }: Ctx) {
  const { fontId } = await params;
  const f = listFontLibrary().find((x) => x.id === fontId);
  const file = f ? resolveMediaPath(f.rel) : null;
  if (!f || !file || !fs.existsSync(file)) return NextResponse.json({ error: "Font tidak ada di pustaka. Jalankan npm run setup:fonts." }, { status: 404 });
  const st = fs.statSync(file);
  return mediaResponse(req, file, "font/ttf", `"font-${f.id}-${st.size}"`, undefined);
}
