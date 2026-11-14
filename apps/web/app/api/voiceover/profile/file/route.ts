import fs from "node:fs";
import { NextResponse } from "next/server";
import { loadVoiceProfile, voiceProfileAudioPath } from "@app/shared/voiceover-store";
import { mediaResponse } from "../../../../../lib/media-response.ts";

/** File rekaman suara aktif, untuk didengarkan kembali di panel. */
export async function GET(req: Request) {
  const profile = loadVoiceProfile();
  if (!profile) return NextResponse.json({ error: "Rekaman suara belum ada" }, { status: 404 });
  const file = voiceProfileAudioPath(profile.id);
  return mediaResponse(req, file, "audio/wav", `"voice-${profile.id}-${fs.statSync(file).size}"`, undefined);
}
