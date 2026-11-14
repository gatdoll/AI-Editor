// Fase 17: hasil voice over per project (projects/<id>/voiceover/) dan rekaman suara pengguna (voice-profile/), semuanya file
// di folder media, tanpa kolom tabel. Hanya Node.
import fs from "node:fs";
import path from "node:path";
import { resolveMediaPath } from "./index.ts";
import type { VoiceoverInfo, VoiceProfile } from "./voiceover.ts";

const dirRel = (projectId: string) => `projects/${projectId}/voiceover`;
const infoFile = (projectId: string) => resolveMediaPath(`${dirRel(projectId)}/current.json`);
const profileFile = () => resolveMediaPath("voice-profile/profile.json");

export const voiceoverAudioPath = (projectId: string, jobId: string) => resolveMediaPath(`${dirRel(projectId)}/${jobId}.m4a`);
/** File asli voice over unggahan, menunggu diproses worker. Dihapus setelah job selesai; yang diputar hasil `voiceoverAudioPath`. */
export const voiceoverUploadPath = (projectId: string, fileId: string) => resolveMediaPath(`${dirRel(projectId)}/unggahan/${fileId}`);
export const voiceProfileAudioPath = (id: string) => resolveMediaPath(`voice-profile/${id}.wav`);

/** Rekaman suara aktif, atau null bila belum ada atau filenya hilang. */
export function loadVoiceProfile(): VoiceProfile | null {
  const file = profileFile();
  if (!fs.existsSync(file)) return null;
  try {
    const p = JSON.parse(fs.readFileSync(file, "utf8")) as VoiceProfile;
    return fs.existsSync(voiceProfileAudioPath(p.id)) ? p : null;
  } catch { return null; }
}

/** Simpan rekaman baru sebagai aktif, lalu hapus rekaman lama. */
export async function saveVoiceProfile(profile: VoiceProfile, wav: Uint8Array): Promise<void> {
  const audio = voiceProfileAudioPath(profile.id);
  await fs.promises.mkdir(path.dirname(audio), { recursive: true });
  await fs.promises.writeFile(audio, wav);
  await writeAtomic(profileFile(), profile);
  await removeOther(path.dirname(audio), ".wav", `${profile.id}.wav`);
}

export async function clearVoiceProfile(): Promise<void> {
  await fs.promises.rm(profileFile(), { force: true });
  await removeOther(resolveMediaPath("voice-profile"), ".wav", null);
}

/** Voice over aktif project, atau null bila belum ada atau filenya hilang. */
export function loadVoiceover(projectId: string): VoiceoverInfo | null {
  const file = infoFile(projectId);
  if (!fs.existsSync(file)) return null;
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8")) as VoiceoverInfo;
    return fs.existsSync(voiceoverAudioPath(projectId, info.jobId)) ? info : null;
  } catch { return null; }
}

/** Simpan sebagai voice over aktif, lalu hapus audio versi sebelumnya. */
export async function saveVoiceover(projectId: string, info: VoiceoverInfo): Promise<void> {
  await writeAtomic(infoFile(projectId), info);
  await removeOther(resolveMediaPath(dirRel(projectId)), ".m4a", `${info.jobId}.m4a`);
}

export async function clearVoiceover(projectId: string): Promise<void> {
  await fs.promises.rm(infoFile(projectId), { force: true });
  await removeOther(resolveMediaPath(dirRel(projectId)), ".m4a", null);
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.promises.rename(tmp, file);
}

async function removeOther(dir: string, ext: string, keep: string | null): Promise<void> {
  const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.filter((n) => n.endsWith(ext) && n !== keep).map((n) => fs.promises.rm(path.join(dir, n), { force: true })));
}
