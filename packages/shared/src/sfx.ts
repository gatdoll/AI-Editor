// Fase 14: isyarat SFX (murni, aman di browser dan Node). Satu isyarat = suara dari pustaka + waktu + volume.
// Isyarat di gaya project (Mode Cepat / timeline) memakai waktu VIDEO MENTAH; isyarat dari versi kreatif memakai waktu
// HASIL versi itu (sama dengan kode kreatifnya).
import { SFX } from "@app/config";

export type SfxItem = { id: string; name: string; tags: string[]; file: string; mime: string; durationS: number; source: "bawaan" | "unggahan"; license?: string };
export type SfxCue = { id: string; at: number; volume: number };
export type StyleSfx = { cues: SfxCue[]; /** Isyarat dari versi Mode Kreatif aktif ikut diputar. */ useCreative: boolean };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Rapikan isyarat: sah, urut, dijepit ke durasi, jarak minimum, jumlah maksimum. `known` = id yang ada di pustaka. */
export function normalizeCues(raw: unknown, durationS: number, known?: (id: string) => boolean): { cues: SfxCue[]; dropped: string[] } {
  const dropped: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  const ok: SfxCue[] = [];
  for (const r of list) {
    const c = r as Partial<SfxCue> & { sound?: unknown; name?: unknown };
    const id = typeof c.id === "string" ? c.id : typeof c.sound === "string" ? c.sound : "";
    const at = Number(c.at);
    if (!id || !Number.isFinite(at)) { dropped.push("isyarat tanpa suara/waktu"); continue; }
    if (known && !known(id)) { dropped.push(`suara "${id}" tidak ada di pustaka`); continue; }
    if (at < 0 || at > durationS) { dropped.push(`"${id}" di ${at.toFixed(2)} dtk di luar durasi`); continue; }
    ok.push({ id, at: Math.round(at * 1000) / 1000, volume: clamp(Number.isFinite(Number(c.volume)) ? Number(c.volume) : 1, 0, 1) });
  }
  ok.sort((a, b) => a.at - b.at);
  const cues: SfxCue[] = [];
  for (const c of ok) {
    if (cues.length && c.at - cues[cues.length - 1].at < SFX.minGapS) { dropped.push(`"${c.id}" di ${c.at.toFixed(2)} dtk terlalu rapat dengan sebelumnya`); continue; }
    if (cues.length >= SFX.maxCues) { dropped.push(`lebih dari ${SFX.maxCues} isyarat`); break; }
    cues.push(c);
  }
  return { cues, dropped };
}

export function normalizeStyleSfx(raw: unknown): StyleSfx | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<StyleSfx>;
  return { cues: normalizeCues(r.cues, 86400).cues, useCreative: r.useCreative !== false };
}

/** Cari suara dari nama/id/tag (untuk AI dan Mode Cepat): id persis > nama persis > nama mengandung > tag. */
export function findSfx(lib: SfxItem[], query: string): SfxItem | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return lib.find((s) => s.id.toLowerCase() === q) ?? lib.find((s) => s.name.toLowerCase() === q)
    ?? lib.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()))
    ?? lib.find((s) => s.tags.some((t) => t.toLowerCase() === q || q.includes(t.toLowerCase())));
}

/**
 * Isi `sfx.json` dari AI Kreatif -> isyarat sah. `errors` (JSON rusak, suara tidak dikenal) dikembalikan ke AI untuk
 * diperbaiki; `dropped` (di luar durasi, terlalu rapat, terlalu banyak) dibuang dan dicatat saja.
 * Nama suara boleh id, nama, atau tag (dicocokkan dengan findSfx).
 */
export function parseSfxFile(text: string | undefined, lib: SfxItem[], durationS: number): { cues: SfxCue[]; errors: string[]; dropped: string[] } {
  if (!text?.trim()) return { cues: [], errors: [], dropped: [] };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { cues: [], errors: [`sfx.json bukan JSON yang sah: ${e instanceof Error ? e.message : e}`], dropped: [] }; }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { cues?: unknown }).cues) ? (raw as { cues: unknown[] }).cues : null;
  if (!list) return { cues: [], errors: ["sfx.json harus berupa array isyarat: [{ \"sound\": \"whoosh\", \"at\": 1.2, \"volume\": 0.8 }]"], dropped: [] };
  const errors: string[] = [];
  const resolved = list.map((r) => {
    const c = (r ?? {}) as Record<string, unknown>;
    const q = typeof c.id === "string" ? c.id : typeof c.sound === "string" ? c.sound : "";
    const hit = q ? findSfx(lib, q) : undefined;
    if (q && !hit) errors.push(`sfx.json: suara "${q}" tidak ada di brief.json sfxLibrary`);
    return { ...c, id: hit?.id ?? q };
  });
  if (errors.length) return { cues: [], errors: [...new Set(errors)], dropped: [] };
  const { cues, dropped } = normalizeCues(resolved, durationS, (id) => lib.some((s) => s.id === id));
  return { cues, errors: [], dropped };
}
