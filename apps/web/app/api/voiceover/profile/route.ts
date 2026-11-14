import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { MOTION_GFX } from "@app/config";
import { wavDurationS } from "@app/shared/voiceover";
import { clearVoiceProfile, loadVoiceProfile, saveVoiceProfile } from "@app/shared/voiceover-store";

const REC = MOTION_GFX.voiceover.recording;

/** Fase 17: rekaman suara pengguna (acuan kloning), satu untuk semua project. */
export async function GET() {
  return NextResponse.json({ profile: loadVoiceProfile() });
}

/** Unggah rekaman WAV. Rekaman lama diganti; voice over yang sudah dibuat tidak berubah. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Tidak ada rekaman" }, { status: 400 });
  if (file.size > REC.maxBytes) return NextResponse.json({ error: "Rekaman terlalu besar." }, { status: 400 });
  const wav = new Uint8Array(await file.arrayBuffer());
  const durationS = wavDurationS(wav);
  if (durationS === null) return NextResponse.json({ error: "Rekaman bukan WAV yang valid." }, { status: 400 });
  if (durationS < REC.minS || durationS > REC.maxS) return NextResponse.json({ error: `Rekaman harus ${REC.minS}–${REC.maxS} detik (terukur ${Math.round(durationS)} detik).` }, { status: 400 });
  const profile = { id: randomUUID(), text: REC.text, durationS, createdAt: new Date().toISOString() };
  try {
    await saveVoiceProfile(profile, wav);
  } catch (e) {
    return NextResponse.json({ error: `Rekaman gagal disimpan: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
  return NextResponse.json({ profile }, { status: 201 });
}

export async function DELETE() {
  await clearVoiceProfile();
  return NextResponse.json({ ok: true });
}
