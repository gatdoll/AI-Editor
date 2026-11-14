"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisRunRow, AnalyzersState, Provider, SuggestionKind, SuggestionRow } from "@app/shared";
import { Player } from "@remotion/player";
import { ASPECTS, STYLES, VIDEO, type AspectId, type StyleId, SFX } from "@app/config";
import { Edited } from "@app/remotion/src/compositions/Edited.tsx";
import { DEFAULT_STYLE, buildEditedProps, normalizeStyle, seedFrom, type StyleChoice } from "@app/remotion/src/build-props.ts";
import { buildEdl, cutSlack } from "@app/shared/edl";
import { ErrorBox } from "./ErrorBox";
import { useCreativeCode } from "../../../lib/use-creative-code";
import { useMaterials } from "../../../lib/use-materials";
import { materialAssets } from "@app/remotion/src/motion-props.ts";

type EdlRow = { id: string; version: number; run_id: string | null; segments: { start: number; end: number }[]; created_at: string; params: { removedS: number; keptS: number; approvedCount: number; skippedTooShort: number } };
type AnalysisData = {
  runs: AnalysisRunRow[];
  selectedRunId: string | null;
  suggestions: SuggestionRow[];
  edl: EdlRow | null;
  analyzeJob: { status: string; progress: number; error: string | null } | null;
  renderJob: { status: string; progress: number; error: string | null; payload: { edlVersion?: number } } | null;
  outputs: OutputRow[];
};
type OutputRow = { id: string; edl_id: string | null; size_bytes: number | null; duration_s: number | null; width: number | null; height: number | null; fps: number | null; created_at: string };

const KIND_LABEL: Record<SuggestionKind, string> = {
  retake: "Retake",
  correction: "Koreksi",
  filler: "Filler",
  pause: "Jeda",
  unclear: "Tidak bisa dinilai",
  custom: "Permintaan Anda",
};
const KIND_COLOR: Record<SuggestionKind, string> = {
  retake: "var(--ui-danger)",
  correction: "var(--ui-warning)",
  filler: "var(--ui-purple)",
  pause: "var(--ui-success)",
  unclear: "var(--ui-muted)",
  custom: "var(--ui-blue)",
};
const PROVIDER_LABEL: Record<Provider, string> = { claude: "Claude Code CLI", codex: "Codex CLI" };

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const PAD = VIDEO.cutPaddingSec;

export function Review({
  projectId,
  projectStatus,
  duration,
  words,
  source,
  assetId,
  videoRef,
  onChanged,
}: {
  projectId: string;
  projectStatus: string;
  duration: number;
  words: { text: string; start: number; end: number }[];
  source: { width: number; height: number; fps: number };
  assetId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onChanged: () => void;
}) {
  const [data, setData] = useState<AnalysisData | null>(null);
  const [analyzers, setAnalyzers] = useState<{ analyzers: AnalyzersState | null; stale: boolean } | null>(null);
  const [provider, setProvider] = useState<Provider>("claude");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<SuggestionKind | "all">("all");
  const [previewCuts, setPreviewCuts] = useState(true);
  const [style, setStyle] = useState<StyleChoice>(DEFAULT_STYLE);
  const styleInit = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(
    async (runId?: string | null) => {
      const res = await fetch(`/api/projects/${projectId}/analysis${runId ? `?runId=${runId}` : ""}`);
      const json = await res.json();
      if (!res.ok) return setError(json.error ?? "Gagal memuat analisis");
      setData(json);
    },
    [projectId],
  );
  const loadAnalyzers = useCallback(async () => {
    const res = await fetch("/api/analyzers");
    if (res.ok) setAnalyzers(await res.json());
  }, []);

  useEffect(() => {
    void load();
    void loadAnalyzers();
  }, [load, loadAnalyzers]);

  const running = projectStatus === "analyzing" || data?.analyzeJob?.status === "queued" || data?.analyzeJob?.status === "running";
  const rendering = data?.renderJob?.status === "queued" || data?.renderJob?.status === "running";
  useEffect(() => {
    if (!running && !rendering) return;
    const t = setInterval(() => {
      void load(data?.selectedRunId);
      onChanged();
    }, 2000);
    return () => clearInterval(t);
  }, [running, rendering, load, onChanged, data?.selectedRunId]);

  const suggestions = data?.suggestions ?? [];
  const approved = useMemo(() => suggestions.filter((s) => s.status === "approved" && s.kind !== "unclear"), [suggestions]);
  const edl = useMemo(
    () =>
      buildEdl(
        duration,
        approved.map((s) => {
          const cut = { start: Number(s.start_s), end: Number(s.end_s) };
          return { ...cut, ...cutSlack(words, cut) };
        }),
        PAD,
      ),
    [approved, duration, words],
  );

  // ---------------------------------------------------------------- pemutar
  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stopTimer, []);

  /** Putar rangkaian segmen [a,b] berurutan (melompati celah di antaranya). */
  const playSegments = useCallback(
    (segs: Array<[number, number]>) => {
      const v = videoRef.current;
      if (!v || segs.length === 0) return;
      stopTimer();
      let i = 0;
      v.currentTime = segs[0][0];
      void v.play();
      timer.current = setInterval(() => {
        if (v.paused) return stopTimer();
        if (v.currentTime >= segs[i][1] - 0.02) {
          i++;
          if (i >= segs.length) {
            v.pause();
            return stopTimer();
          }
          v.currentTime = segs[i][0];
        }
      }, 40);
    },
    [videoRef],
  );

  const playContext = useCallback((s: SuggestionRow, withCut: boolean) => {
    const a = Math.max(0, Number(s.start_s) - 1.5);
    const b = Math.min(duration, Number(s.end_s) + 1.5);
    if (withCut) {
      // simulasi "setelah dipotong": sambungan memakai padding yang sama dengan EDL
      const slack = cutSlack(words, { start: Number(s.start_s), end: Number(s.end_s) });
      const cs = Number(s.start_s) + Math.min(PAD, slack.maxPadStart);
      const ce = Number(s.end_s) - Math.min(PAD, slack.maxPadEnd);
      if (ce - cs < 0.05) return playSegments([[a, b]]);
      return playSegments([[a, cs], [ce, b]]);
    }
    playSegments([[a, b]]);
  }, [words, duration, playSegments]);

  // Putar hasil akhir (semua yang disetujui terpotong), mulai dari awal
  useEffect(() => {
    if (!previewCuts) return;
    const v = videoRef.current;
    if (!v) return;
    const cuts = edl.appliedCuts;
    const id = setInterval(() => {
      if (v.paused) return;
      const t = v.currentTime;
      const c = cuts.find((x) => t >= x.start && t < x.end);
      if (c) v.currentTime = c.end;
    }, 40);
    return () => clearInterval(id);
  }, [previewCuts, edl.appliedCuts, videoRef]);

  // ------------------------------------------------------------------ aksi
  async function callJson(url: string, method: string, body?: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    setError(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((json.error as string) ?? `HTTP ${res.status}`);
      return { ok: false, json };
    }
    return { ok: true, json };
  }
  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    return (await callJson(url, method, body)).ok;
  }

  /** Ganti satu usulan di state dengan hasil dari server. Tidak mengunduh ulang ratusan usulan lain. */
  const applySuggestion = useCallback((sug: SuggestionRow) => {
    setData((d) => (d ? { ...d, suggestions: d.suggestions.map((x) => (x.id === sug.id ? sug : x)) } : d));
  }, []);

  async function startAnalysis() {
    setBusy(true);
    if (await call(`/api/projects/${projectId}/analyze`, "POST", { provider })) {
      await load();
      onChanged();
    }
    setBusy(false);
  }
  const setStatus = useCallback(
    async (s: SuggestionRow, status: SuggestionRow["status"]) => {
      const r = await callJson(`/api/suggestions/${s.id}`, "PATCH", { status });
      if (r.ok && r.json.suggestion) applySuggestion(r.json.suggestion as SuggestionRow);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applySuggestion],
  );
  const setTime = useCallback(
    async (s: SuggestionRow, field: "start_s" | "end_s", value: number) => {
      if (!Number.isFinite(value) || value === Number(s[field])) return;
      const r = await callJson(`/api/suggestions/${s.id}`, "PATCH", { [field]: value });
      if (r.ok && r.json.suggestion) applySuggestion(r.json.suggestion as SuggestionRow);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applySuggestion],
  );
  async function bulk(kind: Exclude<SuggestionKind, "unclear">, status: "approved" | "rejected" | "pending") {
    if (!data?.selectedRunId) return;
    if (await call(`/api/projects/${projectId}/suggestions/bulk`, "POST", { runId: data.selectedRunId, kind, status })) await load(data.selectedRunId);
  }
  async function saveEdl() {
    if (!data?.selectedRunId) return;
    setBusy(true);
    if (await call(`/api/projects/${projectId}/edl`, "POST", { runId: data.selectedRunId, style })) await load(data.selectedRunId);
    setBusy(false);
  }

  async function startRender() {
    setBusy(true);
    if (await call(`/api/projects/${projectId}/render`, "POST", { edlId: data?.edl?.id, style })) await load(data?.selectedRunId);
    setBusy(false);
  }

  // EDL tersimpan dianggap usang bila berbeda dari persetujuan saat ini (atau dari analisis lain)
  const edlStale = useMemo(() => {
    const saved = data?.edl;
    if (!saved) return false;
    if (saved.run_id !== data?.selectedRunId) return true;
    const a = saved.segments;
    const b = edl.segments;
    return a.length !== b.length || a.some((x, i) => Math.abs(x.start - b[i].start) > 1e-3 || Math.abs(x.end - b[i].end) > 1e-3);
  }, [data?.edl, data?.selectedRunId, edl.segments]);

  useEffect(() => {
    if (styleInit.current || !data) return;
    styleInit.current = true;
    const saved = (data.edl?.params as { style?: Partial<StyleChoice> } | undefined)?.style;
    if (saved) setStyle(normalizeStyle(saved));
  }, [data]);

  // Props pratinjau: rumus yang sama dengan worker (satu fungsi), memakai persetujuan saat ini
  const creative = useCreativeCode(projectId, style.creativeId);
  const mats = useMaterials(projectId);
  const creativeAssets = useMemo(() => materialAssets(mats.materials, (mid) => `/api/assets/${mid}/file`, undefined, { imagesOnly: true }), [mats.materials]);
  const built = useMemo(
    () =>
      edl.segments.length === 0
        ? null
        : buildEditedProps({
            segments: edl.segments,
            source: { width: source.width, height: source.height, fps: source.fps, durationS: duration },
            words,
            style,
            seed: seedFrom(data?.edl?.id ?? "pratinjau"),
            creative: creative.code,
            creativeAssets,
          }),
    [edl.segments, source.width, source.height, source.fps, duration, words, style, data?.edl?.id, creative.code, creativeAssets],
  );

  const run = data?.runs.find((r) => r.id === data.selectedRunId) ?? null;
  const shown = suggestions.filter((s) => filter === "all" || s.kind === filter);
  const counts = suggestions.reduce<Record<string, number>>((m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m), {});
  const pending = suggestions.filter((s) => s.status === "pending" && s.kind !== "unclear").length;
  const canStart = projectStatus === "ready" && !running && !busy;

  return (
    <section className="review-section">
      <h2>Analisis cut</h2>
      <p style={{ color: "var(--ui-muted)", marginTop: 0 }}>
        Sistem hanya <b>mengusulkan</b>. Tidak ada yang dipotong sebelum Anda menyetujuinya satu per satu.
      </p>

      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        {(["claude", "codex"] as Provider[]).map((p) => {
          const st = analyzers?.analyzers?.[p];
          const ready = st ? st.installed && st.loggedIn : null;
          return (
            <label key={p} style={{ opacity: ready === false ? 0.5 : 1 }}>
              <input type="radio" name="provider" checked={provider === p} onChange={() => setProvider(p)} disabled={ready === false} />{" "}
              <b>{PROVIDER_LABEL[p]}</b>{" "}
              <small style={{ color: ready ? "var(--ui-success)" : ready === false ? "var(--ui-danger)" : "var(--ui-muted)" }}>
                {st ? (ready ? "siap" : st.detail) : "belum ada laporan worker"}
              </small>
            </label>
          );
        })}
        <button onClick={startAnalysis} disabled={!canStart}>
          {running ? "Menganalisis..." : data?.runs.length ? "Analisis ulang" : "Jalankan analisis"}
        </button>
        {analyzers?.stale && <small style={{ color: "var(--ui-warning)" }}>Worker tidak melapor &gt; 6 menit: pastikan `npm run worker` menyala.</small>}
      </div>
      {running && data?.analyzeJob && <p>Memproses... {Math.round(data.analyzeJob.progress * 100)}%</p>}
      {error && <ErrorBox raw={error} />}

      {data && data.runs.length > 0 && (
        <p style={{ marginTop: 12 }}>
          Hasil analisis:{" "}
          <select value={data.selectedRunId ?? ""} onChange={(e) => void load(e.target.value)}>
            {data.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {PROVIDER_LABEL[r.provider]} · {new Date(r.created_at).toLocaleTimeString("id-ID")} ·{" "}
                {r.status === "done" ? `${(r.stats as { total?: number }).total ?? 0} usulan` : r.status}
              </option>
            ))}
          </select>
          {run?.status === "done" && (
            <small style={{ color: "var(--ui-muted)" }}>
              {" "}
              · model {run.model ?? "?"} · {((run.duration_ms ?? 0) / 1000).toFixed(1)} dtk
            </small>
          )}
        </p>
      )}
      {run?.status === "failed" && (
        <ErrorBox raw={run.error ?? "Analisis gagal"}>
          <small style={{ color: "var(--ui-muted)" }}>Video dan transkrip Anda tidak berubah. Pilih provider lalu klik "Jalankan analisis" untuk mencoba lagi.</small>
        </ErrorBox>
      )}

      {run?.status === "done" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
            <button onClick={() => setFilter("all")} style={{ fontWeight: filter === "all" ? 700 : 400 }}>
              Semua ({suggestions.length})
            </button>
            {(Object.keys(KIND_LABEL) as SuggestionKind[]).map((k) => (
              <button key={k} onClick={() => setFilter(k)} style={{ fontWeight: filter === k ? 700 : 400, color: KIND_COLOR[k] }} disabled={!counts[k]}>
                {KIND_LABEL[k]} ({counts[k] ?? 0})
              </button>
            ))}
          </div>

          {filter !== "all" && filter !== "unclear" && (
            <p>
              Aksi massal untuk <b>{KIND_LABEL[filter]}</b>: <button onClick={() => void bulk(filter, "approved")}>Setujui yang belum diputuskan</button>{" "}
              <button onClick={() => void bulk(filter, "rejected")}>Tolak yang belum diputuskan</button>{" "}
              <button onClick={() => void bulk(filter, "pending")}>Kembalikan semua ke belum diputuskan</button>
            </p>
          )}

          <ul style={{ listStyle: "none", padding: 0 }}>
            {shown.map((s) => (
              <SuggestionItem key={s.id} s={s} duration={duration} onStatus={setStatus} onTime={setTime} onPlay={playContext} />
            ))}
            {shown.length === 0 && <li style={{ color: "var(--ui-muted)" }}>Tidak ada usulan di kategori ini.</li>}
          </ul>

          <div style={{ position: "sticky", bottom: 0, background: "var(--ui-panel)", borderTop: "1px solid var(--ui-line)", padding: "12px 0", marginTop: 16 }}>
            <p style={{ margin: "0 0 8px", padding: 8, background: "var(--ui-warning-soft)", border: "1px solid var(--ui-warning-soft)" }}>
              <b>Menyetujui belum memotong file video.</b> Pemutar di atas hanya <i>melompati</i> bagian yang disetujui sebagai pratinjau
              {previewCuts ? " (sedang aktif)" : " (sedang mati: centang kotak di bawah)"}. File MP4 hasil potongan dibuat di tahap render (Fase 4); file mentah tidak pernah diubah.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              Disetujui: <b>{approved.length}</b> · belum diputuskan: <b>{pending}</b> · hasil: <b>{fmt(edl.keptS)}</b> dari {fmt(duration)} (dipotong {fmt(edl.removedS)})
              {edl.skippedTooShort > 0 && <small style={{ color: "var(--ui-warning)" }}> · {edl.skippedTooShort} potongan terlalu pendek setelah padding {PAD} dtk, diabaikan</small>}
            </p>
            <button onClick={() => playSegments(edl.segments.map((x) => [x.start, x.end] as [number, number]))} disabled={approved.length === 0}>
              ▶ Putar hasil setelah dipotong
            </button>{" "}
            <label>
              <input type="checkbox" checked={previewCuts} onChange={(e) => setPreviewCuts(e.target.checked)} /> lompati bagian yang disetujui saat memutar video di atas
            </label>{" "}
            <button onClick={saveEdl} disabled={busy || approved.length === 0}>
              Simpan EDL
            </button>
            {data?.edl && (
              <small style={{ color: "var(--ui-success)" }}>
                {" "}
                · EDL v{data.edl.version} tersimpan ({data.edl.params.approvedCount} potongan, hasil {fmt(data.edl.params.keptS)})
              </small>
            )}
          </div>

          <div style={{ marginTop: 20, padding: 20, borderRadius: 12, border: "1px solid var(--ui-line)" }}>
            <h3 style={{ marginTop: 0 }}>Gaya video: kamera, subtitle, efek</h3>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
              <span>
                Rasio:{" "}
                {(Object.keys(ASPECTS) as AspectId[]).map((a) => (
                  <label key={a} style={{ marginRight: 10 }}>
                    <input type="radio" name="aspect" checked={style.aspect === a} onChange={() => setStyle({ ...style, aspect: a })} /> {ASPECTS[a].label}
                  </label>
                ))}
              </span>
              <label>
                Gaya:{" "}
                <select value={style.styleId} onChange={(e) => setStyle({ ...style, styleId: e.target.value as StyleId })}>
                  {(Object.keys(STYLES) as StyleId[]).map((k) => (
                    <option key={k} value={k}>
                      {STYLES[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input type="checkbox" checked={style.camera} onChange={(e) => setStyle({ ...style, camera: e.target.checked })} /> Gerakan kamera
              </label>
              <label>
                <input type="checkbox" checked={style.captions} onChange={(e) => setStyle({ ...style, captions: e.target.checked })} /> Subtitle
              </label>
              <label>
                <input type="checkbox" checked={style.effects} onChange={(e) => setStyle({ ...style, effects: e.target.checked })} /> Efek film
              </label>
              {ASPECTS[style.aspect].width / ASPECTS[style.aspect].height < source.width / source.height - 0.05 && (
                <label>
                  Posisi potong:{" "}
                  <input type="range" min={0} max={1} step={0.01} value={style.focusX} onChange={(e) => setStyle({ ...style, focusX: Number(e.target.value) })} /> {Math.round(style.focusX * 100)}%
                </label>
              )}
            </div>
            {built ? (
              <>
                <div style={{ marginTop: 12, maxWidth: Math.min(720, Math.round(560 * ASPECTS[style.aspect].width / ASPECTS[style.aspect].height)) }}>
                  <Player numberOfSharedAudioTags={SFX.playerAudioTags}
                    key={style.aspect}
                    component={Edited}
                    inputProps={{ ...built.props, src: `/api/assets/${assetId}/file?view=1` }}
                    durationInFrames={built.durationInFrames}
                    fps={built.props.fps}
                    compositionWidth={built.props.width}
                    compositionHeight={built.props.height}
                    style={{ width: "100%", background: "#000" }}
                    controls
                    loop
                    acknowledgeRemotionLicense
                  />
                </div>
                <p style={{ color: "var(--ui-muted)", margin: "8px 0 0" }}>
                  Pratinjau memakai persetujuan Anda saat ini. {built.props.camera.length} gerakan kamera, {built.props.pages.length} halaman subtitle.
                  {ASPECTS[style.aspect].width / ASPECTS[style.aspect].height < source.width / source.height - 0.05 && ` Sumber dipotong (atur Posisi potong; face tracking belum ada); diperbesar ~${(ASPECTS[style.aspect].height / Math.max(1, source.height)).toFixed(1).replace(".", ",")}x, sumber 4K lebih tajam.`}
                  {!data?.edl && " Rencana kamera dipastikan saat EDL disimpan."}
                </p>
                {built.cameraErrors.length > 0 && <p style={{ color: "var(--ui-danger)" }}>Rencana kamera tidak valid: {built.cameraErrors[0]}</p>}
              </>
            ) : (
              <p style={{ color: "var(--ui-muted)" }}>Setujui minimal satu bagian video yang dipertahankan untuk melihat pratinjau.</p>
            )}
          </div>

          <div style={{ marginTop: 20, padding: 20, borderRadius: 12, border: "1px solid var(--ui-line)" }}>
            <h3 style={{ marginTop: 0 }}>Render MP4</h3>
            {!data?.edl ? (
              <p style={{ color: "var(--ui-muted)" }}>Setujui usulan, lalu klik <b>Simpan EDL</b>. Render memakai EDL yang tersimpan.</p>
            ) : (
              <>
                <p style={{ margin: "0 0 8px" }}>
                  EDL v{data.edl.version}: hasil {fmt(data.edl.params.keptS)} dari {fmt(duration)}.
                </p>
                {edlStale && (
                  <p style={{ color: "var(--ui-warning)", margin: "0 0 8px" }}>
                    Persetujuan Anda sekarang berbeda dari EDL yang tersimpan. Klik <b>Simpan EDL</b> dulu agar render sesuai.
                  </p>
                )}
                <button onClick={startRender} disabled={busy || rendering || edlStale}>
                  {rendering ? "Merender..." : `Render MP4 dari EDL v${data.edl.version}`}
                </button>
                {rendering && data.renderJob && (
                  <span style={{ marginLeft: 12 }}>
                    <progress value={data.renderJob.progress} max={1} style={{ width: 220 }} /> {Math.round(data.renderJob.progress * 100)}%
                  </span>
                )}
                {data.renderJob?.status === "failed" && <ErrorBox raw={data.renderJob.error ?? "Render gagal"} />}
                <p style={{ color: "var(--ui-muted)", marginBottom: 0 }}>
                  Hanya potongan yang disetujui yang diterapkan. File mentah tidak diubah; hasil disimpan sebagai file baru.
                </p>
              </>
            )}

            {(data?.outputs.length ?? 0) > 0 && (
              <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
                {data!.outputs.map((o) => (
                  <li key={o.id} style={{ borderTop: "1px solid var(--ui-line)", padding: "8px 0" }}>
                    <b>{o.duration_s != null ? fmt(Number(o.duration_s)) : "?"}</b> · {o.width}×{o.height} · {o.size_bytes ? (o.size_bytes / 1024 / 1024).toFixed(1) + " MB" : ""} ·{" "}
                    <small>{new Date(o.created_at).toLocaleString("id-ID")}</small>{" "}
                    <a href={`/api/assets/${o.id}/file?download=1`}>Unduh</a>{" "}
                    <details style={{ display: "inline" }}>
                      <summary style={{ display: "inline", cursor: "pointer" }}>Putar</summary>
                      <video src={`/api/assets/${o.id}/file`} controls preload="none" style={{ width: "100%", maxHeight: 360, background: "#000", marginTop: 8 }} />
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// memo: mengubah satu usulan hanya merender ulang kartu itu, bukan ratusan kartu lain
const SuggestionItem = memo(function SuggestionItem({
  s,
  duration,
  onStatus,
  onTime,
  onPlay,
}: {
  s: SuggestionRow;
  duration: number;
  onStatus: (s: SuggestionRow, st: SuggestionRow["status"]) => void;
  onTime: (s: SuggestionRow, field: "start_s" | "end_s", value: number) => void;
  onPlay: (s: SuggestionRow, withCut: boolean) => void;
}) {
  const unclear = s.kind === "unclear";
  const bg = s.status === "approved" ? "var(--ui-accent-soft)" : s.status === "rejected" ? "var(--ui-bg)" : "var(--ui-panel)";
  return (
    <li style={{ border: "1px solid var(--ui-line)", borderLeft: `5px solid ${KIND_COLOR[s.kind]}`, background: bg, borderRadius: 10, padding: 16, marginBottom: 8, opacity: s.status === "rejected" ? 0.6 : 1 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <b style={{ color: KIND_COLOR[s.kind] }}>{KIND_LABEL[s.kind]}</b>
        <span>
          <TimeInput value={Number(s.start_s)} max={duration} onCommit={(v) => onTime(s, "start_s", v)} /> →{" "}
          <TimeInput value={Number(s.end_s)} max={duration} onCommit={(v) => onTime(s, "end_s", v)} /> dtk{" "}
          <small style={{ color: "var(--ui-muted)" }}>({(Number(s.end_s) - Number(s.start_s)).toFixed(1)} dtk{s.start_s !== s.orig_start_s || s.end_s !== s.orig_end_s ? ", digeser" : ""})</small>
        </span>
        <small style={{ color: "var(--ui-muted)" }}>{s.source === "llm" ? "AI" : s.source === "silence" ? "ffmpeg" : "aturan"}</small>
      </div>
      {s.quote && <p style={{ margin: "6px 0", fontStyle: "italic" }}>“{s.quote}”</p>}
      <p style={{ margin: "4px 0", color: "#444" }}>{s.reason}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => onPlay(s, false)}>▶ Sebelum</button>
        {!unclear && <button onClick={() => onPlay(s, true)}>▶ Sesudah dipotong</button>}
        {!unclear && (
          <>
            <button onClick={() => onStatus(s, "approved")} disabled={s.status === "approved"} style={{ color: "var(--ui-success)" }}>
              ✓ Setuju
            </button>
            <button onClick={() => onStatus(s, "rejected")} disabled={s.status === "rejected"} style={{ color: "var(--ui-danger)" }}>
              ✕ Tolak
            </button>
            {s.status !== "pending" && <button onClick={() => onStatus(s, "pending")}>Kembalikan</button>}
          </>
        )}
      </div>
    </li>
  );
});

function TimeInput({ value, max, onCommit }: { value: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(value.toFixed(2)), [value]);
  return (
    <input
      type="number"
      step={0.05}
      min={0}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(Number(text))}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ width: 78 }}
    />
  );
}
