// Fase 21: aset sendiri di video bicara. Tipe status, skema keluaran AI, validasi, dan isyarat. Murni (tanpa fs/db):
// dipakai web, worker, tes. AI hanya MENGUSULKAN tempat (rentang kata transkrip); pengguna yang memutuskan (semangat aturan 2).
import { z } from "zod";
import { OWN_ASSETS } from "@app/config";
import type { AssetCue } from "./opinion.ts";

type Provider = "claude" | "codex";
export type OwnWord = { text: string; start: number; end: number };

/** Satu tempat di transkrip. startS/endS = detik video MENTAH (sumbu reel), jadi tetap benar bila cut berubah. */
export type Placement = { wordStart: number; wordEnd: number; startS: number; endS: number; context: string; alasan: string };

export type OwnStatus = "pending" | "dipakai" | "tidak-dipakai";

export type OwnItem = {
  /** Id bahan (assets kind material). */
  assetId: string;
  status: OwnStatus;
  /** Usulan AI: [0] = utama, sisanya alternatif. Kosong = tidak ada bagian yang cocok (lihat error). */
  options: Placement[];
  /** Tempat yang dipakai (salah satu opsi, atau dipilih pengguna di posisi playhead). */
  chosen?: Placement;
  /** Keterangan saat dicocokkan (untuk menandai keterangan yang sudah diubah sesudahnya). */
  noteUsed: string;
  error?: string;
};

export type OwnState = { version: 1; provider: Provider | null; model: string | null; updatedAt: string; items: OwnItem[]; warnings: string[] };

// ------------------------------------------------------------------ keluaran AI

const placementSchema = { type: "object", additionalProperties: false, required: ["wordStart", "wordEnd", "alasan"], properties: { wordStart: { type: "integer" }, wordEnd: { type: "integer" }, alasan: { type: "string" } } } as const;

/** Skema JSON untuk CLI. Semua kunci wajib (Codex mode ketat). */
export const OWN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["penempatan", "catatan"],
  properties: {
    penempatan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["aset", "cocok", "utama", "alternatif"],
        properties: {
          aset: { type: "string" },
          cocok: { type: "boolean" },
          // Sama dengan pola skema Fase 19 yang sudah terbukti di Codex mode ketat (objek atau null)
          utama: { ...placementSchema, type: ["object", "null"] },
          alternatif: { type: "array", maxItems: OWN_ASSETS.maxAlternatives, items: placementSchema },
        },
      },
    },
    catatan: { type: "string" },
  },
} as const;

const RawPlacement = z.object({ wordStart: z.number(), wordEnd: z.number(), alasan: z.string().optional().default("") });
const Raw = z.object({
  penempatan: z.array(z.object({ aset: z.string(), cocok: z.boolean().optional().default(true), utama: RawPlacement.nullable().optional(), alternatif: z.array(RawPlacement).optional().default([]) })),
  catatan: z.string().optional().default(""),
});

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Potongan kalimat di sekitar rentang kata. */
export function contextOf(words: OwnWord[], start: number, end: number, around = 5): string {
  const a = Math.max(0, start - around), b = Math.min(words.length - 1, end + around);
  return `${a > 0 ? "…" : ""}${words.slice(a, b + 1).map((w) => w.text.trim()).join(" ")}${b < words.length - 1 ? "…" : ""}`;
}

/** Rentang kata -> penempatan. null = indeks tidak sah. */
export function placementOf(words: OwnWord[], wordStart: number, wordEnd: number, alasan = ""): Placement | null {
  const ws = Math.round(wordStart), we = Math.round(wordEnd);
  if (!Number.isInteger(ws) || !Number.isInteger(we) || ws < 0 || we >= words.length || we < ws || we - ws > OWN_ASSETS.maxSpanWords) return null;
  return { wordStart: ws, wordEnd: we, startS: words[ws].start, endS: words[we].end, context: contextOf(words, ws, we), alasan: clean(alasan, 300) };
}

/** "Pakai di posisi playhead": kata yang sedang/berikutnya diucapkan pada detik `atS`, sepanjang beberapa kata. */
export function placementAt(words: OwnWord[], atS: number): Placement | null {
  if (!words.length || !Number.isFinite(atS)) return null;
  let i = words.findIndex((w) => w.end > atS);
  if (i < 0) i = words.length - 1;
  return placementOf(words, i, Math.min(words.length - 1, i + OWN_ASSETS.hereWords - 1), "Dipilih pengguna di posisi playhead.");
}

/**
 * Validasi keluaran AI. Yang tidak sah dibuang dengan alasan (bukan diperbaiki diam-diam): aset tak dikenal, indeks di luar
 * transkrip. Aset yang diminta tetapi tidak dijawab / tidak cocok = tanpa opsi + alasan (aturan 7).
 */
export function checkPlacements(raw: unknown, words: OwnWord[], asked: Map<string, string>): { byAsset: Map<string, { options: Placement[]; error?: string }>; dropped: string[]; catatan: string } {
  const byAsset = new Map<string, { options: Placement[]; error?: string }>();
  const parsed = Raw.safeParse(raw);
  if (!parsed.success) {
    for (const id of asked.values()) byAsset.set(id, { options: [], error: "Keluaran AI tidak sesuai skema." });
    return { byAsset, dropped: [`Keluaran AI tidak sesuai skema: ${parsed.error.issues[0]?.message ?? "?"}`], catatan: "" };
  }
  const dropped: string[] = [];
  for (const p of parsed.data.penempatan) {
    const assetId = asked.get(p.aset.trim());
    if (!assetId) { dropped.push(`aset "${clean(p.aset, 20)}" tidak dikenal`); continue; }
    if (byAsset.has(assetId)) { dropped.push(`aset ${p.aset} dijawab dua kali; yang pertama dipakai`); continue; }
    const options: Placement[] = [];
    for (const r of [...(p.cocok && p.utama ? [p.utama] : []), ...(p.cocok ? p.alternatif : [])].slice(0, 1 + OWN_ASSETS.maxAlternatives)) {
      const pl = placementOf(words, r.wordStart, r.wordEnd, r.alasan);
      if (!pl) { dropped.push(`${p.aset}: indeks kata ${r.wordStart}–${r.wordEnd} di luar transkrip (0–${words.length - 1}) atau terlalu panjang`); continue; }
      if (!options.some((o) => o.wordStart === pl.wordStart && o.wordEnd === pl.wordEnd)) options.push(pl);
    }
    const why = clean([p.utama?.alasan, ...p.alternatif.map((a) => a.alasan)].filter(Boolean).join(" "), 300);
    byAsset.set(assetId, options.length ? { options } : { options: [], error: p.cocok ? "Usulan AI tidak sah (indeks kata di luar transkrip)." : `AI tidak menemukan bagian yang cocok.${why ? ` ${why}` : ""}` });
  }
  for (const [key, id] of asked) if (!byAsset.has(id)) byAsset.set(id, { options: [], error: `AI tidak menjawab aset ${key}.` });
  return { byAsset, dropped, catatan: clean(parsed.data.catatan, 1000) };
}

// ------------------------------------------------------------------ isyarat

/**
 * Aset yang DIPAKAI -> isyarat per id bahan, dalam detik video mentah. Hanya aset yang masih ada (`labels`).
 * build-props memetakan waktunya ke timeline hasil; kalimat yang terpotong = tanpa isyarat.
 */
export function ownCuesFrom(state: OwnState | null, labels: Map<string, { label: string; note: string }>): Map<string, AssetCue> {
  const cues = new Map<string, AssetCue>();
  if (!state) return cues;
  for (const it of state.items) {
    const m = labels.get(it.assetId);
    if (it.status !== "dipakai" || !it.chosen || !m) continue;
    cues.set(it.assetId, { mention: it.assetId.slice(0, 8), type: "sendiri", label: m.label, start: it.chosen.startS, end: it.chosen.endS, source: "", ...(m.note ? { keterangan: m.note } : {}) });
  }
  return cues;
}

/** Semua aset yang ada di status sudah diputuskan? */
export const ownDecided = (s: OwnState | null) => !!s && s.items.every((i) => i.status !== "pending");
