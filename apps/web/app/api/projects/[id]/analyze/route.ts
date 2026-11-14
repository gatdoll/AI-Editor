import { NextResponse } from "next/server";
import { loadReel } from "@app/shared/reel-db";
import { z } from "zod";
import { ANALYSIS, isAllowedModel } from "@app/config";
import { Provider, createAdminClient } from "@app/shared";
import { keptSegments } from "../../../../../lib/kept-segments.ts";

/** Potongan yang berlaku (trim yang sudah dilakukan user tidak ikut ditranskrip); undefined = seluruh video. */
async function keptOrAll(db: ReturnType<typeof createAdminClient>, id: string) {
  const plan = await keptSegments(db, id);
  return "error" in plan ? undefined : plan.segments;
}

type Ctx = { params: Promise<{ id: string }> };

// model: id dari AI_MODELS ("" = bawaan akun CLI). Tidak dikirim = model awal Auto cut di config.
const Body = z.object({ provider: Provider, model: z.string().max(64).optional() });

/** Mulai analisis cut dengan provider pilihan. Tiap analisis = satu run baru; hasil lama tidak ditimpa. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "provider harus 'claude' atau 'codex'" }, { status: 400 });
  const { provider } = parsed.data;
  const model = parsed.data.model ?? ANALYSIS.defaultModel[provider];
  if (!isAllowedModel(provider, model)) return NextResponse.json({ error: `Model ${model} tidak tersedia untuk ${provider}` }, { status: 400 });
  const withModel = model ? { model } : {};

  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("status").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  if (project.status !== "ready") {
    return NextResponse.json({ error: project.status === "transcribing" || project.status === "analyzing" ? "Transkrip atau analisis sedang berjalan. Tunggu sampai selesai." : "Video belum siap (masih diunggah atau disiapkan)." }, { status: 409 });
  }

  // Fase 16: transkrip dan analisis milik video utama (transkrip dalam waktu reel mencakup semua video)
  const asset = (await loadReel(db, id)).primary;
  if (!asset) return NextResponse.json({ error: "Belum ada video" }, { status: 409 });

  // Provider harus siap menurut laporan worker
  const { data: st } = await db.from("app_status").select("value").eq("key", "analyzers").maybeSingle();
  const info = st?.value?.[provider];
  if (info && !(info.installed && info.loggedIn)) {
    return NextResponse.json({ error: `${provider === "claude" ? "Claude Code CLI" : "Codex CLI"} belum siap: ${info.detail}` }, { status: 409 });
  }

  const { data: active } = await db.from("jobs").select("id").eq("project_id", id).eq("type", "analyze").in("status", ["queued", "running"]).limit(1);
  if (active && active.length > 0) return NextResponse.json({ error: "Analisis sedang berjalan" }, { status: 409 });

  const { data: run, error: runErr } = await db
    .from("analysis_runs")
    .insert({ project_id: id, asset_id: asset.id, provider, status: "queued" })
    .select("id")
    .single();
  if (runErr || !run) return NextResponse.json({ error: runErr?.message ?? "Gagal membuat run" }, { status: 500 });

  // Fase 12: transkrip dibuat saat diminta. Belum ada = buat dulu, lalu worker melanjutkan ke analisis.
  const { count: hasTranscript } = await db.from("transcripts").select("id", { count: "exact", head: true }).eq("asset_id", asset.id);
  const { error: jobErr } = hasTranscript
    ? await db.from("jobs").insert({ project_id: id, type: "analyze", payload: { assetId: asset.id, runId: run.id, provider, ...withModel } })
    : await db.from("jobs").insert({ project_id: id, type: "transcribe", payload: { assetId: asset.id, segments: await keptOrAll(db, id), next: { type: "analyze", runId: run.id, provider, ...withModel } } });
  if (!jobErr) await db.from("projects").update({ status: hasTranscript ? "analyzing" : "transcribing" }).eq("id", id);
  if (jobErr) {
    await db.from("analysis_runs").delete().eq("id", run.id); // jangan tinggalkan run yatim
    // 23505 = indeks unik: permintaan lain yang bersamaan sudah membuat job aktif
    if (jobErr.code === "23505") return NextResponse.json({ error: "Analisis sedang berjalan" }, { status: 409 });
    return NextResponse.json({ error: jobErr.message }, { status: 500 });
  }

  return NextResponse.json({ runId: run.id }, { status: 201 });
}
