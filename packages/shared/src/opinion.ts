// Fase 19: Opinion Motion. Tipe data riset aset, skema keluaran AI, dan validasinya. Murni (tanpa fs/db): dipakai web, worker, tes.
// AI hanya MENGUSULKAN sebutan dan URL; kode kita yang mengunduh, memotret, dan pengguna yang memilih (tidak ada aset tanpa persetujuan).
import { z } from "zod";
import { OPINION } from "@app/config";
import type { ReferenceAttachment } from "./reference.ts";
/** Sama dengan `Provider` di index.ts; didefinisikan di sini agar modul murni ini tidak menarik kode Node (dipakai paket remotion). */
type Provider = "claude" | "codex";

export type MentionType = (typeof OPINION.types)[number];
export type ArticleFocus = "judul" | "kutipan" | "atas";
export const ARTICLE_FOCUS: readonly ArticleFocus[] = ["judul", "kutipan", "atas"];
export const MENTION_LABEL: Record<MentionType, string> = { tokoh: "Tokoh", berita: "Berita", brand: "Brand", tempat: "Tempat" };

/** Permintaan screenshot artikel: dari AI, lalu bisa diubah pengguna (instruksi). */
export type ArticleRequest = { url: string; title: string; publisher: string; fokus: ArticleFocus; kutipan?: string; sorot: boolean };

/** Satu kandidat aset. `error` = gagal diunduh/dipotret; tetap disimpan agar alasannya terlihat (aturan 7). */
export type Candidate = {
  id: string;
  kind: "gambar" | "screenshot" | "unggahan";
  /** Path relatif folder media (projects/<id>/opini/...). Tidak ada bila gagal. */
  file?: string;
  mime?: string;
  width?: number;
  height?: number;
  /** URL file gambar asli / halaman tempat gambar itu ditemukan. */
  sourceUrl?: string;
  pageUrl?: string;
  /** Nama sumber untuk kredit di layar (publisher atau domain). */
  source: string;
  alasan?: string;
  error?: string;
  /** Screenshot artikel: yang benar-benar ada di halaman (bukan tebakan AI). */
  article?: { url: string; title: string; publisher: string | null; date: string | null; fokus: ArticleFocus; kutipan?: string; sorot: boolean; kutipanDitemukan: boolean | null; catatan: string[] };
};

export type MentionStatus = "pending" | "dipilih" | "tidak-dipakai";

export type Mention = {
  id: string;
  type: MentionType;
  label: string;
  /** Indeks kata voice over (inklusif) saat sebutan diucapkan, dan detiknya. */
  wordStart: number;
  wordEnd: number;
  startS: number;
  endS: number;
  /** Potongan kalimat di sekitar sebutan (untuk ditampilkan). */
  context: string;
  query: string;
  article?: ArticleRequest;
  candidates: Candidate[];
  status: MentionStatus;
  chosen?: string;
  /** Bahan project (assets kind material) hasil pilihan. */
  assetId?: string;
  /** Tidak ada kandidat yang berhasil: alasan (aturan 7, tidak diganti tebakan). */
  error?: string;
};

export type OpinionState = {
  version: 1;
  /** Voice over yang menjadi dasar indeks kata. Berbeda dengan voice over aktif = waktu sebutan kedaluwarsa. */
  voiceoverJobId: string;
  brief: string;
  provider: Provider;
  model: string | null;
  updatedAt: string;
  mentions: Mention[];
  warnings: string[];
  /** Fase 22: video referensi gaya dari brief pertama; dipakai saat "Buat motion" kecuali dilepas pengguna. */
  reference?: ReferenceAttachment;
};

export type OpinionWord = { text: string; start: number; end: number };

// ------------------------------------------------------------------ keluaran AI

/** Skema JSON untuk CLI (`--json-schema` / `--output-schema`). Semua kunci wajib (Codex mode ketat); kosong = null. */
export const RESEARCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mentions", "catatan"],
  properties: {
    mentions: {
      type: "array",
      maxItems: OPINION.maxMentions,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "label", "wordStart", "wordEnd", "query", "images", "article"],
        properties: {
          type: { type: "string", enum: [...OPINION.types] },
          label: { type: "string" },
          wordStart: { type: "integer" },
          wordEnd: { type: "integer" },
          query: { type: "string" },
          images: {
            type: "array",
            maxItems: OPINION.maxCandidates,
            items: { type: "object", additionalProperties: false, required: ["imageUrl", "pageUrl", "alasan"], properties: { imageUrl: { type: "string" }, pageUrl: { type: "string" }, alasan: { type: "string" } } },
          },
          article: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["url", "title", "publisher", "fokus", "kutipan"],
            properties: { url: { type: "string" }, title: { type: "string" }, publisher: { type: "string" }, fokus: { type: "string", enum: [...ARTICLE_FOCUS] }, kutipan: { type: ["string", "null"] } },
          },
        },
      },
    },
    catatan: { type: "string" },
  },
} as const;

const Raw = z.object({
  mentions: z.array(z.object({
    type: z.string(),
    label: z.string(),
    wordStart: z.number(),
    wordEnd: z.number(),
    query: z.string().optional().default(""),
    images: z.array(z.object({ imageUrl: z.string(), pageUrl: z.string().optional().default(""), alasan: z.string().optional().default("") })).optional().default([]),
    article: z.object({ url: z.string(), title: z.string().optional().default(""), publisher: z.string().optional().default(""), fokus: z.string().optional().default("judul"), kutipan: z.string().nullable().optional() }).nullable().optional(),
  })),
  catatan: z.string().optional().default(""),
});

export type ResearchMention = Omit<Mention, "id" | "candidates" | "status" | "chosen" | "assetId" | "error"> & { images: Array<{ imageUrl: string; pageUrl: string; alasan: string }> };

const httpUrl = (s: string) => { try { const u = new URL(s.trim()); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch { return null; } };
export const domainOf = (url: string | undefined) => { try { return new URL(url ?? "").hostname.replace(/^www\./, ""); } catch { return ""; } };
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Potongan kalimat di sekitar rentang kata (beberapa kata sebelum/sesudah). */
export function contextOf(words: OpinionWord[], start: number, end: number, around = 5): string {
  const a = Math.max(0, start - around), b = Math.min(words.length - 1, end + around);
  return `${a > 0 ? "…" : ""}${words.slice(a, b + 1).map((w) => w.text.trim()).join(" ")}${b < words.length - 1 ? "…" : ""}`;
}

/**
 * Validasi keluaran AI terhadap kata voice over. Yang tidak sah dibuang dengan alasan (bukan diperbaiki diam-diam):
 * jenis tak dikenal, indeks kata di luar rentang, URL bukan http(s), berita tanpa artikel.
 */
export function checkResearch(raw: unknown, words: OpinionWord[]): { mentions: ResearchMention[]; dropped: string[]; catatan: string } {
  const parsed = Raw.safeParse(raw);
  if (!parsed.success) return { mentions: [], dropped: [`Keluaran AI tidak sesuai skema: ${parsed.error.issues[0]?.message ?? "?"}`], catatan: "" };
  const dropped: string[] = [];
  const out: ResearchMention[] = [];
  const n = words.length;
  for (const m of parsed.data.mentions) {
    const label = clean(m.label, 80);
    const tag = `"${label || "?"}"`;
    if (!(OPINION.types as readonly string[]).includes(m.type)) { dropped.push(`${tag}: jenis "${m.type}" tidak dikenal`); continue; }
    if (!label) { dropped.push("sebutan tanpa nama"); continue; }
    const ws = Math.round(m.wordStart), we = Math.round(m.wordEnd);
    if (!Number.isInteger(ws) || !Number.isInteger(we) || ws < 0 || we >= n || we < ws || we - ws > 40) { dropped.push(`${tag}: indeks kata ${m.wordStart}–${m.wordEnd} di luar naskah (0–${n - 1})`); continue; }
    const type = m.type as MentionType;
    const seen = new Set<string>();
    const images = type === "berita" ? [] : m.images.flatMap((im) => {
      const u = httpUrl(im.imageUrl);
      if (!u || seen.has(u)) return [];
      seen.add(u);
      return [{ imageUrl: u, pageUrl: httpUrl(im.pageUrl) ?? "", alasan: clean(im.alasan, 200) }];
    }).slice(0, OPINION.maxCandidates);
    let article: ArticleRequest | undefined;
    if (type === "berita") {
      const url = m.article ? httpUrl(m.article.url) : null;
      if (!url) { dropped.push(`${tag}: berita tanpa link artikel yang sah`); continue; }
      const kutipan = clean(m.article?.kutipan ?? "", 300);
      const fokus = (ARTICLE_FOCUS as readonly string[]).includes(m.article!.fokus) ? (m.article!.fokus as ArticleFocus) : "judul";
      article = { url, title: clean(m.article!.title, 300), publisher: clean(m.article!.publisher, 80) || domainOf(url), fokus: fokus === "kutipan" && !kutipan ? "judul" : fokus, ...(kutipan ? { kutipan } : {}), sorot: !!kutipan };
    } else if (!images.length) {
      dropped.push(`${tag}: AI tidak memberi URL gambar yang sah`);
    }
    out.push({ type, label, wordStart: ws, wordEnd: we, startS: words[ws].start, endS: words[we].end, context: contextOf(words, ws, we), query: clean(m.query, 200) || label, images, ...(article ? { article } : {}) });
  }
  out.sort((a, b) => a.wordStart - b.wordStart);
  if (out.length > OPINION.maxMentions) dropped.push(`${out.length - OPINION.maxMentions} sebutan terakhir dilewati (maks ${OPINION.maxMentions})`);
  return { mentions: out.slice(0, OPINION.maxMentions), dropped, catatan: clean(parsed.data.catatan, 1000) };
}

// ------------------------------------------------------------------ status & motion

/** Semua sebutan sudah diputuskan (dipilih atau tidak dipakai)? Syarat tombol "Buat motion". */
export const allDecided = (s: OpinionState | null) => !!s && s.mentions.every((m) => m.status !== "pending");

/**
 * Isyarat aset untuk kode AI: kapan disebut, siapa/apa, dan sumber untuk kredit.
 * Fase 21: type "sendiri" = gambar milik pengguna di video bicara; `keterangan` = tulisan pengguna tentang isi gambar.
 * Waktunya disimpan dalam detik video mentah dan dipetakan ke timeline hasil oleh build-props (mapAssetCues).
 */
export type AssetCue = { mention: string; type: MentionType | "sendiri"; label: string; start: number; end: number; source: string; keterangan?: string; article?: { title: string; kutipan?: string; kutipanDitemukan: boolean | null } };

/**
 * Bahan yang dipilih -> isyarat per id bahan. Voice over berbeda dari dasar riset = waktu kedaluwarsa: tidak ada isyarat
 * (aset tetap bisa dipakai, tetapi tidak dijanjikan sinkron), dan UI meminta riset ulang.
 */
export function assetCues(state: OpinionState | null, voiceoverJobId: string | null | undefined): Map<string, AssetCue> {
  const cues = new Map<string, AssetCue>();
  if (!state || !voiceoverJobId || state.voiceoverJobId !== voiceoverJobId) return cues;
  for (const m of state.mentions) {
    if (m.status !== "dipilih" || !m.assetId) continue;
    const c = m.candidates.find((x) => x.id === m.chosen);
    if (!c) continue;
    cues.set(m.assetId, {
      mention: m.id, type: m.type, label: m.label, start: m.startS, end: m.endS, source: c.source,
      ...(c.article ? { article: { title: c.article.title, ...(c.article.kutipan ? { kutipan: c.article.kutipan } : {}), kutipanDitemukan: c.article.kutipanDitemukan } } : {}),
    });
  }
  return cues;
}
