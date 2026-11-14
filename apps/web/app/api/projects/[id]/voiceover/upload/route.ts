import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ReferenceInput } from "@app/shared/reference";
import { nextWithReference } from "../../../../../../lib/next-reference";
import { z } from "zod";
import { CREATIVE, MOTION_GFX, isAllowedModel } from "@app/config";
import { createAdminClient } from "@app/shared";
import { voiceoverUploadExt } from "@app/shared/voiceover";
import { voiceoverUploadPath } from "@app/shared/voiceover-store";

type Ctx = { params: Promise<{ id: string }> };

const VO = MOTION_GFX.voiceover;

const Fields = z.object({
  // Naskah opsional: hanya untuk ejaan teks di layar; waktu tetap dari Whisper
  script: z.string().trim().max(VO.maxScriptChars).optional(),
  // Brief pertama: motion dibuat setelah voice over selesai diproses
  next: z.object({
    prompt: z.string().trim().min(1).max(CREATIVE.maxPromptChars), model: z.string().max(80).optional(),
    // Fase 19 (Opinion Motion): sesudah suara, riset aset dulu (provider pilihan pengguna); motion dibuat setelah aset dipilih
    assets: z.object({ provider: z.enum(["claude", "codex"]), model: z.string().max(80).optional() }).optional(),
    // Fase 22: video referensi gaya untuk motion yang dibuat sesudah suara selesai
    reference: ReferenceInput.optional(),
  }).optional(),
});

/** Unggah voice over yang sudah jadi (multipart: file, script?, next? sebagai JSON). Worker mencatat waktu katanya; voice over lama tetap aktif sampai selesai. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Tidak ada file" }, { status: 400 });
  const ext = voiceoverUploadExt(file.name, file.type);
  if (!ext) return NextResponse.json({ error: "Jenis file belum didukung. Pakai MP3, M4A, WAV, AAC, atau OGG." }, { status: 400 });
  if (file.size > VO.upload.maxBytes) return NextResponse.json({ error: `File terlalu besar (maks. ${Math.round(VO.upload.maxBytes / 1048576)} MB).` }, { status: 400 });
  let next: unknown;
  try { next = form?.get("next") ? JSON.parse(String(form.get("next"))) : undefined; } catch { return NextResponse.json({ error: "Data motion tidak valid." }, { status: 400 }); }
  const fields = Fields.safeParse({ script: form?.get("script") ? String(form.get("script")) : undefined, next });
  if (!fields.success) return NextResponse.json({ error: `Naskah maks. ${VO.maxScriptChars} karakter.` }, { status: 400 });
  if (fields.data.next?.model && !isAllowedModel("claude", fields.data.next.model)) return NextResponse.json({ error: "Model AI tidak dikenal." }, { status: 400 });
  if (fields.data.next?.assets?.model && !isAllowedModel(fields.data.next.assets.provider, fields.data.next.assets.model)) return NextResponse.json({ error: "Model riset tidak dikenal." }, { status: 400 });

  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("kind").eq("id", id).maybeSingle();
  if (!project || project.kind !== "motion") return NextResponse.json({ error: "Project motion graphics tidak ditemukan" }, { status: 404 });

  const fileId = `${randomUUID()}${ext}`;
  const dest = voiceoverUploadPath(id, fileId);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, Buffer.from(await file.arrayBuffer()));
  const fileName = path.basename(file.name).replace(/[\u0000-\u001f]/g, "").slice(0, 120) || "voice over";
  const nextJob = await nextWithReference(id, fields.data.next);
  if (nextJob instanceof Response) { await fs.promises.rm(dest, { force: true }).catch(() => {}); return nextJob; }
  const { data: job, error } = await db.from("jobs").insert({ project_id: id, type: "voiceover", payload: { upload: { fileId, fileName }, ...fields.data, ...(nextJob ? { next: nextJob } : {}) } }).select("id").single();
  if (error) {
    await fs.promises.rm(dest, { force: true });
    if (error.code === "23505") return NextResponse.json({ error: "Voice over sedang dibuat" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, jobId: job.id }, { status: 201 });
}
