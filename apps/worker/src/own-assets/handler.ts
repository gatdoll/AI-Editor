// Job 'assets' dengan payload.own (Fase 21): cocokkan keterangan aset sendiri dengan transkrip video bicara.
// AI (Claude Code / Codex CLI, tanpa internet, tanpa melihat gambar) mengusulkan rentang kata -> divalidasi skema kita ->
// pengguna memutuskan di tab Aset. Tidak ada aset yang masuk video tanpa disetujui. Tidak cocok = ditandai dengan alasan (aturan 7).
import type { SupabaseClient } from "@supabase/supabase-js";
import { OWN_ASSETS, isAllowedModel } from "@app/config";
import type { JobRow, Provider, Word } from "@app/shared";
import { loadNotes } from "@app/shared/material-notes";
import { loadRoles, roleOf } from "@app/shared/material-roles";
import { checkPlacements, OWN_JSON_SCHEMA, type OwnItem, type OwnState } from "@app/shared/own-assets";
import { imageMaterialRows, loadOwn, saveOwn } from "@app/shared/own-assets-store";
import { loadReel } from "@app/shared/reel-db";
import { runProvider } from "../analyze/providers.ts";
import { activityLog } from "../activity.ts";
import { ownAssetsPrompt } from "./prompt.ts";

type Ctx = { db: SupabaseClient; setProgress: (fraction: number) => Promise<void> };

/** Payload job. `only` = id bahan yang dicocokkan; tanpa `only` = semua gambar yang belum diputuskan. */
export type OwnAssetsPayload = { own: true; provider?: Provider; model?: string; only?: string[] };

export async function handleOwnAssets(job: JobRow, { db, setProgress }: Ctx): Promise<void> {
  const p = job.payload as OwnAssetsPayload;
  const provider: Provider = p.provider === "codex" ? "codex" : "claude";
  const model = typeof p.model === "string" && p.model && isAllowedModel(provider, p.model) ? p.model : OWN_ASSETS.defaultModel[provider] || undefined;
  const { data: project } = await db.from("projects").select("kind").eq("id", job.project_id).single();
  if (project?.kind === "motion") throw new Error("Aset sendiri hanya untuk project video bicara.");
  const reel = await loadReel(db, job.project_id);
  if (!reel.primary) throw new Error("Video mentah tidak ditemukan.");
  // Transkrip TERBARU (termasuk koreksi pengguna), pada sumbu reel: sama dengan yang dipakai Mode Kreatif dan render
  const { data: tr } = await db.from("transcripts").select("words").eq("asset_id", reel.primary.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const words = ((tr?.words ?? []) as Word[]).map((w) => ({ text: w.text, start: w.start, end: w.end }));
  if (!words.length) throw new Error("Transkrip belum ada. Buat transkrip dulu (Auto subtitle / Auto cut), karena tempat aset dicari dari ucapan.");

  const rows = await imageMaterialRows(db, job.project_id);
  const roles = loadRoles(job.project_id);
  const notes = loadNotes(job.project_id);
  const prev = loadOwn(job.project_id);
  const only = Array.isArray(p.only) ? new Set(p.only.filter((x) => typeof x === "string")) : null;
  // Tanpa `only`: gambar yang belum diputuskan (yang sudah dipakai / tidak dipakai pengguna tidak disentuh)
  const targets = rows.filter((r) => (only ? only.has(r.id) : (prev?.items.find((i) => i.assetId === r.id)?.status ?? "pending") === "pending"));
  if (!targets.length) throw new Error(only ? "Aset yang diminta sudah tidak ada." : "Tidak ada aset yang belum diputuskan. Pilih \"Cocokkan ulang\" pada aset tertentu.");

  const act = activityLog(db, job);
  const stage = async (label: string, progress: number) => { act.add(label); await act.patch({ stageLabel: label }); await setProgress(progress); };
  try {
    // Kunci pendek untuk AI (a1, a2, ...): id asli tidak perlu dikirim
    const asked = new Map(targets.map((r, i) => [`a${i + 1}`, r.id]));
    const placed = (prev?.items ?? []).filter((i) => i.status === "dipakai" && i.chosen && !asked.has(i.assetId) && rows.some((r) => r.id === i.assetId));
    const prompt = ownAssetsPrompt({
      words,
      assets: targets.map((r, i) => ({ key: `a${i + 1}`, name: r.label ?? "gambar", note: notes[r.id] ?? "", role: roleOf(roles, r) })),
      occupied: placed.map((i) => ({ name: rows.find((r) => r.id === i.assetId)?.label ?? "gambar", wordStart: i.chosen!.wordStart, wordEnd: i.chosen!.wordEnd })),
    });
    await stage(`AI mencocokkan ${targets.length} aset dengan transkrip (${provider === "claude" ? "Claude Code" : "Codex"})`, 0.1);
    const t0 = Date.now();
    const res = await runProvider(provider, prompt, OWN_JSON_SCHEMA, OWN_ASSETS.timeoutMs, [], model);
    console.log(`[aset-sendiri] ${provider} ${Math.round((Date.now() - t0) / 1000)} dtk, model ${res.model ?? "?"}`);
    const checked = checkPlacements(res.json, words, new Map([...asked].map(([k, id]) => [k, id])));
    const found = [...checked.byAsset.values()].filter((v) => v.options.length).length;
    act.add(`Usulan untuk ${found} dari ${targets.length} aset${checked.dropped.length ? ` (${checked.dropped.length} dibuang validasi)` : ""}`);

    // Pembatalan pengguna: jangan menulis hasil
    const { data: now } = await db.from("jobs").select("status").eq("id", job.id).maybeSingle();
    if (now?.status === "cancelled") throw new Error("Dibatalkan oleh pengguna.");

    // Baca ulang sebelum menulis: pengguna bisa memutuskan aset lain selama job berjalan
    const latest = loadOwn(job.project_id);
    const keep = (latest?.items ?? []).filter((i) => !asked.has(i.assetId) && rows.some((r) => r.id === i.assetId));
    const fresh: OwnItem[] = targets.map((r) => {
      const got = checked.byAsset.get(r.id) ?? { options: [], error: "AI tidak menjawab aset ini." };
      return { assetId: r.id, status: "pending", options: got.options, noteUsed: notes[r.id] ?? "", ...(got.error ? { error: got.error } : {}) };
    });
    // Urutan mengikuti urutan bahan di panel
    const items = rows.flatMap((r) => [...keep, ...fresh].filter((i) => i.assetId === r.id));
    const warnings = [...checked.dropped.map((d) => `Dibuang: ${d}`), ...(checked.catatan ? [`Catatan AI: ${checked.catatan}`] : [])];
    const state: OwnState = { version: 1, provider, model: res.model ?? model ?? null, updatedAt: "", items, warnings };
    await saveOwn(job.project_id, state);
    await stage("Selesai. Periksa usulan di tab Aset.", 0.99);
  } finally {
    await act.flush();
  }
}
