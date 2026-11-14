// Server-only: references are stored outside the immutable raw/ directory.
import path from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import { resolveMediaPath } from "./index.ts";
import { referenceUrl, type ReferenceAttachment, type ReferenceInput } from "./reference.ts";

const uuid = z.string().uuid();
const Meta = z.object({
  id: uuid, projectId: uuid, kind: z.enum(["upload", "link"]), label: z.string().max(300),
  file: z.string().regex(/^source\.(mp4|mov|mkv|webm|m4v)$/).optional(),
  url: z.string().optional(), size: z.number().int().nonnegative().optional(),
});
export type ReferenceMeta = z.infer<typeof Meta>;
export function referenceDir(projectId: string, id: string) {
  uuid.parse(projectId); uuid.parse(id);
  return resolveMediaPath(`projects/${projectId}/references/${id}`);
}
export async function saveReference(meta: ReferenceMeta) {
  Meta.parse(meta);
  const dir = referenceDir(meta.projectId, meta.id);
  await mkdir(dir, { recursive: true });
  const partPath = path.join(dir, `meta-${crypto.randomUUID()}.part`);
  await writeFile(partPath, JSON.stringify(meta), { flag: "wx" });
  await rename(partPath, path.join(dir, "meta.json"));
}
export async function loadReference(projectId: string, id: string): Promise<ReferenceMeta> {
  const meta = Meta.parse(JSON.parse(await readFile(path.join(referenceDir(projectId, id), "meta.json"), "utf8")));
  if (meta.projectId !== projectId || meta.id !== id) throw new Error("Referensi tidak dimiliki project ini.");
  if (meta.kind === "link") referenceUrl(meta.url ?? "");
  if (meta.kind === "upload" && !meta.file) throw new Error("Unggahan referensi belum selesai.");
  return meta;
}

/**
 * Masukan referensi dari browser -> lampiran job. Unggahan harus milik project ini; link dikanonikkan dan dicatat.
 * Dipakai Prompt Cepat dan Mode Kreatif/Motion (Fase 22). Gagal = Error dengan pesan untuk pengguna.
 */
export async function attachReference(projectId: string, input: ReferenceInput): Promise<ReferenceAttachment> {
  const startS = input.startS ?? 0;
  if (input.kind === "upload") {
    const meta = await loadReference(projectId, input.id).catch((e) => { throw (e as NodeJS.ErrnoException)?.code === "ENOENT" ? new Error("Referensi tidak ditemukan di project ini; unggah ulang.") : e; });
    if (meta.kind !== "upload") throw new Error("Referensi unggahan tidak valid.");
    return { id: meta.id, label: meta.label, startS };
  }
  const link = referenceUrl(input.url);
  const refId = crypto.randomUUID();
  await saveReference({ id: refId, projectId, kind: "link", label: `${link.platform} · referensi video`, url: link.url });
  return { id: refId, label: `${link.platform} · referensi video`, url: link.url, startS };
}
