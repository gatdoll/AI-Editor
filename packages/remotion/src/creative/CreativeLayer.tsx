import React from "react";
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame } from "remotion";
import { compileCreative, creativeExport } from "./compile.ts";
import type { CreativeData, CreativeFontFile } from "./contract.ts";
import { FONT_FAMILIES } from "../components/fonts.ts";

/** Font selalu dimuat bersama layer kreatif (pratinjau dan render). */
export const creativeFonts = (): CreativeData["fonts"] => ({ ...FONT_FAMILIES });
import { creativeVideoStyle, report, type CreativeErrorHandler } from "./video-style.ts";

export type { CreativeErrorHandler };

type OverlayComponent = React.ComponentType<{ data: CreativeData }>;

/** Error di satu frame mematikan layer kreatif di frame itu saja; video dan subtitle tetap jalan. */
class FrameBoundary extends React.Component<{ onError: (message: string) => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { this.props.onError(error instanceof Error ? error.message : String(error)); }
  render() { return this.state.failed ? null : this.props.children; }
}

type Ranges = Array<{ start: number; end: number }> | undefined;
/** Tidak ada rentang = seluruh video (versi sebelum Fase 10). */
const inRanges = (ranges: Ranges, frame: number, fps: number) => !ranges || ranges.some((r) => frame / fps >= r.start && frame / fps < r.end);

/** Layer layar-tetap di atas video (di luar kamera, aturan 4). */
export function CreativeOverlay({ code, data, ranges, onError }: { code?: string; data: CreativeData; ranges?: Ranges; onError?: CreativeErrorHandler }) {
  const frame = useCurrentFrame();
  if (!code || !inRanges(ranges, frame, data.fps)) return null;
  const compiled = compileCreative<OverlayComponent>(code);
  if (!compiled.ok) { report(onError, "overlay", compiled.error); return null; }
  if (typeof compiled.value !== "function") { report(onError, "overlay", "export default overlay harus komponen React."); return null; }
  const Overlay = compiled.value;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* key per frame: boundary di-reset tiap frame, jadi satu frame yang error tidak mematikan sisanya */}
      <FrameBoundary key={frame} onError={(m) => report(onError, "overlay", `frame ${frame}: ${m}`)}>
        <Overlay data={data} />
      </FrameBoundary>
    </AbsoluteFill>
  );
}

/** Pembungkus video: menerapkan gaya per frame tanpa me-remount video di dalamnya. */
export function CreativeVideo({ code, data, ranges, onError, children }: { code?: string; data: CreativeData; ranges?: Ranges; onError?: CreativeErrorHandler; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  // Di luar rentang: tanpa gaya, tapi struktur pembungkus sama agar video tidak di-remount saat masuk/keluar rentang
  if (!code) return <AbsoluteFill>{children}</AbsoluteFill>;
  const style = data && inRanges(ranges, frame, data.fps) ? creativeVideoStyle(code, frame, data, onError) : null;
  return <AbsoluteFill style={{ overflow: "hidden" }}><AbsoluteFill style={style ?? undefined}>{children}</AbsoluteFill></AbsoluteFill>;
}

/** Fase 24: kode punya lapisan di BELAKANG talent (`export function Behind`)? */
export const hasBehind = (code?: string) => typeof creativeExport(code, "Behind") === "function";

/**
 * Fase 24: lapisan di BELAKANG talent (`export function Behind({ data })` di CreativeOverlay.tsx). Digambar di antara video dan
 * lapisan talent transparan, di dalam pembungkus kamera yang sama: talent selalu menutupinya.
 */
export function CreativeBehind({ code, data, ranges, onError }: { code?: string; data: CreativeData; ranges?: Ranges; onError?: CreativeErrorHandler }) {
  const frame = useCurrentFrame();
  if (!code || !inRanges(ranges, frame, data.fps)) return null;
  const Behind = creativeExport<OverlayComponent>(code, "Behind");
  if (typeof Behind !== "function") return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <FrameBoundary key={frame} onError={(m) => report(onError, "overlay", `Behind frame ${frame}: ${m}`)}>
        <Behind data={data} />
      </FrameBoundary>
    </AbsoluteFill>
  );
}

/** Fase 24: kekuatan blur wajah (px) pada frame hasil dari `export function faceBlur(frame, data)`. Error/tidak ada = 0. */
export function faceBlurAt(code: string | undefined, frame: number, data: CreativeData | null, ranges: Ranges, onError?: CreativeErrorHandler): number {
  if (!code || !data || !inRanges(ranges, frame, data.fps)) return 0;
  const fn = creativeExport<(frame: number, data: CreativeData) => unknown>(code, "faceBlur");
  if (typeof fn !== "function") return 0;
  try {
    const v = Number(fn(frame, data));
    return Number.isFinite(v) ? Math.max(0, Math.min(80, v)) : 0;
  } catch (e) {
    report(onError, "overlay", `faceBlur frame ${frame}: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

/**
 * Fase 24: muat font tambahan versi kreatif (pustaka Google Fonts / unggahan) SEBELUM frame dirender (delayRender), di
 * pratinjau dan render. Gagal dimuat = dilaporkan; teks jatuh ke font cadangan (tidak diam-diam dianggap berhasil).
 */
export function CreativeFontLoader({ fonts, onError }: { fonts?: CreativeFontFile[]; onError?: CreativeErrorHandler }) {
  const key = (fonts ?? []).map((f) => `${f.family}|${f.weight}|${f.src}`).join(",");
  const [handle] = React.useState(() => (key ? delayRender(`Memuat font: ${(fonts ?? []).map((f) => f.family).join(", ")}`) : null));
  React.useEffect(() => {
    if (!key || typeof document === "undefined") { if (handle !== null) continueRender(handle); return; }
    let done = false;
    Promise.allSettled((fonts ?? []).map(async (f) => {
      const face = new FontFace(f.family, `url(${JSON.stringify(f.src)})`, { weight: String(f.weight), style: "normal" });
      await face.load();
      document.fonts.add(face);
    })).then((results) => {
      results.forEach((r, i) => { if (r.status === "rejected") report(onError, "overlay", `Font "${fonts![i].family}" gagal dimuat: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`); });
    }).finally(() => { if (!done && handle !== null) { done = true; continueRender(handle); } });
    return () => { done = true; if (handle !== null) continueRender(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
