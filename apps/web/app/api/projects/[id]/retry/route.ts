import { NextResponse } from "next/server";
import { loadReel } from "@app/shared/reel-db";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

/** Coba ulang dari awal (ingest -> transkrip) untuk project yang gagal. File mentah tidak disentuh. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = createAdminClient();

  const { data: project } = await db.from("projects").select("status").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  if (project.status !== "failed") {
    return NextResponse.json({ error: "Hanya project yang gagal yang bisa dicoba ulang" }, { status: 409 });
  }

  const reel = await loadReel(db, id);
  const asset = reel.primary;
  if (!asset) return NextResponse.json({ error: "Belum ada video mentah" }, { status: 409 });

  // Ulangi dari tahap yang gagal: bila transkrip yang gagal, jangan ulang ingest (hash + ekstrak audio) dari awal
  const { data: failedJob } = await db
    .from("jobs")
    .select("type")
    .eq("project_id", id)
    .eq("status", "failed")
    .in("type", ["ingest", "transcribe"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const stage = failedJob?.type === "transcribe" ? "transcribe" : "ingest";

  // Fase 16: ingest diulang untuk SETIAP video yang belum selesai diproses (bukan hanya video utama)
  const pending = reel.assets.filter((a) => !(Number(a.duration_s) > 0) || a.reel_offset_s === null);
  const targets = stage === "ingest" && pending.length ? pending : [asset];
  const { error } = await db.from("jobs").insert(targets.map((t) => ({ project_id: id, type: stage, payload: { assetId: t.id } })));
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Sudah ada proses yang berjalan" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await db.from("projects").update({ status: stage === "transcribe" ? "transcribing" : "ingesting", error: null }).eq("id", id);
  return NextResponse.json({ ok: true, stage });
}
