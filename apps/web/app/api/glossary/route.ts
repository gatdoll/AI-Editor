import { NextResponse } from "next/server";
import { z } from "zod";
import { GLOSSARY_MAX_CHARS, loadGlossary, saveGlossary } from "@app/shared/glossary";

/** Daftar istilah pengguna untuk transkrip (petunjuk Whisper + ejaan benar untuk koreksi AI). Satu untuk semua project. */
export async function GET() {
  return NextResponse.json({ glossary: loadGlossary() });
}

export async function PUT(req: Request) {
  const parsed = z.object({ glossary: z.string().max(GLOSSARY_MAX_CHARS * 2) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `Daftar istilah maks. ${GLOSSARY_MAX_CHARS} karakter.` }, { status: 400 });
  return NextResponse.json({ glossary: await saveGlossary(parsed.data.glossary) });
}
