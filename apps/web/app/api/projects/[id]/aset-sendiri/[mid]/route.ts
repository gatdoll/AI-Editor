import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, type Word } from "@app/shared";
import { loadNotes } from "@app/shared/material-notes";
import { placementAt, type OwnItem, type OwnState } from "@app/shared/own-assets";
import { loadOwn, saveOwn } from "@app/shared/own-assets-store";
import { loadReel } from "@app/shared/reel-db";

type Ctx = { params: Promise<{ id: string; mid: string }> };
const uuid = z.string().uuid();

const Body = z.discriminatedUnion("action", [
  /** Pakai usulan ke-n (0 = utama). */
  z.object({ action: z.literal("pakai"), option: z.number().int().min(0).max(10) }),
  /** Pakai di posisi playhead (detik video mentah). */
  z.object({ action: z.literal("di-sini"), atS: z.number().min(0) }),
  z.object({ action: z.literal("tidak-dipakai") }),
  /** Kembali ke belum diputuskan. */
  z.object({ action: z.literal("ulang") }),
]);

/** Keputusan pengguna atas satu aset sendiri (Fase 21). Tidak ada aset yang dipakai tanpa langkah ini. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, mid } = await params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(mid).success) return NextResponse.json({ error: "Tidak valid" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Keputusan tidak valid." }, { status: 400 });
  const b = parsed.data;
  const db = createAdminClient();
  const { data: job } = await db.from("jobs").select("status,payload").eq("project_id", id).eq("type", "assets").in("status", ["queued", "running"]).limit(1).maybeSingle();
  const busy = (job?.payload as { own?: unknown; only?: string[] } | null);
  if (busy?.own === true && (!busy.only || busy.only.includes(mid))) return NextResponse.json({ error: "Aset ini sedang dicocokkan. Tunggu selesai." }, { status: 409 });
  const { data: mat } = await db.from("assets").select("id,mime").eq("id", mid).eq("project_id", id).eq("kind", "material").maybeSingle();
  if (!mat || !String(mat.mime ?? "").startsWith("image/")) return NextResponse.json({ error: "Gambar tidak ditemukan." }, { status: 404 });

  const state: OwnState = loadOwn(id) ?? { version: 1, provider: null, model: null, updatedAt: "", items: [], warnings: [] };
  let item = state.items.find((i) => i.assetId === mid);
  if (!item) {
    // Aset yang belum pernah dicocokkan tetap bisa ditaruh manual di posisi playhead
    item = { assetId: mid, status: "pending", options: [], noteUsed: loadNotes(id)[mid] ?? "" } satisfies OwnItem;
    state.items.push(item);
  }
  if (b.action === "pakai") {
    const opt = item.options[b.option];
    if (!opt) return NextResponse.json({ error: "Usulan itu tidak ada." }, { status: 404 });
    item.chosen = opt; item.status = "dipakai";
  } else if (b.action === "di-sini") {
    const reel = await loadReel(db, id);
    if (!reel.primary) return NextResponse.json({ error: "Video tidak ditemukan." }, { status: 404 });
    const { data: tr } = await db.from("transcripts").select("words").eq("asset_id", reel.primary.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const words = ((tr?.words ?? []) as Word[]).map((w) => ({ text: w.text, start: w.start, end: w.end }));
    const pl = placementAt(words, b.atS);
    if (!pl) return NextResponse.json({ error: "Transkrip belum ada: buat transkrip dulu agar aset bisa diikat ke ucapan." }, { status: 409 });
    item.chosen = pl; item.status = "dipakai";
  } else if (b.action === "tidak-dipakai") {
    delete item.chosen; item.status = "tidak-dipakai";
  } else {
    delete item.chosen; item.status = "pending";
  }
  await saveOwn(id, state);
  return NextResponse.json({ item });
}
