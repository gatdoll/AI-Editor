import { NextResponse } from "next/server";
import { createAdminClient } from "@app/shared";

type Ctx = { params: Promise<{ id: string }> };

/** SEMUA usulan project (analisis Claude, Codex, dan prompt), urut waktu. Editor menampilkannya sebagai satu timeline. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const db = createAdminClient();
  const { data, error } = await db
    .from("cut_suggestions")
    .select("*")
    .eq("project_id", id)
    .order("start_s", { ascending: true })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suggestions: data ?? [] });
}
