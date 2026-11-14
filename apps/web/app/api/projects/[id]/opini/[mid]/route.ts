import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { OPINION } from "@app/config";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { candidateRel, chooseCandidate, loadOpinion, releaseMention, saveOpinion } from "@app/shared/opinion-store";

type Ctx = { params: Promise<{ id: string; mid: string }> };
const uuid = z.string().uuid();
const mentionId = z.string().regex(/^m\d{1,3}$/);

/** Selama riset berjalan, worker menulis status di akhir: keputusan pengguna ditunda agar tidak tertimpa. */
async function researchRunning(id: string): Promise<boolean> {
  const { count } = await createAdminClient().from("jobs").select("id", { count: "exact", head: true }).eq("project_id", id).eq("type", "assets").in("status", ["queued", "running"]);
  return (count ?? 0) > 0;
}

const Patch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pilih"), candidateId: z.string().min(1).max(40) }),
  z.object({ action: z.literal("tidak-dipakai") }),
  z.object({ action: z.literal("ulang") }),
]);

/** Fase 19: keputusan pengguna untuk satu sebutan. Pilih = kandidat disalin menjadi bahan project; selain itu bahan dilepas. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, mid } = await params;
  if (!uuid.safeParse(id).success || !mentionId.safeParse(mid).success) return NextResponse.json({ error: "Tidak valid" }, { status: 400 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Aksi tidak valid" }, { status: 400 });
  if (await researchRunning(id)) return NextResponse.json({ error: "Riset aset sedang berjalan. Pilih aset setelah selesai." }, { status: 409 });
  const state = loadOpinion(id);
  const m = state?.mentions.find((x) => x.id === mid);
  if (!state || !m) return NextResponse.json({ error: "Sebutan tidak ditemukan" }, { status: 404 });
  const db = createAdminClient();
  try {
    if (parsed.data.action === "pilih") await chooseCandidate(db, id, m, parsed.data.candidateId);
    else { await releaseMention(db, id, m); m.status = parsed.data.action === "ulang" ? "pending" : "tidak-dipakai"; }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal" }, { status: 422 });
  }
  await saveOpinion(id, state);
  return NextResponse.json({ state });
}

const IMAGE_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };

/** Unggah gambar sendiri untuk satu sebutan (multipart: file, width?, height?): jadi kandidat "unggahan" dan langsung dipilih. */
export async function POST(req: Request, { params }: Ctx) {
  const { id, mid } = await params;
  if (!uuid.safeParse(id).success || !mentionId.safeParse(mid).success) return NextResponse.json({ error: "Tidak valid" }, { status: 400 });
  if (await researchRunning(id)) return NextResponse.json({ error: "Riset aset sedang berjalan. Unggah setelah selesai." }, { status: 409 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Tidak ada file" }, { status: 400 });
  const ext = IMAGE_EXT[file.type];
  if (!ext) return NextResponse.json({ error: "Pakai gambar PNG, JPG, atau WebP." }, { status: 400 });
  if (file.size > OPINION.image.maxBytes) return NextResponse.json({ error: `Gambar terlalu besar (maks. ${Math.round(OPINION.image.maxBytes / 1048576)} MB).` }, { status: 400 });
  const state = loadOpinion(id);
  const m = state?.mentions.find((x) => x.id === mid);
  if (!state || !m) return NextResponse.json({ error: "Sebutan tidak ditemukan" }, { status: 404 });
  const num = (k: string) => { const n = Number(form?.get(k)); return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined; };
  const cid = randomUUID().slice(0, 8);
  const rel = candidateRel(id, mid, cid, ext);
  const dest = resolveMediaPath(rel);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.writeFile(dest, Buffer.from(await file.arrayBuffer()));
  const label = path.basename(file.name).replace(/[\u0000-\u001f]/g, "").slice(0, 80);
  // Sumber unggahan sendiri tidak diketahui sistem: kredit memakai teks yang diisi pengguna (bila ada)
  const source = String(form?.get("source") ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60);
  m.candidates.unshift({ id: cid, kind: "unggahan", file: rel, mime: file.type, ...(num("width") ? { width: num("width"), height: num("height") } : {}), source, alasan: `Unggahan pengguna: ${label}` });
  try {
    await chooseCandidate(createAdminClient(), id, m, cid);
  } catch (e) {
    await fs.promises.rm(dest, { force: true });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal" }, { status: 422 });
  }
  delete m.error;
  await saveOpinion(id, state);
  return NextResponse.json({ state }, { status: 201 });
}
