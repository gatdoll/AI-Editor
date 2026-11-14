"use client";
// Bahan project (gambar/logo, musik, knowledge). Fase 15: gambar juga dipakai Mode Kreatif project video.
import { useCallback, useEffect, useState } from "react";
import type { AssetCue } from "@app/shared/opinion";

export type Material = { id: string; label: string; mime: string; size_bytes: number | null; width: number | null; height: number | null; duration_s: number | null; role?: "logo" | "gambar" | "design";
  /** Fase 21: keterangan pengguna tentang isi gambar. */ note?: string;
  /** Fase 19/21: isyarat waktu tampil (aset Opinion Motion / aset sendiri yang dipakai). */ cue?: AssetCue };

/** Ukuran asli gambar dibaca browser (dipakai AI untuk menjaga rasio). */
export function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/** `version` berubah = muat ulang (mis. bahan diubah di panel lain). */
export function useMaterials(projectId: string, version: number | string = 0) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/materials`, { cache: "no-store" });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setMaterials(b.materials ?? []); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);
  useEffect(() => { void reload(); }, [reload, version]);
  return { materials, error, reload };
}
