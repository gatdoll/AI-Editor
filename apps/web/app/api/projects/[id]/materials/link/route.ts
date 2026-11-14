import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { MOTION_GFX } from "@app/config";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { fetchKnowledge } from "../../../../../../lib/fetch-knowledge";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Fase 13: tambahkan link sebagai knowledge. Server mengambil halamannya SEKALI (agen AI tidak punya jaringan),
 * menyimpannya sebagai Markdown (atau PDF bila link-nya PDF), lalu dicatat sebagai bahan project.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = z.object({ url: z.string().trim().min(8).max(2000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Tempel link lengkap (https://...)." }, { status: 400 });
  const db = createAdminClient();
  const { count } = await db.from("assets").select("id", { count: "exact", head: true }).eq("project_id", id).eq("kind", "material");
  if ((count ?? 0) >= MOTION_GFX.materials.max) return NextResponse.json({ error: `Maksimal ${MOTION_GFX.materials.max} bahan per project.` }, { status: 409 });
  let got;
  try { got = await fetchKnowledge(parsed.data.url); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Link gagal diambil" }, { status: 422 }); }

  const assetId = randomUUID();
  const isPdf = got.kind === "pdf";
  const rel = `projects/${id}/materials/${assetId}${isPdf ? ".pdf" : ".md"}`;
  const dest = resolveMediaPath(rel);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const bytes = got.kind === "pdf" ? got.bytes : Buffer.from(`# ${got.title}\n\nSumber: ${got.url}\n\n${got.text}`.slice(0, MOTION_GFX.knowledge.maxTextChars), "utf8");
  await fs.promises.writeFile(dest, bytes);
  const label = `${got.title.replace(/[\u0000-\u001f]/g, "").slice(0, 100)} (link)`;
  const { data, error } = await db.from("assets").insert({
    id: assetId, project_id: id, kind: "material", storage_bucket: "local", storage_path: rel, size_bytes: bytes.length,
    label, mime: isPdf ? "application/pdf" : "text/markdown",
  }).select("id,label,mime,size_bytes,width,height,duration_s,created_at").single();
  if (error) { await fs.promises.rm(dest, { force: true }); return NextResponse.json({ error: error.message }, { status: 500 }); }
  return NextResponse.json({ material: data, source: got.url }, { status: 201 });
}
