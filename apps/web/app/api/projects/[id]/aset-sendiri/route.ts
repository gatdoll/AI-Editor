import { NextResponse } from "next/server";
import { z } from "zod";
import { OWN_ASSETS, isAllowedModel } from "@app/config";
import { createAdminClient } from "@app/shared";
import { loadOwn, reconcileOwn, saveOwn } from "@app/shared/own-assets-store";
import { readActivity } from "../../../../../lib/activity";

type Ctx = { params: Promise<{ id: string }> };
const uuid = z.string().uuid();

/** Job pencocokan aset sendiri = job 'assets' dengan payload.own (Fase 21, tanpa migrasi). */
async function latestJob(id: string) {
  const { data } = await createAdminClient().from("jobs").select("id,status,progress,error,payload,created_at").eq("project_id", id).eq("type", "assets").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data && (data.payload as { own?: unknown } | null)?.own === true ? data : null;
}

/** Fase 21: status aset sendiri (usulan + keputusan) + job terbaru. Bahan yang dihapus pengguna ikut hilang dari status. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const job = await latestJob(id);
  const state = loadOwn(id);
  const running = job?.status === "queued" || job?.status === "running";
  if (state && !running) {
    const { data: rows } = await db.from("assets").select("id").eq("project_id", id).eq("kind", "material");
    if (reconcileOwn(state, new Set((rows ?? []).map((r) => r.id as string)))) await saveOwn(id, state);
  }
  const p = (job?.payload ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    state,
    job: job ? { id: job.id, status: job.status, progress: job.progress, error: job.error, stageLabel: p.stageLabel ?? null, only: Array.isArray(p.only) ? p.only : null, provider: p.provider ?? null, activity: readActivity(p.activity) } : null,
  });
}

const Body = z.object({
  provider: z.enum(["claude", "codex"]),
  model: z.string().max(80).optional(),
  only: z.array(z.string().uuid()).max(100).optional(),
});

/** Mulai pencocokan (semua yang belum diputuskan, atau aset tertentu). Satu job 'assets' aktif per project. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
  const b = parsed.data;
  if (b.model && !isAllowedModel(b.provider, b.model)) return NextResponse.json({ error: "Model AI tidak dikenal." }, { status: 400 });
  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("kind").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  if (project.kind === "motion") return NextResponse.json({ error: "Aset sendiri hanya untuk project video bicara." }, { status: 400 });
  const model = b.model || OWN_ASSETS.defaultModel[b.provider];
  const payload = { own: true, provider: b.provider, ...(model ? { model } : {}), ...(b.only?.length ? { only: b.only } : {}) };
  const { data: job, error } = await db.from("jobs").insert({ project_id: id, type: "assets", payload }).select("id").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Pencocokan aset sedang berjalan. Tunggu selesai atau batalkan dulu." }, { status: 409 });
    const hint = /jobs_type_check/.test(error.message) ? " Jalankan supabase/migrations/20261110100000_fase19_opinion_motion.sql di SQL Editor Supabase." : "";
    return NextResponse.json({ error: `${error.message}${hint}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 201 });
}

/** Batalkan pencocokan yang berjalan. Keputusan sebelumnya tidak tersentuh (hasil hanya ditulis di akhir job). */
export async function PATCH(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const job = await latestJob(id);
  if (!job || !(job.status === "queued" || job.status === "running")) return NextResponse.json({ ok: true });
  const { error } = await createAdminClient().from("jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), error: "Dibatalkan oleh pengguna." }).eq("id", job.id).in("status", ["queued", "running"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
