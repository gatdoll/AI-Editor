import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { WAVEFORM } from "@app/config";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { computeWaveform } from "../../../../../lib/waveform";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Gelombang audio video mentah untuk timeline: { perSecond, peaks (base64, 1 byte per titik) }.
 * Dibuat sekali (beberapa detik untuk video panjang), disimpan di folder project, lalu disajikan dari cache.
 */
export async function GET(req: Request, ctx: Ctx) {
  // Error tak terduga dikembalikan sebagai pesan, bukan 500 kosong
  try { return await handle(req, ctx); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}

async function handle(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Aset tidak valid" }, { status: 400 });
  const { data: asset } = await createAdminClient().from("assets").select("project_id,storage_path,kind").eq("id", id).maybeSingle();
  if (!asset || asset.kind !== "raw") return NextResponse.json({ error: "Video mentah tidak ditemukan" }, { status: 404 });
  const cache = resolveMediaPath(`projects/${asset.project_id}/waveform/${id}-${WAVEFORM.perSecond}.bin`);
  let peaks: Buffer;
  if (fs.existsSync(cache)) peaks = await fs.promises.readFile(cache);
  else {
    const raw = resolveMediaPath(asset.storage_path);
    if (!fs.existsSync(raw)) return NextResponse.json({ error: "File mentah tidak ada di disk" }, { status: 404 });
    try { peaks = Buffer.from(await computeWaveform(raw)); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
    await fs.promises.mkdir(path.dirname(cache), { recursive: true });
    await fs.promises.writeFile(cache, peaks);
  }
  return NextResponse.json({ perSecond: WAVEFORM.perSecond, peaks: peaks.toString("base64") }, { headers: { "cache-control": "private, max-age=86400" } });
}
