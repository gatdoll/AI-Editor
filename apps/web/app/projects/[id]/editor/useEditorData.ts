"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzersState, AssetRow, ProjectRow, SuggestionRow, TranscriptRow } from "@app/shared";
import { stableStringify } from "@app/shared/prompt-undo";
import { DEFAULT_STYLE, normalizeStyle, type StyleChoice } from "@app/remotion/src/build-props.ts";
import type { JobLite } from "../Pipeline";
import type { ReferenceAttachment, ReferenceReport } from "@app/shared/reference";
import { MANUAL } from "@app/config";
import type { ReelClip } from "@app/shared/reel";

export type TranscriptMeta = Pick<TranscriptRow, "id" | "language" | "engine" | "model" | "updated_at"> & { edited: boolean };
export type Detail = { project: ProjectRow; asset: AssetRow | null; jobs: JobLite[]; transcript: TranscriptMeta | null;
  /** Fase 16: semua video project (urut unggah) dan posisinya di sumbu reel. */
  assets?: Array<AssetRow & { label: string }>; reel?: { clips: ReelClip[]; durationS: number } };

export type PromptItem = {
  reference?: ReferenceAttachment | null;
  referenceReport?: ReferenceReport | null;
  progress?: number;
  id: string;
  prompt: string;
  provider: "claude" | "codex";
  status: "queued" | "running" | "done" | "failed";
  reply: string | null;
  ops: Array<{ type: string }>;
  messages: string[];
  rejected: Array<{ reason: string }>;
  undone: boolean;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
  canUndo: boolean;
  createdSuggestions: number;
};

export type ExportInfo = {
  edl: { id: string; version: number; segments: Array<{ start: number; end: number }>; params: { keptS: number; removedS: number; approvedCount: number }; created_at: string } | null;
  renderJob: { status: string; progress: number; error: string | null; payload: { edlVersion?: number } } | null;
  outputs: Array<{ id: string; edl_id: string | null; size_bytes: number | null; duration_s: number | null; width: number | null; height: number | null; created_at: string }>;
};

async function getJson<T>(url: string): Promise<{ ok: boolean; status: number; body: T }> {
  const r = await fetch(url);
  return { ok: r.ok, status: r.status, body: (await r.json().catch(() => ({}))) as T };
}

export function useEditorData(projectId: string) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [transcript, setTranscript] = useState<TranscriptRow | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState<ExportInfo | null>(null);
  const [analyzers, setAnalyzers] = useState<{ analyzers: AnalyzersState | null; stale: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [style, setStyleState] = useState<StyleChoice>(DEFAULT_STYLE);
  const [styleSave, setStyleSave] = useState("Tersimpan");
  const [styleError, setStyleError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const past = useRef<StyleChoice[]>([]), future = useRef<StyleChoice[]>([]);
  const gestureKey = useRef<string | undefined>(undefined);
  const currentStyle = useRef(style), savedStyle = useRef(style);
  const saving = useRef<Promise<boolean> | null>(null);

  const styleInit = useRef(false);
  const styleEditedAt = useRef(0);
  const putTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptKey = useRef<string | null>(null);
  const prevRunning = useRef<Set<string>>(new Set());

  const loadSuggestions = useCallback(async () => {
    const r = await getJson<{ suggestions?: SuggestionRow[] }>(`/api/projects/${projectId}/suggestions`);
    if (r.ok) setSuggestions(r.body.suggestions ?? []);
  }, [projectId]);

  const loadPrompts = useCallback(async () => {
    const r = await getJson<{ prompts?: PromptItem[]; error?: string }>(`/api/projects/${projectId}/prompts`);
    if (r.ok) {
      setPrompts(r.body.prompts ?? []);
      setPromptsError(null);
    } else {
      // tabel prompt_runs belum ada (migrasi Fase 8 belum dijalankan) atau error lain
      setPromptsError(r.body.error ?? `HTTP ${r.status}`);
    }
    return r.ok ? (r.body.prompts ?? []) : [];
  }, [projectId]);

  const loadExport = useCallback(async () => {
    const r = await getJson<ExportInfo>(`/api/projects/${projectId}/export`);
    if (r.ok) setExportInfo(r.body);
  }, [projectId]);

  const loadDetail = useCallback(async () => {
    const r = await getJson<Detail & { error?: string }>(`/api/projects/${projectId}`);
    if (!r.ok) {
      setLoadError(r.body.error ?? `HTTP ${r.status}`);
      return null;
    }
    setLoadError(null);
    setDetail(r.body);
    return r.body;
  }, [projectId]);

  const loadTranscript = useCallback(
    async (meta: TranscriptMeta | null) => {
      if (!meta) return;
      const key = `${meta.id}:${meta.updated_at}`;
      if (transcriptKey.current === key) return;
      transcriptKey.current = key;
      const r = await getJson<{ transcript?: TranscriptRow }>(`/api/transcripts/${meta.id}`);
      if (r.ok && r.body.transcript) setTranscript(r.body.transcript);
      else transcriptKey.current = null;
    },
    [],
  );

  const loadAnalyzers = useCallback(async () => {
    const r = await getJson<{ analyzers: AnalyzersState | null; stale: boolean }>("/api/analyzers");
    if (r.ok) setAnalyzers(r.body);
  }, []);

  /** Muat ulang semuanya (setelah aksi pengguna). */
  const reloadAll = useCallback(async () => {
    const d = await loadDetail();
    if (d && !putTimer.current && !saving.current && stableStringify(currentStyle.current) === stableStringify(savedStyle.current)) {
      const next = normalizeStyle(d.project.style as never);
      currentStyle.current = savedStyle.current = next; setStyleState(next);
      past.current = []; future.current = []; setHistoryVersion((n) => n + 1);
    }
    await Promise.all([loadTranscript(d?.transcript ?? null), loadSuggestions(), loadPrompts(), loadExport()]);
  }, [loadDetail, loadTranscript, loadSuggestions, loadPrompts, loadExport]);

  useEffect(() => {
    void reloadAll();
    void loadAnalyzers();
    const t = setInterval(() => void loadAnalyzers(), 30000);
    return () => clearInterval(t);
  }, [reloadAll, loadAnalyzers]);

  // Gaya awal dari server (sekali)
  useEffect(() => {
    if (styleInit.current || !detail) return;
    styleInit.current = true;
    const next = normalizeStyle(detail.project.style as never);
    currentStyle.current = savedStyle.current = next; setStyleState(next);
  }, [detail]);

  const promptRunning = prompts.some((p) => p.status === "queued" || p.status === "running");
  const renderRunning = exportInfo?.renderJob?.status === "queued" || exportInfo?.renderJob?.status === "running";
  const projectBusy = !!detail && ["ingesting", "transcribing", "analyzing", "uploading"].includes(detail.project.status);
  const polling = promptRunning || renderRunning || projectBusy;

  useEffect(() => {
    if (!polling) return;
    for (const p of prompts) if (p.status === "queued" || p.status === "running") prevRunning.current.add(p.id);
    const t = setInterval(async () => {
      const d = await loadDetail();
      const ps = await loadPrompts();
      await loadExport();
      // Perintah baru selesai: usulan, gaya, dan transkrip mungkin berubah
      const nowRunning = new Set(ps.filter((p) => p.status === "queued" || p.status === "running").map((p) => p.id));
      const finished = [...prevRunning.current].some((id) => !nowRunning.has(id));
      prevRunning.current = nowRunning;
      if (finished || projectBusy) {
        const latest = finished ? await loadDetail() : d;
        await Promise.all([loadSuggestions(), loadTranscript(latest?.transcript ?? null)]);
        // gaya dari server menang, kecuali pengguna baru saja mengubahnya sendiri
        if (latest && !putTimer.current && !saving.current && stableStringify(currentStyle.current) === stableStringify(savedStyle.current)) {
          const server = normalizeStyle(latest.project.style as never);
          if (stableStringify(server) !== stableStringify(currentStyle.current)) {
            currentStyle.current = savedStyle.current = server;
            past.current = []; future.current = []; setHistoryVersion((n) => n + 1);
            setStyleState(server);
          }
        }
      }
    }, 1500);
    return () => clearInterval(t);
  }, [polling, projectBusy, loadDetail, loadPrompts, loadExport, loadSuggestions, loadTranscript]);

  // One serialized save queue, with an optimistic concurrency check. Never hide failures.
  const flushStyle = useCallback(async (): Promise<boolean> => {
    if (putTimer.current) { clearTimeout(putTimer.current); putTimer.current = null; }
    if (saving.current) return saving.current;
    const work = async () => {
      try {
        while (stableStringify(currentStyle.current) !== stableStringify(savedStyle.current)) {
          const next = currentStyle.current, baseStyle = savedStyle.current;
          setStyleSave("Menyimpan…");
          const r = await fetch(`/api/projects/${projectId}/style`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ style: next, baseStyle }) });
          const body = await r.json().catch(() => ({ error: `Server belum siap menyimpan (HTTP ${r.status}). Coba simpan lagi.` }));
          if (!r.ok) throw new Error(body.error ?? "Gagal menyimpan edit");
          savedStyle.current = normalizeStyle(body.style);
        }
        setStyleSave("Tersimpan"); setStyleError(null); return true;
      } catch (e) { setStyleSave("Belum tersimpan"); setStyleError(e instanceof Error ? e.message : "Gagal menyimpan edit"); return false; }
    };
    saving.current = work();
    try { return await saving.current; } finally { saving.current = null; }
  }, [projectId]);
  const scheduleStyle = useCallback((next: StyleChoice) => {
    currentStyle.current = next; setStyleState(next); styleEditedAt.current = Date.now();
    setStyleSave("Perubahan belum tersimpan");
    if (putTimer.current) clearTimeout(putTimer.current);
    putTimer.current = setTimeout(() => { putTimer.current = null; void flushStyle(); }, 500);
  }, [flushStyle]);
  /** Immediate preview; coalesce slider gestures into one undo entry. */
  const updateStyle = useCallback(
    (patch: Partial<StyleChoice>, group?: string) => {
      if (promptRunning) return;
      const cur = currentStyle.current, next = normalizeStyle({ ...cur, ...patch });
      if (stableStringify(cur) === stableStringify(next)) return;
      if (!group || !putTimer.current || gestureKey.current !== group) past.current = [...past.current, cur].slice(-MANUAL.historySize);
      gestureKey.current = group;
      future.current = []; setHistoryVersion((n) => n + 1); scheduleStyle(next);
    },
    [promptRunning, scheduleStyle],
  );
  const undoStyle = useCallback(() => { if (promptRunning) return; const prev = past.current.pop(); if (!prev) return; future.current.push(currentStyle.current); scheduleStyle(prev); setHistoryVersion((n) => n + 1); }, [promptRunning, scheduleStyle]);
  const redoStyle = useCallback(() => { if (promptRunning) return; const next = future.current.pop(); if (!next) return; past.current.push(currentStyle.current); scheduleStyle(next); setHistoryVersion((n) => n + 1); }, [promptRunning, scheduleStyle]);
  const discardLocalStyle = useCallback(async () => {
    if (saving.current) await saving.current;
    if (putTimer.current) { clearTimeout(putTimer.current); putTimer.current = null; }
    const data = await loadDetail(); if (!data) return;
    const next = normalizeStyle(data.project.style as never);
    currentStyle.current = savedStyle.current = next; setStyleState(next);
    past.current = []; future.current = []; setHistoryVersion((n) => n + 1); setStyleError(null); setStyleSave("Tersimpan");
  }, [loadDetail]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (stableStringify(currentStyle.current) !== stableStringify(savedStyle.current)) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => { window.removeEventListener("beforeunload", warn); if (putTimer.current) clearTimeout(putTimer.current); }; }, []);

  const applySuggestion = useCallback((s: SuggestionRow) => {
    setSuggestions((cur) => cur.map((x) => (x.id === s.id ? s : x)));
  }, []);

  const words = useMemo(() => transcript?.words ?? [], [transcript]);

  /**
   * Koreksi teks satu kata (typo subtitle). Waktu kata tidak berubah, jadi cut dan EDL tetap. Pratinjau langsung
   * memakai teks baru; render membaca transkrip yang sama. Hasil mesin tetap tersimpan di original_words (server).
   */
  const saveWord = useCallback(async (i: number, text: string): Promise<string | null> => {
    const t = transcript;
    const clean = text.replace(/\s+/g, " ").trim();
    if (!t || !t.words[i] || !clean || clean === t.words[i].text) return null;
    if (promptRunning) return "Perintah sedang berjalan dan bisa mengubah transkrip. Koreksi setelah selesai.";
    const next = t.words.map((w, k) => (k === i ? { ...w, text: clean } : w));
    setTranscript({ ...t, words: next });
    const r = await fetch(`/api/transcripts/${t.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ words: next }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setTranscript(t);
      return body.error ?? "Gagal menyimpan koreksi";
    }
    // Versi yang baru disimpan sudah ada di memori: jangan diunduh ulang
    transcriptKey.current = `${t.id}:${body.updated_at}`;
    setTranscript((cur) => (cur && cur.id === t.id ? { ...cur, words: next, original_words: cur.original_words ?? t.words, updated_at: body.updated_at } : cur));
    return null;
  }, [transcript, promptRunning]);

  return {
    detail, transcript, words, suggestions, prompts, promptsError, exportInfo, analyzers, loadError, style,
    promptRunning, renderRunning,
    styleSave, styleError, flushStyle, discardLocalStyle, undoStyle, redoStyle, canUndoStyle: historyVersion >= 0 && past.current.length > 0, canRedoStyle: future.current.length > 0,
    updateStyle, applySuggestion, saveWord, reloadAll, loadSuggestions, loadPrompts, loadExport, loadDetail,
  };
}
