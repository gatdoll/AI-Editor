import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@app/shared";
import { loadCreativeCode } from "@app/shared/creative-store";
import { loadCreativeSfx } from "@app/shared/sfx-library";
import { loadCreativeFonts } from "@app/shared/font-library";

/** Fase 24: URL font untuk pratinjau: pustaka lewat /api/fonts, unggahan lewat rute file bahan. */
const fontSrc = (f: { id: string; source: string }) => (f.source === "unggahan" && /^u-[0-9a-f-]{36}$/.test(f.id) ? `/api/assets/${f.id.slice(2)}/file` : `/api/fonts/${encodeURIComponent(f.id)}`);

type Ctx = { params: Promise<{ id: string; versionId: string }> };

const uuid = z.string().uuid();

/** Kode satu versi Mode Kreatif untuk pratinjau. Fungsi pemuat yang sama dengan render di worker. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, versionId } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(versionId).success) return NextResponse.json({ error: "Versi tidak valid" }, { status: 400 });
  const loaded = await loadCreativeCode(createAdminClient(), id, versionId);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.httpStatus });
  const fonts = loadCreativeFonts(id, versionId).map((f) => ({ id: f.id, family: f.family, weight: f.weight, src: fontSrc(f) }));
  return NextResponse.json({ id: loaded.id, status: loaded.status, ...loaded.code, sfx: loadCreativeSfx(id, versionId), fonts });
}

const Body = z.object({ action: z.enum(["reject", "restore"]) });

/**
 * Tolak versi (draft -> ditolak) atau pulihkan (ditolak -> draft). Mengaktifkan/menonaktifkan TIDAK lewat sini:
 * itu perubahan gaya (style.creativeId) lewat PUT /style, sehingga ikut undo/redo dan pemeriksaan konflik editor.
 * Versi tidak pernah dihapus.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, versionId } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(versionId).success) return NextResponse.json({ error: "Versi tidak valid" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Aksi tidak dikenal" }, { status: 400 });
  const db = createAdminClient();
  const { data: v } = await db.from("creative_versions").select("status").eq("id", versionId).eq("project_id", id).maybeSingle();
  if (!v) return NextResponse.json({ error: "Versi tidak ditemukan" }, { status: 404 });
  const [from, to] = parsed.data.action === "reject" ? ["draft", "ditolak"] : ["ditolak", "draft"];
  if (v.status === "aktif") return NextResponse.json({ error: "Versi ini sedang aktif. Matikan atau aktifkan versi lain dulu." }, { status: 409 });
  if (v.status !== from) return NextResponse.json({ error: `Versi berstatus ${v.status}; aksi ini hanya untuk versi ${from}.` }, { status: 409 });
  const { error } = await db.from("creative_versions").update({ status: to }).eq("id", versionId).eq("status", from);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: to });
}
