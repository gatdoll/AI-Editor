import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { facesRel, parseFaces, talentRel } from "@app/shared/talent";
import { mediaResponse } from "../../../../../lib/media-response.ts";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Fase 24: hasil pemisahan talent satu video mentah. Tanpa query = data wajah (JSON) atau 404 bila belum disiapkan;
 * `?file=1` = video talent transparan (VP9+alpha) dengan dukungan Range untuk pemutar.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Aset tidak valid" }, { status: 400 });
  const { data: asset } = await createAdminClient().from("assets").select("id,project_id,kind").eq("id", id).maybeSingle();
  if (!asset || asset.kind !== "raw") return NextResponse.json({ error: "Aset mentah tidak ditemukan" }, { status: 404 });
  const file = resolveMediaPath(talentRel(asset.project_id, asset.id));
  const facesFile = resolveMediaPath(facesRel(asset.project_id, asset.id));
  if (!fs.existsSync(file) || !fs.existsSync(facesFile)) return NextResponse.json({ error: "Talent belum disiapkan" }, { status: 404 });
  if (new URL(req.url).searchParams.get("file")) {
    const st = fs.statSync(file);
    return mediaResponse(req, file, "video/webm", `"talent-${st.size}-${st.mtimeMs}"`, undefined);
  }
  const faces = parseFaces(JSON.parse(fs.readFileSync(facesFile, "utf8")));
  if (!faces) return NextResponse.json({ error: "Data wajah rusak" }, { status: 500 });
  return NextResponse.json({ width: faces.width, height: faces.height, samples: faces.samples, mtime: fs.statSync(file).mtimeMs });
}
