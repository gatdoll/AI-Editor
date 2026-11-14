import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { FONT_LIBRARY, MOTION_GFX } from "@app/config";
import { createAdminClient, resolveMediaPath } from "@app/shared";
import { isDesignSystem, loadRoles, roleOf, setRole } from "@app/shared/material-roles";
import { opinionCues } from "@app/shared/opinion-store";
import { ownCues } from "@app/shared/own-assets-store";
import { loadNotes, setNote } from "@app/shared/material-notes";
import { withRigs } from "@app/shared/rig-store";

type Ctx = { params: Promise<{ id: string }> };

/** Fase 13: bahan motion graphics (logo, gambar, musik/voice over) milik project. Fase 15: juga gambar/logo untuk Mode Kreatif project video; gambar membawa `role`. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const { data, error } = await createAdminClient().from("assets").select("id,label,mime,size_bytes,width,height,duration_s,created_at").eq("project_id", id).eq("kind", "material").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const roles = loadRoles(id);
  // Fase 19: isyarat aset Opinion Motion ikut dikirim agar pratinjau memberi kode AI data yang sama dengan render.
  // Fase 21: isyarat aset sendiri (detik video mentah; pratinjau memetakannya ke timeline lewat buildEditedProps) + keterangan.
  const cues = opinionCues(id);
  const own = ownCues(id, data ?? []);
  const notes = loadNotes(id);
  // Fase 25: rig karakter ikut dikirim agar pratinjau menggerakkan karakter sama dengan render
  return NextResponse.json({ materials: withRigs(id, (data ?? []).map((m) => {
    const note = notes[m.id] ? { note: notes[m.id] } : {};
    if (!String(m.mime ?? "").startsWith("image/")) return isDesignSystem(roles, m) ? { ...m, role: "design" } : m;
    const cue = cues.get(m.id) ?? own.get(m.id);
    return { ...m, ...note, role: roleOf(roles, m), ...(cue ? { cue } : {}) };
  })) });
}

/**
 * Unggah satu bahan (multipart: file, dan opsional width/height/durationS yang dibaca browser).
 * Disimpan di projects/<id>/materials/ (bukan file mentah video; boleh dihapus pengguna).
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Project tidak valid" }, { status: 400 });
  const db = createAdminClient();
  const { data: project } = await db.from("projects").select("kind").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
  const { count } = await db.from("assets").select("id", { count: "exact", head: true }).eq("project_id", id).eq("kind", "material");
  if ((count ?? 0) >= MOTION_GFX.materials.max) return NextResponse.json({ error: `Maksimal ${MOTION_GFX.materials.max} bahan per project.` }, { status: 409 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Tidak ada file" }, { status: 400 });
  // Browser sering tidak memberi tipe untuk .md/.txt: tentukan dari ekstensi
  const ext0 = path.extname(file.name).toLowerCase();
  // Fase 24: font (browser memberi tipe yang tidak seragam untuk font): tipe ditentukan dari ekstensi
  const fontMime = (FONT_LIBRARY.mimes as Record<string, string>)[ext0];
  const mime = fontMime ?? (file.type || (ext0 === ".md" ? "text/markdown" : ext0 === ".txt" ? "text/plain" : ext0 === ".pdf" ? "application/pdf" : "application/octet-stream"));
  const knowledge = (MOTION_GFX.knowledge.mimes as readonly string[]).includes(mime);
  const allowed = [...MOTION_GFX.materials.image, ...MOTION_GFX.materials.audio, ...MOTION_GFX.knowledge.mimes, ...Object.values(FONT_LIBRARY.mimes)] as string[];
  if (!allowed.includes(mime)) return NextResponse.json({ error: `Jenis file ${mime} belum didukung. Gambar: PNG/JPG/WebP/SVG. Audio: MP3/M4A/WAV. Knowledge: PDF/TXT/MD. Font: TTF/OTF/WOFF/WOFF2.` }, { status: 400 });
  const maxBytes = mime === "application/pdf" ? MOTION_GFX.knowledge.maxPdfBytes : fontMime ? FONT_LIBRARY.maxUploadBytes : MOTION_GFX.materials.maxBytes;
  if (file.size > maxBytes) return NextResponse.json({ error: `File terlalu besar (maks. ${Math.round(maxBytes / 1048576)} MB).` }, { status: 400 });

  // Design system (PDF) untuk Mode Kreatif: peran disimpan saat unggah, agar tidak sempat dianggap knowledge
  const asDesign = form?.get("role") === "design";
  if (asDesign && mime !== "application/pdf") return NextResponse.json({ error: "Design system harus berupa PDF." }, { status: 400 });
  const label = path.basename(file.name).replace(/[\u0000-\u001f]/g, "").slice(0, 120) || "bahan";
  const assetId = randomUUID();
  const ext = path.extname(label).toLowerCase().replace(/[^.\w]/g, "").slice(0, 6);
  const rel = `projects/${id}/materials/${assetId}${ext}`;
  const dest = resolveMediaPath(rel);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  let bytes = Buffer.from(await file.arrayBuffer());
  // Teks knowledge dibatasi agar muat dibaca AI bersama brief
  if (knowledge && mime !== "application/pdf") bytes = Buffer.from(bytes.toString("utf8").slice(0, MOTION_GFX.knowledge.maxTextChars), "utf8");
  await fs.promises.writeFile(dest, bytes);
  const num = (k: string) => { const v = Number(form?.get(k)); return Number.isFinite(v) && v > 0 ? v : null; };
  const { data, error } = await db.from("assets").insert({
    id: assetId, project_id: id, kind: "material", storage_bucket: "local", storage_path: rel, size_bytes: file.size,
    label, mime, width: num("width") && Math.round(num("width")!), height: num("height") && Math.round(num("height")!), duration_s: num("durationS"),
  }).select("id,label,mime,size_bytes,width,height,duration_s,created_at").single();
  if (error) {
    await fs.promises.rm(dest, { force: true });
    const hint = /kind|label|mime/.test(error.message) ? " Jalankan supabase/migrations/20261029150000_fase13_motion.sql." : "";
    return NextResponse.json({ error: `Gagal menyimpan bahan: ${error.message}.${hint}` }, { status: 500 });
  }
  if (asDesign) await setRole(id, assetId, "design");
  // Fase 21: keterangan diisi saat unggah (opsional)
  const note = form?.get("note");
  const savedNote = typeof note === "string" && note.trim() && mime.startsWith("image/") ? await setNote(id, assetId, note) : "";
  return NextResponse.json({ material: String(data.mime ?? "").startsWith("image/") ? { ...data, role: roleOf(loadRoles(id), data), ...(savedNote ? { note: savedNote } : {}) } : asDesign ? { ...data, role: "design" } : data }, { status: 201 });
}
