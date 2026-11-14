import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadVoiceover, voiceoverAudioPath } from "@app/shared/voiceover-store";
import { mediaResponse } from "../../../../../../lib/media-response.ts";

type Ctx = { params: Promise<{ id: string }> };

/** File audio voice over aktif (pratinjau dan dengar contoh), dengan dukungan Range. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const info = loadVoiceover(id);
  if (!info) return NextResponse.json({ error: "Voice over belum ada" }, { status: 404 });
  const file = voiceoverAudioPath(id, info.jobId);
  const st = fs.statSync(file);
  return mediaResponse(req, file, "audio/mp4", `"vo-${info.jobId}-${st.size}"`, undefined);
}
