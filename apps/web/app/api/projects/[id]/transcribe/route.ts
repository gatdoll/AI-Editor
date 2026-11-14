import { NextResponse } from "next/server";
import { loadReel } from "@app/shared/reel-db";
import { z } from "zod";
import { createAdminClient } from "@app/shared";
import type { Interval } from "@app/shared/edl";
import { coversSegments } from "@app/shared/transcript-segments";
import { keptSegments } from "../../../../../lib/kept-segments.ts";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Fase 12: buat transkrip (Whisper) dari workspace, mis. untuk Auto subtitle. Tidak ada proses di depan saat upload.
 * Yang ditranskrip hanya bagian yang DIPERTAHANKAN saat ini (trim manual + cut yang disetujui), jadi take yang salah
 * tidak ikut. Idempoten: transkrip yang sudah mencakup potongan sekarang, atau job yang sedang berjalan, tidak membuat
 * job kedua.
 */
export async function POST(req: Request, { params }: Ctx) {
  // ?force=1 = "Generate ulang subtitle": selalu transkrip baru dari klip yang sekarang (seperti CapCut), bukan menambal
  const force = new URL(req.url).searchParams.get("force") === "1";
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("status").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  const asset = (await loadReel(db, id)).primary;
  if (!asset || !["ready", "transcribing", "analyzing"].includes(project.status)) return NextResponse.json({ error: "Video belum siap (masih diunggah atau disiapkan)." }, { status: 409 });
  const { data: pending } = await db.from("jobs").select("id").eq("project_id", id).eq("type", "transcribe").in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (pending) return NextResponse.json({ jobId: pending.id, queued: false });
  const plan = await keptSegments(db, id);
  if ("error" in plan) return NextResponse.json({ error: plan.error }, { status: 409 });
  // select("*"): kolom segments (migrasi 20261029120000) mungkin belum ada
  const { data: latest } = await db.from("transcripts").select("*").eq("asset_id", asset.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!force && latest && coversSegments(latest.segments as Interval[] | null | undefined, plan.segments)) return NextResponse.json({ ready: true });
  const { data, error } = await db.from("jobs").insert({ project_id: id, type: "transcribe", payload: { assetId: asset.id, segments: plan.segments, ...(force ? { fresh: true } : {}) } }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await db.from("projects").update({ status: "transcribing" }).eq("id", id);
  return NextResponse.json({ jobId: data.id, queued: true });
}
