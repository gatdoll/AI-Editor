"use client";
// Simpan hasil render ke lokasi pilihan pengguna ("Simpan sebagai", File System Access API di Chrome/Edge).
// Browser lain: unduhan biasa ke folder Unduhan.

type SaveHandle = { createWritable: () => Promise<{ write: (c: Uint8Array) => Promise<void>; close: () => Promise<void>; abort?: () => Promise<void> }>; name: string; getFile: () => Promise<File>; remove?: () => Promise<void> };
type Picker = (o: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<SaveHandle>;

export const canPickSaveFile = () => typeof window !== "undefined" && typeof (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker === "function";

/** Jendela "Simpan sebagai". null = tidak didukung browser; melempar AbortError bila pengguna membatalkan. Harus dipanggil langsung dari klik. */
export async function pickSaveFile(name: string): Promise<SaveHandle | null> {
  const picker = (window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  if (!picker) return null;
  return picker({ suggestedName: name, types: [{ description: "Video MP4", accept: { "video/mp4": [".mp4"] } }] });
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Alirkan file dari server ke lokasi yang dipilih, dengan progres 0..1. */
export async function saveUrlToHandle(url: string, handle: SaveHandle, onProgress?: (f: number) => void): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Gagal mengambil file hasil render (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const out = await handle.createWritable();
  const reader = res.body.getReader();
  let done = 0;
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      await out.write(value);
      done += value.length;
      if (total) onProgress?.(done / total);
    }
    await out.close();
  } catch (e) {
    await out.abort?.().catch(() => {});
    throw e;
  }
}

/**
 * Render gagal: hapus file kosong yang dibuat Chrome saat lokasi dipilih, agar tidak terlihat seperti hasil jadi.
 * Hanya file 0 byte yang dihapus. true = sudah terhapus.
 */
export async function discardEmptySave(handle: SaveHandle): Promise<boolean> {
  try {
    if (!handle.remove || (await handle.getFile()).size > 0) return false;
    await handle.remove();
    return true;
  } catch {
    return false;
  }
}

/** Pesan render gagal untuk pengguna, sekaligus membersihkan file kosong di lokasi pilihan. */
export async function renderFailedMessage(handle: SaveHandle | null, error: string | null | undefined): Promise<string> {
  const reason = `Render gagal: ${error?.split("\n")[0] ?? "dibatalkan"}`;
  if (!handle) return reason;
  return (await discardEmptySave(handle)) ? `${reason} File kosong ${handle.name} sudah dihapus.` : `${reason} ${handle.name} tidak terisi; jangan dipakai, ekspor ulang saja.`;
}

/** Unduhan biasa (cadangan bila "Simpan sebagai" tidak didukung). */
export function downloadUrl(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
