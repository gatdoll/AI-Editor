import { NextResponse } from "next/server";
import { loadReel } from "@app/shared/reel-db";
import { arrangeSegments } from "@app/shared/reel";
import { z } from "zod";
import { createAdminClient } from "@app/shared";
import { normalizeStyle } from "@app/remotion/src/build-props.ts";
import { stableStringify } from "@app/shared/prompt-undo";
import { ManualSchema, manualSegments } from "@app/shared/manual";
import { SubtitlesSchema } from "@app/shared/subtitles";
import { loadCreativeCode, syncActiveCreative } from "@app/shared/creative-store";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ style: z.record(z.string(), z.unknown()), baseStyle: z.record(z.string(), z.unknown()).optional() });

/** Simpan gaya video project (satu sumber kebenaran untuk editor dan perintah prompt). Nilai tidak valid dinormalkan. */
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  if (parsed.data.style.manual !== undefined && !ManualSchema.safeParse(parsed.data.style.manual).success) return NextResponse.json({ error: "Edit manual tidak valid atau melebihi batas." }, { status: 400 });
  // Subtitle yang tidak sah dinormalkan menjadi "otomatis" = semua edit subtitle hilang diam-diam. Tolak saja.
  if (parsed.data.style.subtitles != null && !SubtitlesSchema.safeParse(parsed.data.style.subtitles).success) return NextResponse.json({ error: "Subtitle tidak valid atau melebihi batas." }, { status: 400 });
  const style = normalizeStyle(parsed.data.style as never);
  const db = createAdminClient();
  // Mode Kreatif: hanya versi sah milik project ini yang boleh diaktifkan (versi ditolak harus dipulihkan dulu)
  if (style.creativeId) {
    const loaded = await loadCreativeCode(db, id, style.creativeId);
    if (!loaded.ok) return NextResponse.json({ error: `Versi kreatif tidak bisa diaktifkan: ${loaded.error}` }, { status: loaded.httpStatus === 500 ? 500 : 400 });
    if (loaded.status === "ditolak") return NextResponse.json({ error: "Versi kreatif ini sudah ditolak. Pulihkan dulu sebelum mengaktifkannya." }, { status: 409 });
  }
  const { data: activePrompt } = await db.from("jobs").select("id").eq("project_id", id).eq("type", "prompt").in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (activePrompt) return NextResponse.json({ error: "AI sedang mengedit project ini. Tunggu selesai, lalu muat versi terbaru." }, { status: 409 });
  const { data: project } = await db.from("projects").select("style,updated_at").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  if (parsed.data.baseStyle && stableStringify(normalizeStyle(project.style)) !== stableStringify(normalizeStyle(parsed.data.baseStyle as never))) return NextResponse.json({ error: "Project berubah di proses lain. Muat versi terbaru sebelum melanjutkan.", style: normalizeStyle(project.style) }, { status: 409 });
  // Fase 16: durasi = panjang sumbu reel (semua video)
  const reel = await loadReel(db, id);
  const duration = reel.durationS;
  if (duration > 0 && (style.manual?.cuts.some((c) => c.end > duration + 0.001) || style.manual?.splits.some((t) => t >= duration) || style.manual?.keyframes.some((k) => k.time > duration) || style.manual?.keeps.some((k) => k.end > duration + 0.001) || style.subtitles?.clips.some((c) => c.start >= duration))) return NextResponse.json({ error: "Edit manual melewati durasi video." }, { status: 400 });
  if (duration > 0 && !arrangeSegments(manualSegments([{ start: 0, end: duration }], style.manual), reel.clips, style.reelOrder, style.reelHidden).length) return NextResponse.json({ error: "Sisakan minimal satu bagian video." }, { status: 400 });
  let query = db.from("projects").update({ style }).eq("id", id);
  // Kunci konkurensi: updated_at baris yang baru dibaca (gaya sudah dibandingkan di atas). Membandingkan isi gaya lewat
  // filter URL gagal untuk gaya besar (puluhan klip subtitle): URL terlalu panjang -> "Bad Request" dari Supabase.
  if (parsed.data.baseStyle) query = query.eq("updated_at", project.updated_at);
  const { data, error } = await query.select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Project baru saja berubah. Muat ulang sebelum menyimpan." }, { status: 409 });
  // Status versi mengikuti gaya yang baru tersimpan. Gagal di sini tidak membatalkan gaya (gaya = sumber kebenaran), tapi dilaporkan.
  const syncError = await syncActiveCreative(db, id, style.creativeId);
  if (syncError) console.error("[style] status versi kreatif tidak sinkron:", syncError);
  return NextResponse.json({ style });
}
