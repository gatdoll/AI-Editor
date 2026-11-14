"use client";
// Fase 14: pustaka SFX (bawaan + unggahan) untuk panel SFX, timeline, dan pratinjau.
import { useCallback, useEffect, useState } from "react";
import type { SfxItem } from "@app/shared/sfx";

export type SfxLibrary = { items: SfxItem[]; error: string | null; reload: () => Promise<void>; upload: (file: File, tags: string) => Promise<SfxItem>; remove: (id: string) => Promise<void> };

/** Durasi file audio dibaca browser (server tidak punya decoder untuk semua format). */
function audioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (d: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    a.src = url;
  });
}

export function useSfxLibrary(): SfxLibrary {
  const [items, setItems] = useState<SfxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/sfx", { cache: "no-store" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `Gagal memuat SFX (${r.status})`);
      setItems(body.items ?? []); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const upload = useCallback(async (file: File, tags: string) => {
    const form = new FormData();
    form.set("file", file); form.set("tags", tags); form.set("durationS", String(await audioDuration(file)));
    const r = await fetch("/api/sfx", { method: "POST", body: form });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `Gagal mengunggah (${r.status})`);
    await reload();
    return body.item as SfxItem;
  }, [reload]);
  const remove = useCallback(async (id: string) => {
    const r = await fetch(`/api/sfx/${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? `Gagal menghapus (${r.status})`);
    await reload();
  }, [reload]);
  return { items, error, reload, upload, remove };
}

let current: HTMLAudioElement | null = null;
/** Dengar contoh satu SFX (yang sebelumnya dihentikan). */
export function playSfx(id: string, volume = 1): void {
  current?.pause();
  current = new Audio(`/api/sfx/${encodeURIComponent(id)}/file`);
  current.volume = Math.max(0, Math.min(1, volume));
  void current.play().catch(() => {});
}
