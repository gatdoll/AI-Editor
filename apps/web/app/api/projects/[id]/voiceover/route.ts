import fs from "node:fs";
import { NextResponse } from "next/server";
import { ReferenceInput } from "@app/shared/reference";
import { nextWithReference } from "../../../../../lib/next-reference";
import { z } from "zod";
import { CREATIVE, MOTION_GFX, isAllowedModel } from "@app/config";
import { createAdminClient } from "@app/shared";
import { SegmentSchema } from "@app/shared/voiceover";
import { clearVoiceover, loadVoiceover, loadVoiceProfile, voiceoverUploadPath } from "@app/shared/voiceover-store";

type Ctx = { params: Promise<{ id: string }> };

const uuid = z.string().uuid();
const VO = MOTION_GFX.voiceover;

/** Fase 17: voice over aktif project + job voice over terbaru. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const { data: job } = await createAdminClient()
    .from("jobs").select("id,status,progress,error,payload,created_at").eq("project_id", id).eq("type", "voiceover").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const p = (job?.payload ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    voiceover: loadVoiceover(id),
    job: job ? { id: job.id, status: job.status, progress: job.progress, error: job.error, stageLabel: p.stageLabel ?? null, script: p.script ?? null, next: p.next ?? null, upload: !!p.upload } : null,
  });
}

const Body = z.object({
  script: z.string().trim().min(1).max(VO.maxScriptChars),
  // Naskah baca yang diedit pengguna: dipakai apa adanya, tanpa arahan Codex
  readingText: z.string().trim().max(VO.maxScriptChars * VO.reading.maxLengthRatio).optional(),
  // Arahan per segmen yang diedit pengguna: dipakai apa adanya, tanpa arahan Codex
  segments: z.array(SegmentSchema).min(1).max(VO.direction.maxSegments).optional(),
  // Brief pertama: motion dibuat setelah suaranya selesai
  next: z.object({
    prompt: z.string().trim().min(1).max(CREATIVE.maxPromptChars), model: z.string().max(80).optional(),
    // Fase 19 (Opinion Motion): sesudah suara, riset aset dulu (provider pilihan pengguna); motion dibuat setelah aset dipilih
    assets: z.object({ provider: z.enum(["claude", "codex"]), model: z.string().max(80).optional() }).optional(),
    // Fase 22: video referensi gaya untuk motion yang dibuat sesudah suara selesai
    reference: ReferenceInput.optional(),
  }).optional(),
});

/** Buat voice over dari naskah dengan rekaman suara pengguna. Diproses worker; voice over lama tetap aktif sampai yang baru selesai. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `Isi naskah (maks. ${VO.maxScriptChars} karakter).` }, { status: 400 });
  if (parsed.data.next?.model && !isAllowedModel("claude", parsed.data.next.model)) return NextResponse.json({ error: "Model AI tidak dikenal." }, { status: 400 });
  if (parsed.data.next?.assets?.model && !isAllowedModel(parsed.data.next.assets.provider, parsed.data.next.assets.model)) return NextResponse.json({ error: "Model riset tidak dikenal." }, { status: 400 });
  if (!loadVoiceProfile()) return NextResponse.json({ error: "Rekam suara Anda dulu." }, { status: 409 });
  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("kind").eq("id", id).maybeSingle();
  if (!project || project.kind !== "motion") return NextResponse.json({ error: "Project motion graphics tidak ditemukan" }, { status: 404 });
  const next = await nextWithReference(id, parsed.data.next);
  if (next instanceof Response) return next;
  const { data: job, error } = await db.from("jobs").insert({ project_id: id, type: "voiceover", payload: { ...parsed.data, ...(next ? { next } : {}) } }).select("id").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Voice over sedang dibuat" }, { status: 409 });
    const hint = /jobs_type_check/.test(error.message) ? " Jalankan supabase/migrations/20261103100000_fase17_voiceover.sql di SQL Editor Supabase." : "";
    return NextResponse.json({ error: `${error.message}${hint}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 201 });
}

/** Batalkan job yang berjalan. Worker menghentikan mesin suara; voice over aktif tidak tersentuh. */
export async function PATCH(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const { data, error } = await createAdminClient().from("jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), error: "Dibatalkan oleh pengguna." }).eq("project_id", id).eq("type", "voiceover").in("status", ["queued", "running"]).select("payload");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Job antrean tidak akan pernah diambil worker: file unggahannya dihapus di sini
  for (const row of data ?? []) {
    const fileId = (row.payload as { upload?: { fileId?: unknown } } | null)?.upload?.fileId;
    if (typeof fileId === "string") await fs.promises.rm(voiceoverUploadPath(id, fileId), { force: true });
  }
  return NextResponse.json({ ok: true });
}

/** Hapus voice over aktif: durasi video kembali ke pengaturan. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  await clearVoiceover(id);
  return NextResponse.json({ ok: true });
}
