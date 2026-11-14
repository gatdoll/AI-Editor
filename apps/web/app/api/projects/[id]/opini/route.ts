import { NextResponse } from "next/server";
import { readActivity } from "../../../../../lib/activity";
import { z } from "zod";
import { CREATIVE, OPINION, isAllowedModel } from "@app/config";
import { createAdminClient } from "@app/shared";
import { normalizeMotion } from "@app/remotion/src/motion-props.ts";
import { loadOpinion, reconcile, saveOpinion } from "@app/shared/opinion-store";
import { loadVoiceover } from "@app/shared/voiceover-store";

type Ctx = { params: Promise<{ id: string }> };
const uuid = z.string().uuid();

/** Project Opinion Motion yang sah (motion + penanda opini). */
async function opinionProject(id: string) {
  const db = createAdminClient();
  const { data } = await db.from("projects").select("kind, style").eq("id", id).maybeSingle();
  const motion = normalizeMotion((data?.style as { motion?: unknown } | null)?.motion);
  return { db, ok: !!data && data.kind === "motion" && motion?.opini === true };
}

/** Fase 19: status riset aset (sebutan + kandidat) + job riset terbaru. Bahan yang dihapus pengguna mengembalikan sebutannya ke "pending". */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const { data: job } = await db.from("jobs").select("id,status,progress,error,payload,created_at").eq("project_id", id).eq("type", "assets").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const state = loadOpinion(id);
  const running = job?.status === "queued" || job?.status === "running";
  if (state && !running) {
    const { data: rows } = await db.from("assets").select("id").eq("project_id", id).eq("kind", "material");
    if (reconcile(state, new Set((rows ?? []).map((r) => r.id as string)))) await saveOpinion(id, state);
  }
  const p = (job?.payload ?? {}) as Record<string, unknown>;
  const vo = loadVoiceover(id);
  return NextResponse.json({
    state,
    // Voice over diganti sesudah riset: waktu sebutan tidak lagi cocok (aset tidak diikat ke waktu sampai riset ulang)
    stale: !!state && !!vo && state.voiceoverJobId !== vo.jobId,
    job: job ? { id: job.id, status: job.status, progress: job.progress, error: job.error, stageLabel: p.stageLabel ?? null, only: p.only ?? null, shot: p.shot ? (p.shot as { mentionId?: string }).mentionId ?? null : null, provider: p.provider ?? null, activity: readActivity(p.activity) } : null,
  });
}

const Body = z.object({
  provider: z.enum(["claude", "codex"]),
  model: z.string().max(80).optional(),
  brief: z.string().trim().max(CREATIVE.maxPromptChars).optional(),
  only: z.string().regex(/^m\d{1,3}$/).optional(),
  query: z.string().trim().max(300).optional(),
  shot: z.object({ mentionId: z.string().regex(/^m\d{1,3}$/), fokus: z.enum(["judul", "kutipan", "atas"]), kutipan: z.string().trim().max(300).optional(), sorot: z.boolean(), url: z.string().trim().url().max(2000).optional() }).optional(),
});

/** Mulai riset aset (penuh, satu sebutan, atau ambil ulang screenshot). Dikerjakan worker; satu job aktif per project. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Permintaan riset tidak valid." }, { status: 400 });
  const b = parsed.data;
  if (b.model && !isAllowedModel(b.provider, b.model)) return NextResponse.json({ error: "Model AI tidak dikenal." }, { status: 400 });
  if (b.shot?.url && !/^https?:\/\//i.test(b.shot.url)) return NextResponse.json({ error: "Link artikel harus http/https." }, { status: 400 });
  const { db, ok } = await opinionProject(id);
  if (!ok) return NextResponse.json({ error: "Project Opinion Motion tidak ditemukan" }, { status: 404 });
  if (!loadVoiceover(id)) return NextResponse.json({ error: "Voice over belum ada. Buat atau unggah voice over dulu: waktu munculnya aset mengikuti kata yang diucapkan." }, { status: 409 });
  if ((b.only || b.shot) && !loadOpinion(id)?.mentions.some((m) => m.id === (b.only ?? b.shot!.mentionId))) return NextResponse.json({ error: "Sebutan tidak ditemukan. Jalankan riset penuh." }, { status: 404 });
  const payload = { provider: b.provider, ...(b.model || OPINION.defaultModel[b.provider] ? { model: b.model || OPINION.defaultModel[b.provider] } : {}), ...(b.brief ? { brief: b.brief } : {}), ...(b.only ? { only: b.only } : {}), ...(b.query ? { query: b.query } : {}), ...(b.shot ? { shot: b.shot } : {}) };
  const { data: job, error } = await db.from("jobs").insert({ project_id: id, type: "assets", payload }).select("id").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Riset aset sedang berjalan. Tunggu selesai atau batalkan dulu." }, { status: 409 });
    const hint = /jobs_type_check/.test(error.message) ? " Jalankan supabase/migrations/20261110100000_fase19_opinion_motion.sql di SQL Editor Supabase." : "";
    return NextResponse.json({ error: `${error.message}${hint}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 201 });
}

/** Batalkan riset yang berjalan. Status dan pilihan sebelumnya tidak tersentuh (riset penuh hanya menulis di akhir). */
export async function PATCH(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const { error } = await createAdminClient().from("jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), error: "Dibatalkan oleh pengguna." }).eq("project_id", id).eq("type", "assets").in("status", ["queued", "running"]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
