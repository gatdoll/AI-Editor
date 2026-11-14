import { NextResponse } from "next/server";
import { z } from "zod";
import { MOTION_GFX } from "@app/config";
import { createAdminClient } from "@app/shared";

export async function GET() {
  const db = createAdminClient();
  const { data, error } = await db
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data });
}

const CreateBody = z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(["video", "motion", "animasi", "opini"]).default("video") });

export async function POST(req: Request) {
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Nama project wajib diisi (maks 120 karakter)" }, { status: 400 });
  }
  const db = createAdminClient();
  const { data, error } = await db
    .from("projects")
    // Fase 12: subtitle tidak tampil sampai user memilih Auto subtitle atau menulis subtitle sendiri di workspace.
    // Fase 13: motion graphics tidak punya video untuk diunggah: langsung siap, mulai dari brief.
    // Animasi = project motion dengan penanda motion.animasi (tanpa migrasi): seluruh mesin motion ikut, agen memakai skill animate-story
    // Opinion Motion (Fase 19) = project motion dengan penanda motion.opini: voice over wajib, aset internet dipilih pengguna
    .insert(parsed.data.kind !== "video"
      ? { name: parsed.data.name, kind: "motion", status: "ready", style: { aspect: "9:16", captions: false, motion: { durationS: MOTION_GFX.durationS.default, ...(parsed.data.kind === "animasi" ? { animasi: true } : {}), ...(parsed.data.kind === "opini" ? { opini: true } : {}) } } }
      : { name: parsed.data.name, style: { captions: false } })
    .select("*")
    .single();
  if (error) {
    if (/kind/.test(error.message)) return NextResponse.json({ error: "Database belum mendukung project motion graphics. Jalankan supabase/migrations/20261029150000_fase13_motion.sql." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ project: data }, { status: 201 });
}
