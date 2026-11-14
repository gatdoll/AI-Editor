import { NextResponse } from "next/server";
import { createAdminClient } from "@app/shared";

/** Ketersediaan Claude Code CLI dan Codex CLI, ditulis worker ke tabel app_status. */
export async function GET() {
  const db = createAdminClient();
  const { data, error } = await db.from("app_status").select("value,updated_at").eq("key", "analyzers").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ analyzers: null, stale: true });
  const ageMs = Date.now() - new Date(data.updated_at).getTime();
  // Worker memperbarui tiap 2 menit; lebih dari 6 menit = worker kemungkinan mati
  return NextResponse.json({ analyzers: data.value, stale: ageMs > 6 * 60 * 1000 });
}
