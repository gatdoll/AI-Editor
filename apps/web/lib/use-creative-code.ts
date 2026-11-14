"use client";
// Kode Mode Kreatif untuk pratinjau, mengikuti style.creativeId yang sedang ditampilkan (termasuk yang belum disimpan).
import { useEffect, useState } from "react";
import type { CreativeCodeRow } from "@app/shared/creative-store";

export type CreativeState = { code: CreativeCodeRow | null; error: string | null; loading: boolean };

export function useCreativeCode(projectId: string, creativeId: string | undefined): CreativeState {
  const [state, setState] = useState<CreativeState>({ code: null, error: null, loading: false });
  useEffect(() => {
    if (!creativeId) {
      setState({ code: null, error: null, loading: false });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fetch(`/api/projects/${projectId}/creative/${creativeId}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!alive) return;
        // Gagal memuat = pratinjau tanpa layer kreatif + pesan jelas (render di worker akan gagal dengan pesan yang sama)
        if (!r.ok) setState({ code: null, error: String(body.error ?? `Gagal memuat versi kreatif (${r.status})`), loading: false });
        else setState({ code: { overlay: body.overlay, video: body.video, replacesCaptions: body.replacesCaptions === true, sfx: Array.isArray(body.sfx) ? body.sfx : [], fonts: Array.isArray(body.fonts) ? body.fonts : [] }, error: null, loading: false });
      })
      .catch((e) => alive && setState({ code: null, error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => {
      alive = false;
    };
  }, [projectId, creativeId]);
  return state;
}
