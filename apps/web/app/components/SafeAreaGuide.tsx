"use client";
// Fase 23: garis bantu safe area di atas pratinjau (bukan bagian komposisi: tidak ikut still atau render MP4).
// Nilai dari SAFE_AREA (config), sama dengan yang dipakai subtitle, judul, dan data.safeArea kode AI.
import { useEffect, useState } from "react";
import { SAFE_AREA, type AspectId } from "@app/config";

const KEY = "safe-area-guide";

/** Tampil/sembunyi garis bantu, diingat per browser. Bawaan: tampil untuk 9:16 (Reels/TikTok). */
export function useSafeAreaGuide(aspect: AspectId): [boolean, (on: boolean) => void] {
  const [pref, setPref] = useState<boolean | null>(null);
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v === "1" || v === "0") setPref(v === "1"); } catch { /* penyimpanan diblokir: pakai bawaan */ }
  }, []);
  const set = (on: boolean) => { setPref(on); try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* abaikan */ } };
  return [pref ?? aspect === "9:16", set];
}

const zone = "rgba(255, 70, 70, 0.16)";
const label: React.CSSProperties = { position: "absolute", fontSize: 10, lineHeight: 1.2, color: "#fff", background: "rgba(0,0,0,.55)", padding: "2px 5px", borderRadius: 4, whiteSpace: "nowrap", fontFamily: "system-ui, sans-serif" };

export function SafeAreaGuide({ aspect, show }: { aspect: AspectId; show: boolean }) {
  if (!show) return null;
  const a = SAFE_AREA[aspect];
  const pct = (n: number) => `${n * 100}%`;
  const vertical = aspect === "9:16";
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: pct(a.top), background: zone }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: pct(a.bottom), background: zone }} />
      <div style={{ position: "absolute", left: 0, top: pct(a.top), bottom: pct(a.bottom), width: pct(a.left), background: zone }} />
      <div style={{ position: "absolute", right: 0, top: pct(a.top), bottom: pct(a.bottom), width: pct(a.right), background: zone }} />
      <div style={{ position: "absolute", left: pct(a.left), right: pct(a.right), top: pct(a.top), bottom: pct(a.bottom), border: "1.5px dashed rgba(255,255,255,.75)", borderRadius: 4 }} />
      {vertical ? <>
        <span style={{ ...label, left: 6, top: 6 }}>Nama akun · tab Reels</span>
        <span style={{ ...label, left: 6, bottom: 6 }}>Caption · nama · audio</span>
        <span style={{ ...label, right: 4, bottom: `calc(${pct(a.bottom)} + 6px)`, writingMode: "vertical-rl" }}>Like · komentar · share</span>
      </> : <span style={{ ...label, left: 6, top: 6 }}>Safe area</span>}
    </div>
  );
}
