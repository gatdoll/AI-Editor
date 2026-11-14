// Log aktivitas langsung per job (apa yang sedang dikerjakan AI: query pencarian, halaman yang dibuka, berkas yang ditulis).
// Disimpan di job.payload.activity (entri terakhir saja) supaya UI bisa menampilkannya tanpa migrasi.
// Semua penulisan payload job lewat `patch` di sini, supaya tahap (stageLabel) dan aktivitas tidak saling menimpa.
import type { SupabaseClient } from "@supabase/supabase-js";

export type ActivityEntry = { t: number; text: string };

const MAX_ENTRIES = 60;
const MAX_TEXT = 220;
const FLUSH_MS = 1200;

export type ActivityLog = {
  /** Catat satu baris. Baris yang sama berturut-turut digabung. */
  add: (text: string) => void;
  /** Ubah field payload lain (stage, stageLabel, ...) dan tulis langsung bersama aktivitasnya. */
  patch: (fields: Record<string, unknown>) => Promise<void>;
  /** Tulis sisa aktivitas yang belum tersimpan. */
  flush: () => Promise<void>;
};

export function activityLog(db: SupabaseClient, job: { id: string; payload: Record<string, unknown> }): ActivityLog {
  const t0 = Date.now();
  const entries: ActivityEntry[] = [];
  job.payload.activity = entries;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const write = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const snapshot = { ...job.payload, activity: entries.slice() };
    chain = chain.then(() => db.from("jobs").update({ payload: snapshot }).eq("id", job.id)).catch(() => {});
    return chain as Promise<void>;
  };

  return {
    add(raw) {
      const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      if (!text || entries.at(-1)?.text === text) return;
      entries.push({ t: Math.round((Date.now() - t0) / 1000), text });
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      timer ??= setTimeout(() => void write(), FLUSH_MS);
    },
    patch(fields) {
      Object.assign(job.payload, fields);
      return write();
    },
    flush: () => write(),
  };
}

const base = (p: unknown) => (typeof p === "string" ? p.split(/[\\/]/).pop() ?? p : "");
const host = (u: unknown) => { try { return new URL(String(u)).hostname.replace(/^www\./, ""); } catch { return String(u ?? "").slice(0, 80); } };

/** Ringkas satu tool_use Claude Code jadi kalimat untuk pengguna. */
export function describeClaudeTool(name: string, input: Record<string, unknown>): string | null {
  switch (name) {
    case "WebSearch": return `Mencari di web: “${String(input.query ?? "")}”`;
    case "WebFetch": return `Membuka halaman ${host(input.url)}`;
    case "Read": return `Membaca ${base(input.file_path)}`;
    case "Write": return `Menulis ${base(input.file_path)}`;
    case "Edit": return `Mengubah ${base(input.file_path)}`;
    case "Glob": return `Melihat daftar berkas ${String(input.pattern ?? "")}`;
    case "Grep": return `Mencari “${String(input.pattern ?? "")}” di berkas`;
    case "Skill": return `Memakai skill ${String(input.skill ?? input.name ?? "")}`;
    case "StructuredOutput": return "Menyusun hasil akhir";
    default: return `Memakai ${name}`;
  }
}

/** Ubah satu baris stream-json Claude Code menjadi baris aktivitas. */
export function claudeStreamActivity(line: Record<string, unknown>): string[] {
  if (line.type !== "assistant") return [];
  const content = (line.message as { content?: Array<Record<string, unknown>> } | undefined)?.content ?? [];
  const out: string[] = [];
  for (const c of content) {
    if (c.type === "tool_use") { const d = describeClaudeTool(String(c.name), (c.input ?? {}) as Record<string, unknown>); if (d) out.push(d); }
    else if (c.type === "text" && typeof c.text === "string" && c.text.trim()) out.push(`AI: ${c.text.trim()}`);
    else if (c.type === "thinking") out.push("AI sedang berpikir…");
  }
  return out;
}

/** Ubah satu baris `codex exec --json` menjadi baris aktivitas. */
export function codexStreamActivity(line: Record<string, unknown>): string[] {
  const item = line.item as Record<string, unknown> | undefined;
  if (!item) return line.type === "turn.started" ? ["Codex mulai bekerja"] : [];
  if (item.type === "web_search") {
    if (line.type !== "item.completed") return ["Mencari di web…"];
    const a = (item.action ?? {}) as Record<string, unknown>;
    if (a.type === "open_page" && a.url) return [`Membuka halaman ${host(a.url)}`];
    if (a.type === "find_in_page") return [`Mencari “${String(a.pattern ?? "")}” di ${host(a.url)}`];
    const q = String(a.query ?? item.query ?? "").trim();
    return q ? [`Mencari di web: “${q}”`] : [];
  }
  if (line.type !== "item.completed") return [];
  if (item.type === "agent_message" && typeof item.text === "string") {
    const t = item.text.trim();
    return t && !t.startsWith("{") ? [`AI: ${t}`] : t ? ["Menyusun hasil akhir"] : [];
  }
  if (item.type === "reasoning") return ["AI sedang berpikir…"];
  return [];
}
