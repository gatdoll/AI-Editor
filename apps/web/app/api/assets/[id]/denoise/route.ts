import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { denoiseLevel, denoisePath } from "@app/shared/derived-media";
import { mediaResponse } from "../../../../../lib/media-response.ts";

type Ctx = { params: Promise<{ id: string }> };

async function rawAsset(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data } = await createAdminClient().from("assets").select("id,project_id,kind").eq("id", id).maybeSingle();
  return data && data.kind === "raw" ? data : null;
}

/**
 * Audio hasil reduksi noise (Fase 11) untuk kekuatan `?level=` (persen, kelipatan langkah di config).
 * 404 + status job bila belum ada, agar editor tahu harus menunggu atau mengantre.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const asset = await rawAsset(id);
  if (!asset) return NextResponse.json({ error: "Aset mentah tidak ditemukan" }, { status: 404 });
  const level = denoiseLevel(Number(new URL(req.url).searchParams.get("level")) / 100);
  if (!level) return NextResponse.json({ error: "level tidak valid" }, { status: 400 });
  const file = resolveMediaPath(denoisePath(asset.project_id, asset.id, level));
  if (fs.existsSync(file)) {
    const st = fs.statSync(file);
    return mediaResponse(req, file, "audio/mp4", `"nr${level}-${st.size}-${st.mtimeMs}"`, undefined);
  }
  const { data: job } = await createAdminClient().from("jobs").select("id,status,error,payload,created_at").eq("project_id", asset.project_id).eq("type", "denoise")
    .order("created_at", { ascending: false }).limit(10);
  // Fase 16: job milik video INI (project bisa punya beberapa video)
  const mine = (job ?? []).find((j) => (j.payload as { assetId?: string })?.assetId === asset.id && denoiseLevel((j.payload as { strength?: unknown })?.strength) === level);
  return NextResponse.json({ error: "Belum diproses", job: mine ? { status: mine.status, error: mine.error } : null }, { status: 404 });
}

export const HEAD = GET;

/** Antrekan reduksi noise untuk satu kekuatan. Tidak membuat job kedua untuk kekuatan yang sama. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const asset = await rawAsset(id);
  if (!asset) return NextResponse.json({ error: "Aset mentah tidak ditemukan" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const level = denoiseLevel((body as { strength?: unknown }).strength);
  if (!level) return NextResponse.json({ error: "Kekuatan harus lebih dari 0" }, { status: 400 });
  if (fs.existsSync(resolveMediaPath(denoisePath(asset.project_id, asset.id, level)))) return NextResponse.json({ ready: true, level });
  const db = createAdminClient();
  const { data: pending } = await db.from("jobs").select("id,payload").eq("project_id", asset.project_id).eq("type", "denoise").in("status", ["queued", "running"]);
  const same = (pending ?? []).find((j) => (j.payload as { assetId?: string })?.assetId === id && denoiseLevel((j.payload as { strength?: unknown })?.strength) === level);
  if (same) return NextResponse.json({ jobId: same.id, queued: false, level });
  const { data, error } = await db.from("jobs").insert({ project_id: asset.project_id, type: "denoise", payload: { assetId: id, strength: level / 100 } }).select("id").single();
  if (error) {
    const hint = /jobs_type_check/.test(error.message) ? " Jalankan migrasi 20261029090000_fase11_pratinjau_noise.sql di SQL Editor Supabase."
      : error.code === "23505" ? " Video lain sedang diproses; jalankan migrasi 20261030150000_fase16_multi_video.sql agar beberapa video bisa diproses bersamaan." : "";
    return NextResponse.json({ error: `Gagal mengantre reduksi noise: ${error.message}.${hint}` }, { status: 500 });
  }
  return NextResponse.json({ jobId: data.id, queued: true, level });
}
