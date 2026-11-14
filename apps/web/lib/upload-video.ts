"use client";
// Unggah video mentah bertahap (potongan, bisa dilanjutkan bila terputus). Fase 16: dipakai halaman persiapan
// (banyak file sekaligus) dan panel Media di workspace.

/** Unggah satu file. `onPct` 0..100. Error dilempar dengan pesan dari server. */
export async function uploadVideo(projectId: string, file: File, onPct: (pct: number) => void): Promise<string> {
  const res = await fetch(`/api/projects/${projectId}/upload`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileName: file.name, size: file.size }),
  });
  const init = await res.json();
  if (!res.ok) throw new Error(init.error ?? "Gagal memulai upload");

  let offset: number = init.received ?? 0;
  const chunkSize: number = init.chunkSize;
  onPct(Math.floor((offset / file.size) * 100));

  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
    let attempt = 0;
    for (;;) {
      try {
        const put = await fetch(`/api/projects/${projectId}/upload?assetId=${init.assetId}&offset=${offset}`, { method: "PUT", body: chunk });
        const j = await put.json();
        if (put.status === 409 && typeof j.received === "number") {
          offset = j.received; // server lebih maju/mundur: sinkronkan lalu potong ulang
          break;
        }
        if (!put.ok) throw new Error(j.error ?? `HTTP ${put.status}`);
        offset = j.received;
        break;
      } catch (e) {
        if (++attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    onPct(Math.floor((offset / file.size) * 100));
  }

  const done = await fetch(`/api/projects/${projectId}/upload/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetId: init.assetId }),
  });
  const doneJson = await done.json();
  if (!done.ok) throw new Error(doneJson.error ?? "Gagal menyelesaikan upload");
  return init.assetId as string;
}

/** Urutan unggah = urutan nama file (nama kamera biasanya berurutan: IMG_0001, IMG_0002, ...). */
export const byName = (files: FileList | File[]) => [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
