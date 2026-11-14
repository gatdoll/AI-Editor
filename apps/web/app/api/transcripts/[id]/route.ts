import { NextResponse } from "next/server";
import { z } from "zod";
import { WordsSchema, createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ words: WordsSchema });

/** Transkrip lengkap (dengan kata-kata). Dipisah dari detail project karena bisa ratusan KB. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = createAdminClient();
  const { data, error } = await db.from("transcripts").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Transkrip tidak ditemukan" }, { status: 404 });
  return NextResponse.json({ transcript: data });
}

/**
 * Simpan koreksi transkrip. Hasil mesin disalin ke original_words sekali (koreksi pertama)
 * dan tidak pernah ditimpa lagi.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Format kata tidak valid" }, { status: 400 });

  const db = createAdminClient();
  const { data: current } = await db.from("transcripts").select("words,original_words").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Transkrip tidak ditemukan" }, { status: 404 });

  const patch: Record<string, unknown> = { words: parsed.data.words };
  if (current.original_words == null) patch.original_words = current.words;

  const { data: saved, error } = await db.from("transcripts").update(patch).eq("id", id).select("updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated_at: saved?.updated_at });
}
