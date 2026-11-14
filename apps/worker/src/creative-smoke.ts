// Uji ujung-ke-ujung job 'creative' pada project sungguhan, tanpa UI (UI di Fase 9.4).
// Pakai: npm run creative-smoke -w @app/worker -- <projectId> "<prompt>" [model]
// Membuat baris job 'running' (tidak diambil worker lain), menjalankan handler, lalu mencatat hasilnya di job.
// Project, EDL, dan file mentah hanya dibaca. Versi hasil berstatus 'draft' (tidak aktif).
import { createAdminClient, type JobRow } from "@app/shared";
import { handleCreative } from "./creative/handler.ts";

const [projectId, prompt, model] = process.argv.slice(2);
if (!projectId || !prompt) {
  console.error('Pakai: npm run creative-smoke -w @app/worker -- <projectId> "<prompt>" [model]');
  process.exit(1);
}
const db = createAdminClient();
const { data: job, error } = await db
  .from("jobs")
  .insert({ project_id: projectId, type: "creative", status: "running", started_at: new Date().toISOString(), payload: { prompt, ...(model ? { model } : {}) } })
  .select("*")
  .single();
if (error || !job) {
  console.error("Gagal membuat job:", error?.message ?? "?");
  process.exit(1);
}
console.log(`[kreatif] job ${job.id}. Batalkan dari SQL Editor: update jobs set status='cancelled' where id='${job.id}';`);
const t0 = Date.now();
try {
  await handleCreative(job as JobRow, {
    db,
    setProgress: async (f) => {
      await db.from("jobs").update({ progress: f }).eq("id", job.id);
    },
  });
  await db.from("jobs").update({ status: "done", progress: 1, finished_at: new Date().toISOString() }).eq("id", job.id).eq("status", "running");
  const { data } = await db.from("jobs").select("payload").eq("id", job.id).single();
  const versionId = (data?.payload as { creativeVersionId?: string })?.creativeVersionId;
  const { data: v } = await db.from("creative_versions").select("id,model,stills,notes,replaces_captions,skill_refs").eq("id", versionId ?? "").maybeSingle();
  console.log(`[kreatif] SELESAI dalam ${((Date.now() - t0) / 1000).toFixed(0)} dtk:`, JSON.stringify(v, null, 2));
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  await db.from("jobs").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", job.id).eq("status", "running");
  console.error(`[kreatif] GAGAL setelah ${((Date.now() - t0) / 1000).toFixed(0)} dtk: ${message}`);
  process.exitCode = 1;
}
