"use client";
// Fase 11: file turunan untuk pratinjau. (1) salinan H.264 untuk video yang tidak bisa diputar browser (mis. MOV HEVC),
// (2) audio hasil reduksi noise untuk kekuatan "Kurangi noise" yang dipilih. Keduanya dibuat worker; hook ini
// mengantrekan bila perlu lalu memantau sampai siap. Fase 16: untuk SEMUA video project.
import { useEffect, useRef, useState } from "react";
import type { AssetRow } from "@app/shared";
import { denoiseLevel } from "@app/shared/derived-media";

export type DenoiseState = { level: number; status: "mati" | "memproses" | "siap" | "gagal"; src?: string; error?: string };

/**
 * `denoise` = gabungan semua video (siap hanya bila semua siap; gagal bila ada yang gagal). `audioSrc(id)` = audio hasil
 * reduksi noise video itu, hanya saat SEMUA siap (pratinjau tidak mencampur audio asli dan hasil noise).
 */
export function useDerivedMedia(assets: AssetRow[], strength: unknown, reloadDetail: () => void): { denoise: DenoiseState; audioSrc: (id: string) => string | undefined; previewError: string | null } {
  const [previewError, setPreviewError] = useState<string | null>(null);
  const asked = useRef(new Set<string>());

  // ---- salinan pratinjau: aset lama belum pernah diperiksa (null) -> minta worker memeriksa; pantau saat diproses
  // Bergantung pada id + status, bukan objek aset: detail dimuat ulang berkala dan objeknya selalu baru
  const ready = assets.filter((a) => Number(a.duration_s) > 0);
  const previewKey = ready.map((a) => `${a.id}:${a.preview_status}`).join(",");
  useEffect(() => {
    for (const a of ready) {
      if (a.preview_status !== null || asked.current.has(a.id)) continue; // undefined = kolom belum ada (migrasi)
      asked.current.add(a.id);
      void fetch(`/api/assets/${a.id}/preview`, { method: "POST" }).then(async (r) => {
        if (!r.ok) setPreviewError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        reloadDetail();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, reloadDetail]);
  const waiting = ready.some((a) => a.preview_status === null || a.preview_status === "antre");
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(reloadDetail, 3000);
    return () => clearInterval(t);
  }, [waiting, reloadDetail]);

  // ---- reduksi noise per video
  const level = denoiseLevel(strength);
  const ids = ready.map((a) => a.id).join(",");
  const [state, setState] = useState<Record<string, DenoiseState>>({});
  useEffect(() => {
    const list = ids ? ids.split(",") : [];
    if (!list.length || !level) { setState({}); return; }
    let stop = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const set = (id: string, v: DenoiseState) => { if (!stop) setState((m) => ({ ...m, [id]: v })); };
    setState(Object.fromEntries(list.map((id) => [id, { level, status: "memproses" } as DenoiseState])));
    for (const id of list) {
      const url = `/api/assets/${id}/denoise?level=${level}`;
      const check = async (queue: boolean) => {
        if (stop) return;
        const r = await fetch(url, { method: "HEAD" }).catch(() => null);
        if (stop) return;
        if (r?.ok) return set(id, { level, status: "siap", src: url });
        if (queue) {
          const q = await fetch(`/api/assets/${id}/denoise`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ strength: level / 100 }) });
          const b = await q.json().catch(() => ({}));
          if (stop) return;
          if (!q.ok) return set(id, { level, status: "gagal", error: b.error ?? `HTTP ${q.status}` });
          if (b.ready) return set(id, { level, status: "siap", src: url });
        } else {
          // HEAD tidak membawa isi: ambil status job lewat GET bila belum siap
          const g = await fetch(url).then((x) => x.json()).catch(() => ({}));
          if (stop) return;
          if (g?.job?.status === "failed") return set(id, { level, status: "gagal", error: g.job.error ?? "Reduksi noise gagal" });
        }
        timers.push(setTimeout(() => void check(false), 3000));
      };
      // Tunda sebentar: menggeser slider tidak mengantre job untuk setiap nilai yang dilewati
      timers.push(setTimeout(() => void check(true), 800));
    }
    return () => { stop = true; timers.forEach(clearTimeout); };
  }, [ids, level]);

  const list = ids ? ids.split(",") : [];
  const all = list.map((id) => state[id]).filter(Boolean) as DenoiseState[];
  const failed = all.find((x) => x.status === "gagal");
  const allReady = level > 0 && list.length > 0 && all.length === list.length && all.every((x) => x.status === "siap");
  const denoise: DenoiseState = !level ? { level: 0, status: "mati" }
    : failed ? { level, status: "gagal", error: failed.error }
    : allReady ? { level, status: "siap", src: state[list[0]]?.src }
    : { level, status: "memproses" };
  return { denoise, audioSrc: (id) => (allReady ? state[id]?.src : undefined), previewError };
}
