import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedModel } from "@app/config";
import { Provider, createAdminClient } from "@app/shared";
import { ReferenceInput, type ReferenceAttachment } from "@app/shared/reference";
import { attachReference } from "@app/shared/reference-store";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ prompt: z.string().trim().max(2000), provider: Provider, model: z.string().max(80).optional(), reference: ReferenceInput.optional() }).refine((v) => v.prompt.length > 0 || !!v.reference);

/**
 * Kirim perintah (prompt). Diproses worker: AI menerjemahkan jadi operasi, kode kita menjalankannya.
 * Perintah yang memotong hanya membuat USULAN (aturan 2). Satu perintah aktif per project.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.some((issue) => issue.path[0] === "reference") ? "Referensi atau waktu awal tidak valid. Pasang ulang referensinya." : "Isi perintah (maks. 2000 karakter) atau lampirkan referensi, dan pilih provider yang valid." }, { status: 400 });
  const { provider } = parsed.data;
  const prompt = parsed.data.prompt || "Adaptasikan gaya visual referensi ke video saya. Pertahankan rasio, cut, audio, dan isi subtitle. Jangan render dulu.";
  const model = parsed.data.model ?? "";
  if (!isAllowedModel(provider, model)) return NextResponse.json({ error: "Model AI tidak dikenal untuk provider ini." }, { status: 400 });

  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("status").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  if (project.status !== "ready") return NextResponse.json({ error: "Project belum siap (transkrip belum selesai)" }, { status: 409 });

  const { data: st } = await db.from("app_status").select("value").eq("key", "analyzers").maybeSingle();
  const info = st?.value?.[provider];
  if (info && !(info.installed && info.loggedIn)) {
    return NextResponse.json({ error: `${provider === "claude" ? "Claude Code CLI" : "Codex CLI"} belum siap: ${info.detail}` }, { status: 409 });
  }

  let reference: ReferenceAttachment | undefined;
  try {
    if (parsed.data.reference) reference = await attachReference(id, parsed.data.reference);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Referensi tidak ditemukan; unggah ulang." }, { status: 400 });
  }

  const { data: run, error: runErr } = await db.from("prompt_runs").insert({ project_id: id, prompt, provider, status: "queued" }).select("id").single();
  if (runErr || !run) return NextResponse.json({ error: runErr?.message ?? "Gagal menyimpan perintah" }, { status: 500 });

  const { error: jobErr } = await db.from("jobs").insert({ project_id: id, type: "prompt", payload: { promptRunId: run.id, ...(model ? { model } : {}), ...(reference ? { reference } : {}) } });
  if (jobErr) {
    await db.from("prompt_runs").delete().eq("id", run.id);
    if (jobErr.code === "23505") return NextResponse.json({ error: "Perintah sebelumnya masih diproses. Tunggu sampai selesai." }, { status: 409 });
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }
  return NextResponse.json({ promptRunId: run.id }, { status: 201 });
}
