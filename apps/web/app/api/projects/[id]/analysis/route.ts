import { NextResponse } from "next/server";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

/** Daftar run + usulan dari satu run (bawaan: run selesai terbaru) + EDL terbaru. */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const wanted = new URL(req.url).searchParams.get("runId");
  const db = createAdminClient();

  const { data: runs, error } = await db
    .from("analysis_runs")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const selected = wanted
    ? (runs ?? []).find((r) => r.id === wanted)
    : (runs ?? []).find((r) => r.status === "done") ?? (runs ?? [])[0];

  let suggestions: unknown[] = [];
  if (selected) {
    const { data } = await db
      .from("cut_suggestions")
      .select("*")
      .eq("run_id", selected.id)
      .order("start_s", { ascending: true });
    suggestions = data ?? [];
  }

  const { data: edl } = await db
    .from("edl")
    .select("*")
    .eq("project_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: job } = await db
    .from("jobs")
    .select("status,progress,error")
    .eq("project_id", id)
    .eq("type", "analyze")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: renderJob } = await db
    .from("jobs")
    .select("status,progress,error,payload")
    .eq("project_id", id)
    .eq("type", "render")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: outputs } = await db
    .from("assets")
    .select("id,edl_id,size_bytes,duration_s,width,height,fps,created_at,storage_path")
    .eq("project_id", id)
    .eq("kind", "output")
    .order("created_at", { ascending: false });

  return NextResponse.json({
    runs: runs ?? [],
    selectedRunId: selected?.id ?? null,
    suggestions,
    edl,
    analyzeJob: job,
    renderJob,
    outputs: outputs ?? [],
  });
}
