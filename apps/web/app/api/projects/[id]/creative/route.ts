import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { readActivity } from "../../../../../lib/activity";
import { z } from "zod";
import { CREATIVE, END_CLIP, isAllowedModel } from "@app/config";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { creativeScreenshotDir, loadCreativeCode } from "@app/shared/creative-store";
import { ReferenceInput, type ReferenceAttachment } from "@app/shared/reference";
import { attachReference } from "@app/shared/reference-store";

type Ctx = { params: Promise<{ id: string }> };

const uuid = z.string().uuid();

/** Riwayat versi Mode Kreatif (tanpa kode, agar ringan) + job kreatif terbaru + versi aktif. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  // Fase 18: ?target=endClip = riwayat klip akhir; tanpa itu = lapisan kreatif. Keduanya tidak tercampur.
  const wantEnd = new URL(req.url).searchParams.get("target") === "endClip";
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("style").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  const { data: rows, error } = await db
    .from("creative_versions")
    .select("id,prompt,model,notes,stills,status,error,duration_ms,replaces_captions,skill_refs,created_at,code_overlay,code_video")
    .eq("project_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { data: latestJob } = await db
    .from("jobs")
    .select("id,status,progress,error,payload,created_at,started_at,finished_at")
    .eq("project_id", id)
    .eq("type", "creative")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const job = latestJob && (typeof (latestJob.payload as Record<string, unknown> | null)?.endClipSeconds === "number") === wantEnd ? latestJob : null;
  const own = (rows ?? []).filter((v) => ((v.skill_refs as { target?: string } | null)?.target === "endClip") === wantEnd);
  const versions = own.map(({ code_overlay, code_video, ...v }, i) => ({ ...v, number: i + 1, hasOverlay: !!code_overlay, hasVideo: !!code_video, stillCount: (v.stills as string[]).length }));
  const p = (job?.payload ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    versions,
    activeId: (project.style as { creativeId?: string } | null)?.creativeId ?? null,
    job: job ? { id: job.id, status: job.status, progress: job.progress, error: job.error, stage: p.stage ?? null, stageLabel: p.stageLabel ?? null, round: p.round ?? 0, baseVersionId: p.baseVersionId ?? null, creativeVersionId: p.creativeVersionId ?? null, reference: p.reference ? { label: (p.reference as ReferenceAttachment).label, url: (p.reference as ReferenceAttachment).url ?? null, startS: (p.reference as ReferenceAttachment).startS } : null, activity: readActivity(p.activity), created_at: job.created_at, started_at: job.started_at, finished_at: job.finished_at } : null,
  });
}

const Body = z.object({
  prompt: z.string().trim().min(1).max(CREATIVE.maxPromptChars),
  model: z.string().max(80).optional(),
  // Perintah lanjutan: AI mengedit kode versi ini, bukan menulis dari nol
  baseVersionId: uuid.optional(),
  // Fase 18: ada = buat klip akhir sepanjang ini (detik)
  endClipSeconds: z.number().min(END_CLIP.seconds.min).max(END_CLIP.seconds.max).optional(),
  // Fase 22: video referensi gaya (unggah atau link YouTube/Instagram/TikTok). AI melihat sampel frame-nya dulu.
  reference: ReferenceInput.optional(),
  // Fase 24: pengguna mencentang "Pisahkan talent" (teks di belakang talent / blur wajah). Hanya project video.
  talent: z.boolean().optional(),
  // Fase 25: pengguna mencentang "Rig karakter" (gambar karakter di bahan dibuat bisa bergerak)
  rig: z.boolean().optional(),
});

/** Kirim perintah Mode Kreatif. Diproses worker; hasilnya versi 'draft' yang TIDAK aktif sampai pengguna mengaktifkannya. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  // Dengan screenshot: multipart (kolom `body` berisi JSON yang sama, kolom `screenshots` berisi gambar)
  const form = req.headers.get("content-type")?.startsWith("multipart/form-data") ? await req.formData().catch(() => null) : null;
  const raw: unknown = form ? (() => { try { return JSON.parse(String(form.get("body"))); } catch { return null; } })() : await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.some((i) => i.path[0] === "reference") ? "Referensi atau waktu awal tidak valid. Pasang ulang referensinya." : `Isi perintah (maks. ${CREATIVE.maxPromptChars} karakter).` }, { status: 400 });
  const shots = (form?.getAll("screenshots") ?? []).filter((f): f is File => f instanceof File);
  const shotExt = CREATIVE.screenshots.ext as Record<string, string>;
  if (shots.length > CREATIVE.screenshots.max) return NextResponse.json({ error: `Maksimal ${CREATIVE.screenshots.max} screenshot per perintah.` }, { status: 400 });
  if (shots.some((f) => !shotExt[f.type])) return NextResponse.json({ error: "Screenshot harus PNG, JPG, atau WebP." }, { status: 400 });
  if (shots.some((f) => f.size > CREATIVE.screenshots.maxBytes)) return NextResponse.json({ error: `Screenshot terlalu besar (maks. ${Math.round(CREATIVE.screenshots.maxBytes / 1048576)} MB per gambar).` }, { status: 400 });
  const model = parsed.data.model || CREATIVE.defaultModel;
  if (!isAllowedModel("claude", model)) return NextResponse.json({ error: "Model AI tidak dikenal." }, { status: 400 });

  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("status").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  if (project.status !== "ready") return NextResponse.json({ error: "Project belum siap (video masih disiapkan)" }, { status: 409 });

  // Mode Kreatif hanya memakai Claude Code CLI (skill berformat Claude Code)
  const { data: st } = await db.from("app_status").select("value").eq("key", "analyzers").maybeSingle();
  const info = st?.value?.claude;
  if (info && !(info.installed && info.loggedIn)) return NextResponse.json({ error: `Claude Code CLI belum siap: ${info.detail}` }, { status: 409 });

  if (parsed.data.baseVersionId) {
    const base = await loadCreativeCode(db, id, parsed.data.baseVersionId);
    if (!base.ok) return NextResponse.json({ error: `Versi dasar tidak bisa dipakai: ${base.error}` }, { status: base.httpStatus });
  }

  let reference: ReferenceAttachment | undefined;
  try {
    if (parsed.data.reference) reference = await attachReference(id, parsed.data.reference);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Referensi tidak ditemukan; unggah ulang." }, { status: 400 });
  }

  // Berkas ditulis sebelum job dibuat, agar worker tidak pernah mengambil job yang screenshotnya belum ada
  const jobId = randomUUID();
  const shotDir = resolveMediaPath(creativeScreenshotDir(id, jobId));
  if (shots.length) await fs.promises.mkdir(shotDir, { recursive: true });
  for (const [i, f] of shots.entries()) await fs.promises.writeFile(path.join(shotDir, `${String(i + 1).padStart(2, "0")}${shotExt[f.type]}`), Buffer.from(await f.arrayBuffer()));

  const { data: job, error } = await db
    .from("jobs")
    .insert({ id: jobId, project_id: id, type: "creative", payload: { prompt: parsed.data.prompt, model, ...(parsed.data.endClipSeconds !== undefined ? { endClipSeconds: parsed.data.endClipSeconds } : {}), ...(parsed.data.baseVersionId ? { baseVersionId: parsed.data.baseVersionId } : {}), ...(shots.length ? { screenshots: shots.length } : {}), ...(reference ? { reference } : {}), ...(parsed.data.talent && parsed.data.endClipSeconds === undefined ? { talent: true } : {}), ...(parsed.data.rig && parsed.data.endClipSeconds === undefined ? { rig: true } : {}) } })
    .select("id")
    .single();
  if (error) {
    await fs.promises.rm(shotDir, { recursive: true, force: true });
    if (error.code === "23505") return NextResponse.json({ error: "Perintah kreatif sebelumnya masih diproses. Tunggu atau batalkan dulu." }, { status: 409 });
    if (/jobs_type_check/.test(error.message)) return NextResponse.json({ error: "Database belum mendukung Mode Kreatif. Jalankan supabase/migrations/20261028120000_fase9_kreatif.sql." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ jobId: job.id });
}
