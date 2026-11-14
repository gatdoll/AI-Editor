// Fase 19: status riset aset Opinion Motion. Disimpan sebagai file samping (projects/<id>/opini/state.json), bukan tabel:
// tidak perlu migrasi. Kandidat ada di projects/<id>/opini/kandidat/; yang DIPILIH pengguna disalin menjadi bahan project
// (assets kind 'material') agar seluruh jalur motion yang ada (folder kerja AI, still, render) memakainya. Hanya Node.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMediaPath } from "./index.ts";
import { setRole } from "./material-roles.ts";
import { assetCues, type AssetCue, type Mention, type OpinionState } from "./opinion.ts";
import { loadVoiceover } from "./voiceover-store.ts";

export const opinionRel = (projectId: string) => `projects/${projectId}/opini`;
const stateRel = (projectId: string) => `${opinionRel(projectId)}/state.json`;
export const candidateRel = (projectId: string, mentionId: string, candidateId: string, ext: string) => `${opinionRel(projectId)}/kandidat/${mentionId}/${candidateId}${ext}`;

/** Path relatif yang sah untuk disajikan: hanya berkas di folder kandidat project ini (mencegah path traversal). */
export function isCandidatePath(projectId: string, rel: string): boolean {
  const norm = path.posix.normalize(rel.replaceAll("\\", "/"));
  return norm === rel && norm.startsWith(`${opinionRel(projectId)}/kandidat/`) && !norm.includes("..");
}

export function loadOpinion(projectId: string): OpinionState | null {
  const file = resolveMediaPath(stateRel(projectId));
  if (!fs.existsSync(file)) return null;
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8")) as OpinionState;
    return s?.version === 1 && Array.isArray(s.mentions) ? s : null;
  } catch { return null; }
}

export async function saveOpinion(projectId: string, s: OpinionState): Promise<void> {
  const file = resolveMediaPath(stateRel(projectId));
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  // Tulis ke berkas sementara lalu ganti nama: pembaca (web/worker) tidak pernah melihat JSON setengah jadi
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2));
  await fs.promises.rename(tmp, file);
}

/** Lepas bahan hasil pilihan sebelumnya (baris + berkas). Kandidatnya tetap ada untuk dipilih lagi. */
export async function releaseMention(db: SupabaseClient, projectId: string, m: Mention): Promise<void> {
  if (m.assetId) {
    const { data: row } = await db.from("assets").select("storage_path").eq("id", m.assetId).eq("project_id", projectId).eq("kind", "material").maybeSingle();
    if (row) {
      await db.from("assets").delete().eq("id", m.assetId);
      await fs.promises.rm(resolveMediaPath(row.storage_path), { force: true });
    }
    await setRole(projectId, m.assetId, null);
  }
  delete m.assetId;
  delete m.chosen;
}

/** Salin kandidat ke bahan project dan tandai sebutan "dipilih". Brand = logo (dipakai apa adanya, aturan Fase 15). */
export async function chooseCandidate(db: SupabaseClient, projectId: string, m: Mention, candidateId: string): Promise<void> {
  const c = m.candidates.find((x) => x.id === candidateId);
  if (!c?.file || c.error) throw new Error("Kandidat ini tidak bisa dipakai.");
  if (!isCandidatePath(projectId, c.file)) throw new Error("Berkas kandidat tidak sah.");
  const src = resolveMediaPath(c.file);
  if (!fs.existsSync(src)) throw new Error("Berkas kandidat sudah tidak ada. Jalankan riset ulang untuk sebutan ini.");
  await releaseMention(db, projectId, m);
  const assetId = randomUUID();
  const ext = path.extname(c.file);
  const rel = `projects/${projectId}/materials/${assetId}${ext}`;
  const dest = resolveMediaPath(rel);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(src, dest);
  const size = (await fs.promises.stat(dest)).size;
  const kind = c.kind === "screenshot" ? "screenshot" : m.type;
  const { error } = await db.from("assets").insert({
    id: assetId, project_id: projectId, kind: "material", storage_bucket: "local", storage_path: rel, size_bytes: size,
    label: `${m.label} (${kind}, ${c.source})`.slice(0, 120), mime: c.mime ?? (ext === ".png" ? "image/png" : ext === ".svg" ? "image/svg+xml" : "image/jpeg"),
    width: c.width ?? null, height: c.height ?? null,
  });
  if (error) { await fs.promises.rm(dest, { force: true }); throw new Error(error.message); }
  await setRole(projectId, assetId, m.type === "brand" ? "logo" : "gambar");
  m.assetId = assetId;
  m.chosen = c.id;
  m.status = "dipilih";
}

/**
 * Selaraskan status dengan bahan yang benar-benar ada: bahan yang dihapus pengguna dari panel Bahan membuat sebutannya
 * kembali "pending" (bukan diam-diam dianggap terpakai). Mengembalikan true bila ada yang berubah.
 */
export function reconcile(s: OpinionState, materialIds: Set<string>): boolean {
  let changed = false;
  for (const m of s.mentions) {
    if (m.status === "dipilih" && (!m.assetId || !materialIds.has(m.assetId))) {
      delete m.assetId; delete m.chosen; m.status = "pending"; changed = true;
    }
  }
  return changed;
}

/**
 * Isyarat aset per id bahan untuk project ini (voice over aktif sebagai dasar waktu). Dipakai rute bahan web (pratinjau)
 * DAN worker (brief, still, render), agar `data.assets[i].cue` sama persis di semua tempat.
 */
export function opinionCues(projectId: string): Map<string, AssetCue> {
  return assetCues(loadOpinion(projectId), loadVoiceover(projectId)?.jobId);
}
