import { NextResponse } from "next/server";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

/** Ringan: EDL terbaru, status render terakhir, dan hasil render. Dipakai editor untuk polling. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = createAdminClient();

  const { data: edl } = await db.from("edl").select("id,version,run_id,segments,params,created_at").eq("project_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: renderJob } = await db
    .from("jobs")
    .select("status,progress,error,payload,started_at,finished_at")
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
    .order("created_at", { ascending: false })
    .limit(20);
  return NextResponse.json({ edl, renderJob, outputs: outputs ?? [] });
}
