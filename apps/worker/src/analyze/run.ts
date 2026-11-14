import { z } from "zod";
import { isFatalForRetry } from "@app/shared/errors";
import { ANALYSIS } from "@app/config";
import type { Provider, SuggestionKind, Word } from "@app/shared";
import type { Silence } from "../media.ts";
import { detectFillers, detectUnclear, quoteOf, spanTimes, type WordRange } from "./detect.ts";
import { LLM_SCHEMA, buildPrompt } from "./prompt.ts";
import { runProvider } from "./providers.ts";

const LlmOutput = z.object({
  suggestions: z.array(
    z.object({
      kind: z.enum(["retake", "correction"]),
      startWord: z.number().int(),
      endWord: z.number().int(),
      reason: z.string().min(1),
    }),
  ),
  unclear: z.array(
    z.object({ startWord: z.number().int(), endWord: z.number().int(), reason: z.string().min(1) }),
  ),
});

type LlmDraft = { kind: "retake" | "correction"; startWord: number; endWord: number; reason: string };
type UnclearDraft = { startWord: number; endWord: number; reason: string };

export type SuggestionInsert = {
  kind: SuggestionKind;
  source: "llm" | "rule" | "silence";
  start_s: number;
  end_s: number;
  orig_start_s: number;
  orig_end_s: number;
  start_word: number | null;
  end_word: number | null;
  reason: string;
  quote: string | null;
};

export type LlmStats = {
  chunks: number;
  retries: number;
  droppedInvalid: number;
  rawSuggestions: number;
  model: string | null;
  usage: Record<string, unknown>[];
};

function chunkRanges(total: number): Array<[number, number]> {
  const size = ANALYSIS.chunkWords;
  const step = size - ANALYSIS.chunkOverlapWords;
  const out: Array<[number, number]> = [];
  for (let from = 0; from < total; from += step) {
    out.push([from, Math.min(from + size, total)]);
    if (from + size >= total) break;
  }
  return out;
}

/** Validasi satu keluaran CLI terhadap kisaran kata chunk. Item di luar kisaran dibuang dan dihitung. */
function validateChunk(
  json: unknown,
  from: number,
  to: number,
): { drafts: LlmDraft[]; unclear: UnclearDraft[]; dropped: number } {
  const parsed = LlmOutput.parse(json);
  let dropped = 0;
  const ok = (a: number, b: number) => a >= from && b < to && a <= b;
  const drafts = parsed.suggestions.filter((s) => (ok(s.startWord, s.endWord) ? true : (dropped++, false)));
  const unclear = parsed.unclear.filter((s) => (ok(s.startWord, s.endWord) ? true : (dropped++, false)));
  return { drafts, unclear, dropped };
}

/** Gabungkan rentang yang tumpang tindih (dari chunk yang overlap atau CLI yang ceroboh). */
function mergeDrafts(drafts: LlmDraft[]): LlmDraft[] {
  const sorted = [...drafts].sort((a, b) => a.startWord - b.startWord || b.endWord - a.endWord);
  const out: LlmDraft[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    if (last && d.startWord <= last.endWord + 0) {
      // tumpang tindih: ambil rentang gabungan; jenis/alasan dari yang lebih lebar
      const lastSpan = last.endWord - last.startWord;
      const dSpan = d.endWord - d.startWord;
      const winner = dSpan > lastSpan ? d : last;
      last.kind = winner.kind;
      last.reason = winner.reason;
      last.endWord = Math.max(last.endWord, d.endWord);
    } else {
      out.push({ ...d });
    }
  }
  return out;
}

async function askChunk(
  provider: Provider,
  words: Word[],
  from: number,
  to: number,
  modelId?: string,
): Promise<{ result: ReturnType<typeof validateChunk>; model: string | null; usage: Record<string, unknown>; retried: boolean }> {
  const prompt = buildPrompt(words, from, to);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await runProvider(provider, prompt, LLM_SCHEMA, ANALYSIS.cliTimeoutMs, [], modelId);
      return { result: validateChunk(r.json, from, to), model: r.model, usage: r.usage, retried: attempt > 0 };
    } catch (e) {
      lastErr = e; // keluaran tak sesuai skema / CLI gagal: coba sekali lagi
      // ...kecuali batas pemakaian / belum login / timeout: mengulang hanya buang kuota dan waktu
      if (e instanceof Error && (isFatalForRetry(e.message) || /melewati batas waktu/.test(e.message))) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function analyzeWithLlm(
  provider: Provider,
  words: Word[],
  onProgress: (fraction: number) => void | Promise<void>,
  /** Id dari AI_MODELS; kosong/tidak ada = bawaan akun CLI. */
  modelId?: string,
): Promise<{ drafts: LlmDraft[]; unclear: UnclearDraft[]; stats: LlmStats }> {
  const ranges = chunkRanges(words.length);
  const all: LlmDraft[] = [];
  const unclear: UnclearDraft[] = [];
  const stats: LlmStats = { chunks: ranges.length, retries: 0, droppedInvalid: 0, rawSuggestions: 0, model: null, usage: [] };

  for (let i = 0; i < ranges.length; i++) {
    const [from, to] = ranges[i];
    const { result, model, usage, retried } = await askChunk(provider, words, from, to, modelId);
    all.push(...result.drafts);
    unclear.push(...result.unclear);
    stats.rawSuggestions += result.drafts.length;
    stats.droppedInvalid += result.dropped;
    if (retried) stats.retries++;
    stats.model = model ?? stats.model;
    stats.usage.push(usage);
    await onProgress((i + 1) / ranges.length);
  }
  return { drafts: mergeDrafts(all), unclear, stats };
}

const overlapsWords = (a: WordRange, b: { startWord: number; endWord: number }) =>
  a.startWord <= b.endWord && b.startWord <= a.endWord;
const overlapsTime = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

/**
 * Susun semua usulan (LLM + aturan + diam). Tidak ada yang diterapkan: semuanya baru usulan (aturan 2).
 */
export function buildSuggestionRows(
  words: Word[],
  llm: { drafts: LlmDraft[]; unclear: UnclearDraft[] },
  silences: Silence[],
): SuggestionInsert[] {
  const rows: SuggestionInsert[] = [];
  const make = (
    kind: SuggestionKind,
    source: SuggestionInsert["source"],
    a: number,
    b: number,
    reason: string,
  ): SuggestionInsert => {
    const t = spanTimes(words, a, b);
    return {
      kind,
      source,
      start_s: t.start,
      end_s: t.end,
      orig_start_s: t.start,
      orig_end_s: t.end,
      start_word: a,
      end_word: b,
      reason,
      quote: quoteOf(words, a, b),
    };
  };

  // 1. retake / correction dari LLM
  for (const d of llm.drafts) rows.push(make(d.kind, "llm", d.startWord, d.endWord, d.reason));

  // 2. filler (aturan), kecuali yang sudah masuk rentang LLM
  for (const f of detectFillers(words)) {
    if (llm.drafts.some((d) => overlapsWords(f, d))) continue;
    const text = words.slice(f.startWord, f.endWord + 1).map((w) => w.text).join(" ");
    rows.push(make("filler", "rule", f.startWord, f.endWord, `Kata penyela "${text}"`));
  }

  // 3. jeda panjang dari ffmpeg silencedetect, disisakan sedikit napas
  const keep = ANALYSIS.keepPauseSec / 2;
  const occupied = rows.map((r) => ({ start: r.start_s, end: r.end_s }));
  for (const s of silences) {
    const start = s.start + keep;
    const end = s.end - keep;
    if (end - start < 0.1) continue;
    if (occupied.some((o) => overlapsTime(o, { start, end }))) continue;
    rows.push({
      kind: "pause",
      source: "silence",
      start_s: start,
      end_s: end,
      orig_start_s: start,
      orig_end_s: end,
      start_word: null,
      end_word: null,
      reason: `Jeda diam ${(s.end - s.start).toFixed(1)} dtk (disisakan ${ANALYSIS.keepPauseSec} dtk)`,
      quote: null,
    });
  }

  // 4. tidak bisa dinilai (aturan 7): dari LLM dan dari confidence transkrip rendah
  for (const u of llm.unclear) rows.push(make("unclear", "llm", u.startWord, u.endWord, `Tidak bisa dinilai: ${u.reason}`));
  for (const r of detectUnclear(words)) {
    if (llm.unclear.some((u) => overlapsWords(r, u))) continue;
    rows.push(make("unclear", "rule", r.startWord, r.endWord, "Tidak bisa dinilai: transkrip di bagian ini tidak yakin (confidence rendah)"));
  }

  return rows.sort((a, b) => a.start_s - b.start_s);
}
