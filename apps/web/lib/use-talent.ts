"use client";
// Fase 24: hasil pemisahan talent per video (data wajah + URL video transparan) untuk pratinjau. Belum disiapkan = tidak ada.
import { useEffect, useState } from "react";
import type { FaceSample } from "@app/shared/talent";

export type TalentById = Record<string, { width: number; height: number; samples: FaceSample[]; src: string }>;

/** `refresh` berubah = muat ulang (mis. versi kreatif baru: job Kreatif bisa baru saja menyiapkan talent). */
export function useTalent(assetIds: string[], refresh: unknown): TalentById | undefined {
  const [talent, setTalent] = useState<TalentById | undefined>(undefined);
  const key = assetIds.join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void Promise.all(key.split(",").map(async (id) => {
      const r = await fetch(`/api/assets/${id}/talent`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return null;
      const b = await r.json().catch(() => null);
      return b && Array.isArray(b.samples) ? [id, { width: b.width, height: b.height, samples: b.samples, src: `/api/assets/${id}/talent?file=1&v=${Math.round(b.mtime ?? 0)}` }] as const : null;
    })).then((rows) => {
      if (!alive) return;
      const ok = rows.filter((x): x is NonNullable<typeof x> => !!x);
      setTalent(ok.length ? Object.fromEntries(ok) : undefined);
    });
    return () => { alive = false; };
  }, [key, refresh]);
  return talent;
}
