import path from "node:path";
import { NextResponse } from "next/server";
import { SFX } from "@app/config";
import { addUploadedSfx, listSfx } from "@app/shared/sfx-library";

/** Fase 14: pustaka SFX (bawaan Kenney CC0 + buatan sendiri, lalu unggahan pengguna). Berlaku untuk semua project. */
export async function GET() {
  return NextResponse.json({ items: listSfx() });
}

const EXT_MIME: Record<string, string> = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".webm": "audio/webm" };

/** Unggah satu SFX (multipart: file, name, tags dipisah koma, durationS dibaca browser). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Tidak ada file" }, { status: 400 });
  const ext = path.extname(file.name).toLowerCase().replace(/[^.\w]/g, "").slice(0, 6);
  const mime = (SFX.upload.mimes as readonly string[]).includes(file.type) ? file.type : EXT_MIME[ext] ?? "";
  if (!(SFX.upload.mimes as readonly string[]).includes(mime)) return NextResponse.json({ error: "Format belum didukung. Pakai MP3, WAV, OGG, atau M4A." }, { status: 400 });
  if (file.size > SFX.upload.maxBytes) return NextResponse.json({ error: `File terlalu besar (maks. ${Math.round(SFX.upload.maxBytes / 1048576)} MB). SFX biasanya beberapa detik saja.` }, { status: 400 });
  const name = String(form?.get("name") || path.basename(file.name, ext)).trim().replace(/\s+/g, "-").toLowerCase().slice(0, 40) || "sfx";
  const tags = String(form?.get("tags") ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  const durationS = Number(form?.get("durationS")) || 0;
  try {
    const item = await addUploadedSfx({ name, tags, bytes: Buffer.from(await file.arrayBuffer()), ext: ext || ".mp3", mime, durationS: Math.round(durationS * 1000) / 1000 });
    return NextResponse.json({ item }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
