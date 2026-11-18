// Compile kode kreatif (TSX buatan AI) saat runtime, dengan scope tertutup.
// Satu jalur untuk Player di browser dan renderer di worker, sehingga pratinjau = hasil render.
// Pemeriksaan statis menolak akses jaringan, DOM, penyimpanan, eval, dan modul selain react/remotion.
import React from "react";
import * as Remotion from "remotion";
import { transform } from "sucrase";
import { CREATIVE } from "@app/config";
import { Character } from "./character.ts";
import { ProfAI } from "./prof-ai.ts";

export type ScopeIssue = { rule: string; detail: string };

// Pemeriksaan ini lapisan pertahanan terhadap kode yang SALAH (halusinasi AI, teks ucapan yang menyusup ke prompt),
// bukan sandbox terhadap penyerang yang sengaja menyusun string untuk lolos. Lihat "Keamanan" di todo/fase-9-mode-kreatif.md.
// Setiap alias (const w = window; const F = Function) ikut ditolak karena yang dicari adalah kata, bukan pemanggilannya.
const BANNED: Array<[RegExp, string]> = [
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|navigator|importScripts|Worker|SharedWorker|sendBeacon|postMessage|BroadcastChannel)\b/, "akses jaringan/worker"],
  [/\b(window|document|globalThis|frames|opener)\b/, "akses DOM/global"],
  [/\b(self|top|parent|location|history|screen)\s*[.[]/, "akses DOM/global"],
  [/\b(localStorage|sessionStorage|indexedDB|caches|cookie)\b/, "penyimpanan browser"],
  [/\b(eval|Function)\b/, "eval/Function"],
  [/\bconstructor\b/, "akses constructor"],
  [/\b(process|require|module|exports|__\w+__|prototype)\b/, "akses Node/prototype"],
  [/\b(getPrototypeOf|setPrototypeOf|getOwnPropertyNames|getOwnPropertyDescriptors?|defineProperty|defineProperties|Reflect|Proxy|WebAssembly|Atomics)\b/, "refleksi/prototype"],
  [/\b(this|arguments)\b/, "this/arguments (tulis komponen dan fungsi biasa tanpa this)"],
  [/\bwith\s*\(|\bimport\s*\.\s*meta\b/, "with/import.meta"],
  [/\bimport\s*\(/, "import dinamis"],
  [/\bMath\.random\b/, "Math.random (pakai random() dari remotion agar deterministik)"],
  [/\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask|Date\.now|new\s+Date|performance\.now)\b/, "timer/jam (animasi harus dari frame)"],
  [/\b(staticFile|delayRender|continueRender|prefetch)\b/, "media/aset eksternal"],
  // Membangun nama properti dari potongan string adalah cara umum menghindari daftar di atas
  [/\b(fromCharCode|fromCodePoint|atob|btoa|unescape|escape|decodeURI|decodeURIComponent)\b/, "penyusun string tersembunyi"],
  [/\\x[0-9a-fA-F]{2}|\\u/, "escape \\x/\\u (tulis karakternya langsung)"],
  // Hanya akses properti (setelah identifier atau penutup); literal array seperti ["A", "B"] tetap sah
  [/(?<=[\w$)\]}"'`])\s*\[\s*["'`]/, "akses properti lewat string literal (pakai titik: obj.nama)"],
  // Fase 13: gambar hanya dari bahan unggahan (data.assets[i].src). Namespace SVG (www.w3.org) bukan unduhan, tetap boleh.
  [/https?:\/\/(?!www\.w3\.org\/)|["'`(]\/\/[\w-]+\.[\w-]/, "URL internet (tampilkan gambar lewat data.assets[i].src)"],
];

/** Daftar API remotion yang boleh dipakai kode kreatif (semua murni, berbasis frame). */
// Img (Fase 13): hanya untuk bahan unggahan lewat data.assets[i].src; URL internet ditolak di BANNED
export const REMOTION_API = ["AbsoluteFill", "Sequence", "Series", "Loop", "Freeze", "Easing", "interpolate", "interpolateColors", "spring", "measureSpring", "random", "useCurrentFrame", "useVideoConfig", "Img"] as const;
const SAFE_REMOTION = Object.freeze(Object.fromEntries(REMOTION_API.map((k) => [k, (Remotion as Record<string, unknown>)[k]])));
// Fase 25: `import { Character } from "character"` = karakter ber-rig (kode KITA, bukan kode AI)
// Fase 27: + ProfAI (karakter tetap project Animasi)
const MODULES: Record<string, unknown> = { react: React, remotion: SAFE_REMOTION, character: Object.freeze({ Character, ProfAI }) };

/** Nama aturan yang ditolak (untuk contract.md, agar AI tahu apa yang dilarang). */
export const SCOPE_RULE_LABELS: readonly string[] = [...new Set(BANNED.map(([, label]) => label))];

/** Pemeriksaan statis sebelum compile. Kosong = lolos. */
export function checkScope(code: string): ScopeIssue[] {
  const issues: ScopeIssue[] = [];
  // Byte UTF-8, sama dengan batas octet_length di tabel creative_versions
  const bytes = new TextEncoder().encode(code).length;
  if (bytes > CREATIVE.maxCodeBytes) issues.push({ rule: "ukuran", detail: `kode ${bytes} byte, maksimal ${CREATIVE.maxCodeBytes} (lebih ${bytes - CREATIVE.maxCodeBytes} byte). Ringkas tanpa mengubah tampilan: hapus komentar panjang, ubah adegan/elemen yang mirip menjadi satu komponen + array data, buang kode yang tidak dipakai` });
  // Komentar dan string tidak dikecualikan: lebih aman menolak teks mencurigakan daripada lolos lewat celah
  for (const [re, rule] of BANNED) {
    const m = re.exec(code);
    if (m) issues.push({ rule, detail: `"${m[0].trim()}" dilarang` });
  }
  // Setiap sumber modul: `import x from "m"`, `import "m"`, dan `export ... from "m"` (re-export juga membaca modul)
  const sources = [...code.matchAll(/\bfrom\s*["']([^"']+)["']/g), ...code.matchAll(/\bimport\s*["']([^"']+)["']/g)];
  for (const m of sources) {
    if (!Object.hasOwn(MODULES, m[1])) issues.push({ rule: "modul", detail: `import "${m[1]}" tidak diizinkan (hanya react, remotion, dan character)` });
  }
  for (const m of code.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["']remotion["']/g)) {
    for (const name of m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!(REMOTION_API as readonly string[]).includes(name)) issues.push({ rule: "api", detail: `remotion.${name} tidak tersedia di Mode Kreatif` });
    }
  }
  if (!/\bexport\s+default\b/.test(code)) issues.push({ rule: "export", detail: "harus ada satu export default" });
  return issues;
}

export type Compiled<T> = { ok: true; value: T; ms: number } | { ok: false; error: string };

const cache = new Map<string, Compiled<unknown>>();
/** Fase 24: semua export modul (bernama) per string kode, diisi bersamaan dengan cache export default. */
const modules = new Map<string, Record<string, unknown>>();

/**
 * Export BERNAMA modul kreatif (mis. `Behind`, `faceBlur` di CreativeOverlay.tsx). Memakai compile yang sama (dan cache)
 * dengan compileCreative; kode yang ditolak/gagal = null.
 */
export function creativeExport<T>(code: string | undefined, name: string): T | null {
  if (!code) return null;
  if (!modules.has(code)) compileCreative(code);
  const v = modules.get(code)?.[name];
  return v === undefined ? null : (v as T);
}

/** Compile + evaluasi satu modul kreatif. Hasil di-cache per string kode (compile sekali per versi). */
export function compileCreative<T>(code: string): Compiled<T> {
  const hit = cache.get(code);
  if (hit) return hit as Compiled<T>;
  const result = ((): Compiled<T> => {
    const issues = checkScope(code);
    if (issues.length) return { ok: false, error: `Kode ditolak: ${issues.map((i) => `${i.rule} (${i.detail})`).join("; ")}` };
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const js = transform(code, { transforms: ["typescript", "jsx", "imports"], production: true, jsxPragma: "React.createElement", jsxFragmentPragma: "React.Fragment" }).code;
      const exp: Record<string, unknown> = {};
      const req = (name: string) => {
        if (!(name in MODULES)) throw new Error(`modul "${name}" tidak diizinkan`);
        return MODULES[name];
      };
      // Scope tertutup: hanya React, require terbatas, dan objek exports. Fungsi dibuat oleh kode KITA, bukan kode AI.
      new Function("React", "require", "exports", `"use strict";\n${js}`)(React, req, exp);
      modules.set(code, exp);
      const value = (exp.default ?? null) as T | null;
      if (value === null) return { ok: false, error: "Kode tidak punya export default." };
      const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      return { ok: true, value, ms };
    } catch (e) {
      return { ok: false, error: `Compile gagal: ${e instanceof Error ? e.message : String(e)}` };
    }
  })();
  if (cache.size > CREATIVE.cacheSize) { cache.clear(); modules.clear(); }
  cache.set(code, result);
  return result;
}
