import { NextResponse } from "next/server";
import { loadReel, rawLabel } from "@app/shared/reel-db";
import fs from "node:fs";
import { z } from "zod";
import { createAdminClient, resolveMediaPath } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = createAdminClient();

  const { data: project, error } = await db.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });

  // Fase 16: semua video project (reel). `asset` = video utama (pemilik transkrip), `assets` = semua video, `reel` = posisi tiap video
  const reel = await loadReel(db, id);
  const raw = reel.primary;

  // Job terbaru untuk TIAP tahap (bukan 5 terakhir): UI menampilkan status per tahap
  const { data: recent } = await db
    .from("jobs")
    .select("id,type,status,progress,error,created_at,started_at,finished_at,payload")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(40);
  const seen = new Set<string>();
  const jobs = (recent ?? []).filter((j) => (seen.has(j.type) ? false : (seen.add(j.type), true)));

  // Metadata transkrip SAJA. Daftar kata (ribuan untuk video panjang) diambil terpisah lewat /api/transcripts/[id]
  let transcript: Record<string, unknown> | null = null;
  if (raw) {
    const { data } = await db
      .from("transcripts")
      .select("id,asset_id,language,engine,model,created_at,updated_at")
      .eq("asset_id", raw.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const { count } = await db
        .from("transcripts")
        .select("id", { count: "exact", head: true })
        .eq("id", data.id)
        .not("original_words", "is", null);
      transcript = { ...data, edited: (count ?? 0) > 0 };
    }
  }

  return NextResponse.json({ project, asset: raw, assets: reel.assets.map((a) => ({ ...a, label: rawLabel(a) })), reel: { clips: reel.clips, durationS: reel.durationS }, jobs, transcript });
}

/**
 * Hapus project (baris DB, cascade ke aset/transkrip/usulan/versi). `?files=1` = hapus juga folder project di
 * MEDIA_DIR (video mentah, salinan pratinjau, audio, hasil render), atas pilihan eksplisit pengguna; tidak bisa dibatalkan.
 * Ditolak selama ada proses worker yang berjalan untuk project ini.
 */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const { data: active } = await db.from("jobs").select("type").eq("project_id", id).in("status", ["queued", "running"]).limit(1);
  if (active?.length) return NextResponse.json({ error: `Masih ada proses berjalan (${active[0].type}). Tunggu selesai atau batalkan dulu.` }, { status: 409 });
  const { error } = await db.from("projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let filesRemoved = false;
  if (new URL(req.url).searchParams.get("files") === "1") {
    // resolveMediaPath menolak path di luar folder media
    const dir = resolveMediaPath(`projects/${id}`);
    if (fs.existsSync(dir)) { await fs.promises.rm(dir, { recursive: true, force: true }); filesRemoved = true; }
  }
  return NextResponse.json({ ok: true, filesRemoved });
}
