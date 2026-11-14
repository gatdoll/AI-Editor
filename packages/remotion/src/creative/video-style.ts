// Bagian murni Mode Kreatif (tanpa JSX): pelaporan error dan gaya video per frame dari kode kreatif.
import type React from "react";
import { CREATIVE } from "@app/config";
import { compileCreative } from "./compile.ts";
import type { CreativeData, CreativeVideoStyle } from "./contract.ts";

type VideoFn = (frame: number, data: CreativeData) => CreativeVideoStyle;

export type CreativeErrorHandler = (where: "overlay" | "video", message: string) => void;

const reported = new Set<string>();
export function report(onError: CreativeErrorHandler | undefined, where: "overlay" | "video", message: string) {
  const key = `${where}:${message}`;
  if (reported.has(key)) return;
  reported.add(key);
  console.error(`[kreatif] ${where}: ${message}`);
  onError?.(where, message);
}

const clean = (v: unknown) => (typeof v === "string" && v.length <= CREATIVE.maxStyleChars && !/url\s*\(/i.test(v) ? v : undefined);

/** Gaya video dari fungsi murni kreatif untuk frame ini. Nilai tidak sah atau error = tanpa efek. */
export function creativeVideoStyle(code: string | undefined, frame: number, data: CreativeData, onError?: CreativeErrorHandler): React.CSSProperties | null {
  if (!code) return null;
  const compiled = compileCreative<VideoFn>(code);
  if (!compiled.ok) { report(onError, "video", compiled.error); return null; }
  if (typeof compiled.value !== "function") { report(onError, "video", "export default video harus fungsi (frame, data) => gaya."); return null; }
  try {
    const out = compiled.value(frame, data) ?? {};
    const opacity = typeof out.opacity === "number" && Number.isFinite(out.opacity) ? Math.min(1, Math.max(0, out.opacity)) : undefined;
    const transform = clean(out.transform), filter = clean(out.filter);
    if (!transform && !filter && opacity === undefined) return null;
    return { transform, filter, opacity, transformOrigin: "50% 50%" };
  } catch (e) {
    report(onError, "video", `frame ${frame}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
