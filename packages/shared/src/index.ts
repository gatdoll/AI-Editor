import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/** Nilai assets.storage_bucket untuk file yang disimpan di disk lokal. */
export const LOCAL_STORE = "local";

function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        if (JSON.parse(fs.readFileSync(pkg, "utf8")).workspaces) return dir;
      } catch {
        // package.json rusak: lanjut naik
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** Folder tempat semua media. Bawaan: <root repo>/data/media. Ganti lewat env MEDIA_DIR. */
export function mediaDir(): string {
  // Folder media sengaja dinamis (env / root repo): jangan biarkan bundler menelusuri seluruh proyek
  return path.resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR ?? path.join(findRepoRoot(), "data", "media"));
}

/** Ruang kosong (byte) di drive tempat `dir` berada. Naik ke folder induk yang sudah ada. null = tidak bisa ditentukan. */
export function freeDiskBytes(dir: string): number | null {
  let d = path.resolve(dir);
  for (let i = 0; i < 12; i++) {
    try {
      const st = fs.statfsSync(d);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      const parent = path.dirname(d);
      if (parent === d) return null;
      d = parent;
    }
  }
  return null;
}

/** Path absolut dari path relatif di DB. Menolak path yang keluar dari folder media. */
export function resolveMediaPath(relative: string): string {
  const base = mediaDir();
  const full = path.resolve(base, relative);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error("Path di luar folder media");
  }
  return full;
}

export const ProjectStatus = z.enum([
  "created",
  "uploading",
  "ingesting",
  "transcribing",
  "ready",
  "analyzing",
  "failed",
]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const JobType = z.enum(["ingest", "transcribe", "analyze", "render", "prompt", "creative", "preview", "denoise", "voiceover", "assets"]);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum(["queued", "running", "done", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

// Satu kata hasil transkrip. Satuan waktu: detik dari awal file mentah.
export const WordSchema = z.object({
  text: z.string(),
  start: z.number().min(0),
  end: z.number().min(0),
  confidence: z.number().min(0).max(1).nullable(),
});
export type Word = z.infer<typeof WordSchema>;
export const WordsSchema = z.array(WordSchema);

export type ProjectRow = {
  id: string;
  name: string;
  style: Record<string, unknown>;
  status: ProjectStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export const CreativeStatus = z.enum(["draft", "aktif", "ditolak", "gagal"]);
export type CreativeStatus = z.infer<typeof CreativeStatus>;

/** Satu versi kode Mode Kreatif (tabel creative_versions). Versi lama tidak pernah dihapus otomatis. */
export type CreativeVersionRow = {
  id: string;
  project_id: string;
  prompt: string;
  model: string;
  code_overlay: string | null;
  code_video: string | null;
  replaces_captions: boolean;
  notes: string | null;
  stills: string[];
  /** Commit skill yang dipakai: { remotion, shotcraft, toolkit }. */
  skill_refs: Record<string, string>;
  status: CreativeStatus;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
};

export type AssetRow = {
  id: string;
  project_id: string;
  kind: "raw" | "audio" | "output";
  storage_bucket: string;
  storage_path: string;
  size_bytes: number | null;
  sha256: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  created_at: string;
  /** Fase 11: salinan pratinjau untuk browser (null = belum diperiksa / migrasi belum dijalankan). */
  preview_status?: "tidak_perlu" | "antre" | "siap" | "gagal" | null;
  preview_path?: string | null;
  preview_error?: string | null;
  /** Fase 16: posisi video ini pada sumbu waktu reel project (detik). null = belum diingest. */
  reel_offset_s?: number | null;
};

export type TranscriptRow = {
  id: string;
  asset_id: string;
  language: string | null;
  engine: string;
  model: string | null;
  words: Word[];
  original_words: Word[] | null;
  created_at: string;
  updated_at: string;
};

export type JobRow = {
  id: string;
  project_id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  payload: Record<string, unknown>;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

/**
 * Klien service role. HANYA untuk kode server (route handler, worker).
 * Jangan diimpor dari komponen "use client" (aturan 6).
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diisi di .env");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Nama file aman untuk path storage. */
export function safeFileName(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  const out = cleaned.slice(-120);
  // "." dan ".." adalah segmen path khusus: jangan pernah dikembalikan sebagai nama file
  return out === "" || out === "." || out === ".." ? "video" : out;
}

export const Provider = z.enum(["claude", "codex"]);
export type Provider = z.infer<typeof Provider>;

export type SuggestionKind = "retake" | "correction" | "filler" | "pause" | "unclear" | "custom";
export type SuggestionStatus = "pending" | "approved" | "rejected";

export type SuggestionRow = {
  id: string;
  run_id: string | null;
  prompt_run_id: string | null;
  project_id: string;
  kind: SuggestionKind;
  source: "llm" | "rule" | "silence" | "prompt";
  start_s: number;
  end_s: number;
  orig_start_s: number;
  orig_end_s: number;
  start_word: number | null;
  end_word: number | null;
  reason: string;
  quote: string | null;
  status: SuggestionStatus;
};

export type AnalysisRunRow = {
  id: string;
  project_id: string;
  asset_id: string;
  provider: Provider;
  model: string | null;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  stats: Record<string, unknown>;
  duration_ms: number | null;
  created_at: string;
  finished_at: string | null;
};

export type AnalyzerStatus = {
  installed: boolean;
  loggedIn: boolean;
  version?: string;
  detail: string;
};
/** jobTypes: jenis job yang diambil worker yang sedang hidup (tidak ada = worker versi lama). */
export type AnalyzersState = Record<Provider, AnalyzerStatus> & { checkedAt: string; jobTypes?: string[] };

export type PromptRunRow = {
  id: string;
  project_id: string;
  prompt: string;
  provider: Provider;
  status: "queued" | "running" | "done" | "failed";
  reply: string | null;
  ops: unknown[];
  rejected: Array<{ raw: unknown; reason: string }>;
  messages: string[];
  undo: Record<string, unknown>;
  undone: boolean;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  finished_at: string | null;
};
