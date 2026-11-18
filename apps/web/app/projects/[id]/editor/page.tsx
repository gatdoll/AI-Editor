"use client";
import type { ReferenceInput } from "@app/shared/reference";
import Link from "next/link";
import { Icon } from "../../../components/Icon";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { Provider, SuggestionKind, SuggestionRow } from "@app/shared";
import { ASPECTS, END_CLIP, MANUAL, MOTION, VIDEO } from "@app/config";
import { applyManualEdl, extendLimits, normalizeManual, restoreRange, snapTime, type ManualEdit } from "@app/shared/manual";
import { arrangeEdl, arrangeSegments, clipAt, normalizeOrder } from "@app/shared/reel";
import { MediaPanel } from "./MediaPanel";
import { CanvasPan, type Focus } from "./CanvasPan";
import { toFrameSegments } from "@app/remotion/src/frames.ts";
import { coversSegments } from "@app/shared/transcript-segments";
import { applyWordFixes, mergeWithNext, moveClip as moveClipSub, removeClip, setClipRange, setClipText, splitClip as splitClipSub, addClip as addSubtitleClip, type SubResult } from "@app/shared/subtitles";
import { SubtitleClipPanel } from "./SubtitleClipPanel";
import type { Waveform } from "./WaveformLane";
import { AutoCutBox } from "./AutoCutBox";
import type { Interval } from "@app/shared/edl";
import { ManualPanel } from "./ManualPanel";
import { buildEdl, cutSlack } from "@app/shared/edl";
import { Edited } from "@app/remotion/src/compositions/Edited.tsx";
import { autoSubtitleClips, buildEditedProps, seedFrom } from "@app/remotion/src/build-props.ts";
import { framesOf, outputToSource, sourceToOutput } from "@app/remotion/src/timeline.ts";
import { PromptPanel } from "./PromptPanel";
import { CreativePanel } from "./CreativePanel";
import { RightPanel } from "./RightPanel";
import { SuggestionsPanel } from "./SuggestionsPanel";
import { Timeline, type TimelineHandle } from "./Timeline";
import { fmtTime } from "./kinds";
import { useEditorData } from "./useEditorData";
import { useCreativeCode } from "../../../../lib/use-creative-code";
import { useMaterials } from "../../../../lib/use-materials";
import { materialAssets } from "@app/remotion/src/motion-props.ts";
import { OwnAssetPanel } from "./OwnAssetPanel";
import { TranscriptAiFix } from "./TranscriptAiFix";
import { useTalent } from "../../../../lib/use-talent";
import { SafeAreaGuide, useSafeAreaGuide } from "../../../components/SafeAreaGuide";
import { useDerivedMedia } from "../../../../lib/use-derived-media";
import { cancelRender, discardEmptySave, downloadUrl, isAbort, pickSaveFile, renderFailedMessage, saveUrlToHandle } from "../../../../lib/save-file";
import s from "./editor.module.css";
import { SfxPanel } from "../../../components/SfxPanel";
import { useSfxLibrary } from "../../../../lib/use-sfx-library";
import { normalizeCues, type SfxCue } from "@app/shared/sfx";
import { SFX } from "@app/config";

type Tab = "prompt" | "manual" | "suggestions" | "transcript" | "media" | "aset";

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const d = useEditorData(id);
  const { detail, words, suggestions, style, exportInfo } = d;

  const asset = detail?.asset ?? null;
  // Fase 16: semua video project pada satu sumbu waktu (reel). `duration` = panjang reel (data memakai waktu reel).
  const clips = useMemo(() => detail?.reel?.clips ?? [], [detail?.reel?.clips]);
  const rawAssets = useMemo(() => detail?.assets ?? (asset ? [{ ...asset, label: "video" }] : []), [detail?.assets, asset]);
  const duration = Number(detail?.reel?.durationS ?? asset?.duration_s ?? 0);
  const fps = Number(asset?.fps ?? 30) || 30;
  // Fase 12: workspace bisa dipakai tanpa transkrip (transkrip dibuat saat diminta: Auto cut / Auto subtitle)
  const ready = ["ready", "transcribing", "analyzing"].includes(detail?.project.status ?? "") && !!asset && duration > 0;
  const hasTranscript = !!d.transcript && words.length > 0;
  const transcribing = detail?.jobs.some((j) => j.type === "transcribe" && (j.status === "queued" || j.status === "running")) ?? false;

  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [focus, setFocus] = useState(false);
  const [inspector, setInspector] = useState<boolean | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [editingWord, setEditingWord] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("prompt");
  // Kolom prompt: Cepat = operasi tertutup (detik); Kreatif = AI menulis kode Remotion (menit)
  const [promptMode, setPromptMode] = useState<"cepat" | "kreatif" | "akhir">("cepat");
  // Tautan langsung ?mode=kreatif (dibaca setelah mount agar tidak beda dengan HTML server)
  useEffect(() => { if (new URLSearchParams(window.location.search).get("mode") === "kreatif") setPromptMode("kreatif"); }, []);
  // ?tab=suggestions membuka tab usulan langsung (berguna untuk tautan dan pemeriksaan visual)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "suggestions" || t === "prompt" || t === "transcript" || t === "manual" || t === "media" || t === "aset") setTab(t);
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [playing, setPlaying] = useState(false);
  /** Mode geser video di canvas (seperti Canva). */
  const [panMode, setPanMode] = useState(false);
  // Fase 23: garis bantu safe area Reels/TikTok di pratinjau (tidak ikut render)
  const [safeGuide, setSafeGuide] = useSafeAreaGuide(style.aspect);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const previewResumeFrame = useRef(0);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedClipStart, setSelectedClipStart] = useState<number | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<number | null>(null);
  // Fase 10: klip subtitle (id) dan rentang lapisan kreatif (indeks) yang dipilih di timeline
  const [selectedSub, setSelectedSub] = useState<string | null>(null);
  const [subFocus, setSubFocus] = useState(0);
  const [selectedCreative, setSelectedCreative] = useState<number | null>(null);
  const [selectedCam, setSelectedCam] = useState<number | null>(null);
  // Fase 14: SFX terpilih (indeks di style.sfx.cues) dan pemicu pindah ke bagian SFX di panel Manual
  const [selectedSfx, setSelectedSfx] = useState<number | null>(null);
  const [sfxFocus, setSfxFocus] = useState(0);
  const [audioFocus, setAudioFocus] = useState(0);
  const sfxLib = useSfxLibrary();
  const manual = useMemo(() => normalizeManual(style.manual), [style.manual]);

  const playerRef = useRef<PlayerRef>(null);
  const timelineRef = useRef<TimelineHandle>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const lastSrc = useRef(0);

  const onVideoError = useCallback((error: Error) => {
    playerRef.current?.pause();
    setPlaying(false);
    setPreviewError(error.message);
  }, []);

  // Mode Kreatif: kode versi yang ditunjuk gaya + error per frame yang dilaporkan komposisi (frame itu tanpa layer)
  const creative = useCreativeCode(id, style.creativeId);
  // Fase 18: klip motion penutup. Sebelum ada versi aktif, durasi pilihan hanya disimpan di panel.
  const endClipCode = useCreativeCode(id, style.endClip?.versionId);
  const [endDraftSeconds, setEndDraftSeconds] = useState<number>(END_CLIP.seconds.default);
  const endSeconds = style.endClip?.seconds ?? endDraftSeconds;
  // Fase 15: gambar/logo pengguna untuk kode kreatif (pratinjau memakai rute aset web; render memakai server lokal)
  const mats = useMaterials(id);
  const creativeAssets = useMemo(() => materialAssets(mats.materials, (mid) => `/api/assets/${mid}/file`, undefined, { imagesOnly: true }), [mats.materials]);
  // Gelombang audio untuk track Audio di timeline (dibuat sekali di server, lalu dari cache)
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  const waveKey = clips.map((c) => `${c.id}@${c.offset}`).join(",");
  useEffect(() => {
    const list = clips.length ? clips : asset?.id ? [{ id: asset.id, offset: 0, duration }] : [];
    if (!list.length) return;
    let alive = true;
    // Fase 16: gelombang tiap video ditempatkan di posisi reel-nya (lubang antar video = sunyi)
    void Promise.all(list.map((c) => fetch(`/api/assets/${c.id}/waveform`).then((r) => r.json()).then((b) => ({ c, b })).catch(() => null))).then((rows) => {
      if (!alive) return;
      const ok = rows.filter((r): r is NonNullable<typeof r> => !!r && typeof r.b.peaks === "string");
      if (!ok.length) return;
      const perSecond = ok[0].b.perSecond as number;
      const total = Math.ceil(Math.max(...list.map((c) => c.offset + c.duration)) * perSecond) + 1;
      const peaks = new Uint8Array(total);
      for (const { c, b } of ok) {
        const bin = atob(b.peaks), at = Math.round(c.offset * perSecond);
        for (let i = 0; i < bin.length && at + i < total; i++) peaks[at + i] = bin.charCodeAt(i);
      }
      setWaveform({ perSecond, peaks });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveKey, asset?.id]);
  // Fase 11: salinan pratinjau (MOV HEVC dsb.) dan audio hasil reduksi noise
  const derived = useDerivedMedia(rawAssets, style.params["audio.kurangiNoise"], d.loadDetail);
  const audioKey = derived.denoise.status === "siap" ? `nr${derived.denoise.level}` : "asli";
  const lastAudioKey = useRef(audioKey);
  if (lastAudioKey.current !== audioKey) {
    // Pemutar akan dibuat ulang: lanjutkan dari posisi yang sama, dalam keadaan berhenti
    lastAudioKey.current = audioKey;
    previewResumeFrame.current = playerRef.current?.getCurrentFrame() ?? previewResumeFrame.current;
  }
  useEffect(() => { setPlaying(false); }, [audioKey]);
  const [creativeErrors, setCreativeErrors] = useState<string[]>([]);
  useEffect(() => setCreativeErrors([]), [creative.code]);
  const onCreativeError = useCallback((where: "overlay" | "video", message: string) => {
    // Dipanggil saat komposisi sedang dirender: tunda agar tidak mengubah state editor di tengah render Player
    setTimeout(() => setCreativeErrors((cur) => (cur.length >= 5 || cur.includes(`${where}: ${message}`) ? cur : [...cur, `${where}: ${message}`])), 0);
  }, []);

  const retryPreview = useCallback(() => {
    previewResumeFrame.current = playerRef.current?.getCurrentFrame() ?? 0;
    setPreviewError(null);
    // Recreate both Player and media source: seeking an errored HTMLVideoElement
    // does not recover its decoder. This changes no persisted editing data.
    setPreviewRevision((v) => v + 1);
  }, []);

  const say = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast((cur) => (cur === m ? null : cur)), 7000);
  }, []);
  // Enter lalu blur memanggil dua kali: hanya yang pertama yang menyimpan
  const committingWord = useRef<number | null>(null);
  const commitWord = (i: number, text: string) => {
    if (committingWord.current === i) return;
    committingWord.current = i;
    setEditingWord(null);
    const before = words[i];
    void d.saveWord(i, text).then((e) => {
      committingWord.current = null;
      if (e) return say(e);
      // Subtitle yang sudah jadi klip (diedit di timeline) tidak membaca transkrip lagi: koreksi dibawa ke sana
      const after = text.replace(/\s+/g, " ").trim();
      const subtitles = before && after !== before.text ? applyWordFixes(style.subtitles, [{ start: before.start, end: before.end, before: before.text, after }]) : style.subtitles;
      if (subtitles !== style.subtitles) d.updateStyle({ subtitles });
    });
  };

  // ------------------------------------------------------- potongan -> EDL -> props
  const pad = VIDEO.cutPaddingSec;
  const makeEdl = useCallback(
    (includePending: boolean) =>
      arrangeEdl(applyManualEdl(buildEdl(
        duration || 1,
        suggestions
          .filter((x) => x.kind !== "unclear" && (x.status === "approved" || (includePending && x.status === "pending")))
          .map((x) => {
            const cut = { start: Number(x.start_s), end: Number(x.end_s) };
            return { ...cut, ...cutSlack(words, cut) };
          }),
        pad,
      ), style.manual, duration || 1), clips, style.reelOrder, style.reelHidden),
    [suggestions, words, duration, pad, style.manual, clips, style.reelOrder, style.reelHidden],
  );
  const approvedEdl = useMemo(() => makeEdl(false), [makeEdl]);
  // Fase 21: kalimat aset sendiri ikut terpotong cut yang disetujui? (detik video mentah, titik tengah seperti pemetaan timeline)
  const isCutOut = useCallback((a: number, b: number) => { const mid = (a + b) / 2; return !approvedEdl.segments.some((g) => mid >= g.start && mid < g.end); }, [approvedEdl.segments]);
  const ownImages = mats.materials.filter((m) => m.mime.startsWith("image/")).length;
  const selectedClipIndex = selectedClipStart === null ? -1 : approvedEdl.segments.findIndex((c) => Math.abs(c.start - selectedClipStart) < 1 / fps / 2);
  const selectedClip = approvedEdl.segments[selectedClipIndex] ?? null;
  const viewEdl = useMemo(() => (previewPending ? makeEdl(true) : approvedEdl), [previewPending, makeEdl, approvedEdl]);
  // Fase 24: talent yang sudah dipisahkan (blur wajah, teks di belakang talent); dimuat ulang tiap versi kreatif berganti
  const talent = useTalent(clips.map((c) => c.id), creative.code);
  const frameSegs = useMemo(() => framesOf(viewEdl.segments, fps, duration || 1), [viewEdl, fps, duration]);

  const built = useMemo(
    () =>
      !ready || viewEdl.segments.length === 0
        ? null
        : buildEditedProps({
            segments: viewEdl.segments,
            source: { width: asset!.width ?? 1920, height: asset!.height ?? 1080, fps, durationS: duration },
            words,
            style,
            seed: seedFrom(exportInfo?.edl?.id ?? "pratinjau"),
            creative: creative.code,
            sfxLength: (sid) => sfxLib.items.find((x) => x.id === sid)?.durationS,
            creativeAssets,
            clips,
            endClip: endClipCode.code,
            ...(talent && creative.code ? { talent } : {}),
          }),
    [ready, viewEdl, asset, fps, duration, words, style, exportInfo?.edl?.id, creative.code, sfxLib.items, creativeAssets, clips, endClipCode.code, talent],
  );

  const edlStale = useMemo(() => {
    const saved = exportInfo?.edl;
    if (!saved) return false;
    const a = saved.segments, b = approvedEdl.segments;
    return a.length !== b.length || a.some((x, i) => Math.abs(x.start - b[i].start) > 1e-3 || Math.abs(x.end - b[i].end) > 1e-3);
  }, [exportInfo?.edl, approvedEdl]);

  const pendingCount = suggestions.filter((x) => x.status === "pending" && x.kind !== "unclear").length;
  const approvedCount = suggestions.filter((x) => x.status === "approved" && x.kind !== "unclear").length;
  const transcriptMatches = useMemo(() => {
    const q = transcriptSearch.trim().toLocaleLowerCase();
    return q ? words.filter((w) => w.text.toLocaleLowerCase().includes(q)) : [];
  }, [words, transcriptSearch]);
  const selected = suggestions.find((x) => x.id === selectedId) ?? null;

  // --------------------------------------------------------------- pemutar <-> timeline
  const onFrame = useCallback(
    (frame: number) => {
      const src = outputToSource(frameSegs, fps, frame / fps);
      lastSrc.current = src;
      const inEndClip = !!built?.props.endClip && frame >= built.durationInFrames - built.props.endClip.frames;
      if (inEndClip) timelineRef.current?.setPlayheadOut(frame / fps);
      else timelineRef.current?.setPlayhead(src);
      const total = built ? built.durationInFrames / fps : 0;
      if (timecodeRef.current) timecodeRef.current.innerHTML = `<b>${fmtTime(frame / fps)}</b> / ${fmtTime(total)} <span style="opacity:.6">· ${inEndClip ? "klip akhir" : `sumber ${fmtTime(src)}`}</span>`;
    },
    [frameSegs, fps, built],
  );

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const fu = (e: { detail: { frame: number } }) => onFrame(e.detail.frame);
    const pl = () => setPlaying(true);
    const pa = () => setPlaying(false);
    p.addEventListener("frameupdate", fu);
    p.addEventListener("play", pl);
    p.addEventListener("pause", pa);
    p.addEventListener("ended", pa);
    return () => {
      p.removeEventListener("frameupdate", fu);
      p.removeEventListener("play", pl);
      p.removeEventListener("pause", pa);
      p.removeEventListener("ended", pa);
    };
  }, [onFrame, built?.props.aspect, previewRevision]);

  const seekSource = useCallback(
    (t: number) => {
      const { out } = sourceToOutput(frameSegs, fps, t);
      const total = built?.durationInFrames ?? 1;
      const frame = Math.min(Math.max(0, total - 1), Math.max(0, Math.round(out * fps)));
      playerRef.current?.seekTo(frame);
      lastSrc.current = t;
      timelineRef.current?.setPlayhead(t);
      onFrame(frame);
    },
    [frameSegs, fps, built, onFrame],
  );

  const openEndClip = () => {
    setTab("prompt"); setPromptMode("akhir");
    if (!built?.props.endClip) return;
    const frame = built.durationInFrames - built.props.endClip.frames;
    playerRef.current?.pause();
    playerRef.current?.seekTo(frame);
    onFrame(frame);
  };
  const changeEndSeconds = (seconds: number) => {
    setEndDraftSeconds(seconds);
    if (style.endClip) d.updateStyle({ endClip: { ...style.endClip, seconds } }, "klip-akhir");
  };

  // ?t=detik membuka editor langsung di waktu itu (waktu video mentah). Sekali saja, setelah pemutar siap.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !built) return;
    const t = Number(new URLSearchParams(window.location.search).get("t"));
    if (!Number.isFinite(t) || t <= 0) { deepLinked.current = true; return; }
    const timer = setTimeout(() => { deepLinked.current = true; seekSource(t); }, 800);
    return () => clearTimeout(timer);
  }, [built, seekSource]);

  // Potongan berubah: pertahankan posisi pada waktu SUMBER yang sama
  useEffect(() => {
    if (built) seekSource(lastSrc.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameSegs]);

  // spasi = putar/jeda (kecuali sedang mengetik)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== "Space" || /INPUT|TEXTAREA|SELECT|BUTTON/.test(el.tagName)) return;
      e.preventDefault();
      if (previewError) return;
      playerRef.current?.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewError]);

  // ------------------------------------------------------------------------ aksi
  const patchSuggestion = useCallback(
    async (x: SuggestionRow, body: Record<string, unknown>) => {
      const r = await fetch(`/api/suggestions/${x.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) return say(j.error ?? "Gagal menyimpan");
      d.applySuggestion(j.suggestion as SuggestionRow);
    },
    [d, say],
  );
  const onStatus = useCallback((x: SuggestionRow, st: SuggestionRow["status"]) => void patchSuggestion(x, { status: st }), [patchSuggestion]);
  const onTime = useCallback(
    (x: SuggestionRow, field: "start_s" | "end_s", v: number) => {
      if (Number.isFinite(v) && v !== Number(x[field])) void patchSuggestion(x, { [field]: v });
    },
    [patchSuggestion],
  );
  const onBulk = useCallback(
    async (kind: Exclude<SuggestionKind, "unclear">, status: SuggestionRow["status"]) => {
      const r = await fetch(`/api/projects/${id}/suggestions/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, status }) });
      const j = await r.json();
      if (!r.ok) return say(j.error ?? "Gagal");
      say(`${j.changed} usulan diubah.`);
      await d.loadSuggestions();
    },
    [id, d, say],
  );

  const sendPrompt = useCallback(
    async (text: string, provider: Provider, model: string, reference?: ReferenceInput): Promise<string | null> => {
      if (!await d.flushStyle()) return "Edit manual belum tersimpan. Selesaikan penyimpanan sebelum menjalankan AI.";
      const r = await fetch(`/api/projects/${id}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: text, provider, model, reference }) });
      const j = await r.json();
      if (!r.ok) return j.error ?? `HTTP ${r.status}`;
      await d.loadPrompts();
      return null;
    },
    [id, d],
  );
  const undoPrompt = useCallback(
    async (pid: string) => {
      if (!await d.flushStyle()) return say("Simpan perubahan manual dahulu.");
      const r = await fetch(`/api/prompts/${pid}/undo`, { method: "POST" });
      const j = await r.json();
      say((j.messages as string[] | undefined)?.join(" ") || j.error || "Selesai");
      await d.reloadAll();
    },
    [d, say],
  );
  const approveAllFromPrompt = useCallback(
    async (pid: string) => {
      const r = await fetch(`/api/projects/${id}/suggestions/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ promptRunId: pid, status: "approved" }) });
      const j = await r.json();
      say(r.ok ? `${j.changed} usulan disetujui.` : (j.error ?? "Gagal"));
      await d.loadSuggestions();
    },
    [id, d, say],
  );

  const saveEdl = useCallback(async (): Promise<string | null> => {
    if (!await d.flushStyle()) { say("Edit belum tersimpan. Periksa pesan penyimpanan."); return null; }
    const r = await fetch(`/api/projects/${id}/edl`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ style }) });
    const j = await r.json();
    if (!r.ok) {
      say(j.error ?? "Gagal menyimpan EDL");
      return null;
    }
    await d.loadExport();
    return j.edl.id as string;
  }, [id, style, d, say]);

  // ---- simpan hasil ekspor ke folder pilihan pengguna ("Simpan sebagai")
  const [saveState, setSaveState] = useState<string | null>(null);
  const pendingSave = useRef<{ handle: Awaited<ReturnType<typeof pickSaveFile>>; since: number } | null>(null);
  const exportFileName = `${(detail?.project.name ?? "video").replace(/[\\/:*?"<>|]+/g, "_").trim() || "video"}.mp4`;
  const saveOutput = useCallback(async (o: { id: string }, preset?: Awaited<ReturnType<typeof pickSaveFile>>) => {
    const url = `/api/assets/${o.id}/file?download=1`;
    try {
      const handle = preset !== undefined ? preset : await pickSaveFile(exportFileName);
      if (!handle) { downloadUrl(url, exportFileName); say("Browser ini tidak mendukung pilih lokasi: file diunduh ke folder Unduhan."); return; }
      setSaveState(`Menyimpan ${handle.name}… 0%`);
      await saveUrlToHandle(url, handle, (f) => setSaveState(`Menyimpan ${handle.name}… ${Math.round(f * 100)}%`));
      setSaveState(null);
      say(`MP4 tersimpan: ${handle.name}`);
    } catch (e) {
      setSaveState(null);
      if (!isAbort(e)) say(e instanceof Error ? e.message : "Gagal menyimpan file");
    }
  }, [exportFileName, say]);
  // Menutup tab sebelum tersimpan = file pilihan tetap 0 byte: peringatkan
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pendingSave.current?.handle || saveState?.startsWith("Menyimpan")) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);
  // Render selesai: simpan otomatis ke lokasi yang dipilih saat menekan Ekspor
  useEffect(() => {
    const p = pendingSave.current, rj = exportInfo?.renderJob, last = exportInfo?.outputs[0];
    if (!p || !rj) return;
    if (rj.status === "failed" || rj.status === "cancelled") {
      pendingSave.current = null;
      setSaveState(null);
      void renderFailedMessage(p.handle, rj.error, rj.status === "cancelled").then(say);
      return;
    }
    if (rj.status === "done" && last && new Date(last.created_at).getTime() >= p.since) {
      pendingSave.current = null;
      void saveOutput(last, p.handle);
    }
  }, [exportInfo, saveOutput]);

  const renderBusy = ["running", "queued"].includes(exportInfo?.renderJob?.status ?? "");
  const exportNow = useCallback(async () => {
    // Pilih lokasi DULU (harus langsung dari klik); MP4 disimpan ke sana otomatis setelah render selesai
    let handle: Awaited<ReturnType<typeof pickSaveFile>> = null;
    try { handle = await pickSaveFile(exportFileName); } catch (e) { if (isAbort(e)) return say("Ekspor dibatalkan."); }
    setExporting(true);
    let started = false;
    try {
      if (!await d.flushStyle()) { say("Edit belum tersimpan. Ekspor belum dimulai."); return; }
      const edlId = edlStale || !exportInfo?.edl ? await saveEdl() : exportInfo.edl.id;
      if (!edlId) return;
      const r = await fetch(`/api/projects/${id}/render`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ edlId, style }) });
      const j = await r.json();
      if (!r.ok) say(j.error ?? "Gagal memulai render");
      else {
        started = true;
        pendingSave.current = { handle, since: Date.now() - 5000 };
        // Chrome sudah membuat file kosong di lokasi itu; isinya ditulis dari tab ini setelah render selesai
        if (handle) setSaveState(`Menunggu render selesai, lalu disimpan ke ${handle.name}. File di folder itu masih 0 byte sampai saat itu; jangan tutup tab ini.`);
        say(handle ? `Render dimulai. Setelah selesai, MP4 otomatis disimpan sebagai ${handle.name}.` : `Render dimulai dari EDL v${j.edlVersion}. Setelah selesai, file diunduh ke folder Unduhan.`);
      }
      await d.loadExport();
    } finally {
      setExporting(false);
      if (!started && handle) void discardEmptySave(handle);
    }
  }, [edlStale, exportInfo, saveEdl, id, style, d, say, exportFileName]);

  const manualDisabled = !ready || d.promptRunning || previewPending;
  /** Fase 16: rentang reel video yang memuat klip ini (klip tidak bisa diperpanjang melewati videonya sendiri). */
  const clipBounds = (clip: Interval): Interval | undefined => { const c = clipAt(clips, (clip.start + clip.end) / 2); return c ? { start: c.offset, end: c.offset + c.duration } : undefined; };
  const addCuts = (cuts: Interval[]) => {
    if (manualDisabled) { say("Tutup simulasi usulan dan tunggu AI selesai sebelum edit manual."); return false; }
    const next = { ...manual, cuts: [...manual.cuts, ...cuts] };
    if (next.cuts.length > MANUAL.maxCuts) { say("Batas potongan manual tercapai."); return false; }
    const remaining = arrangeSegments(applyManualEdl(approvedEdl, { ...next, splits: [] }, duration).segments, clips, style.reelOrder, style.reelHidden);
    if (!framesOf(remaining, fps, duration).length) { say("Sisakan minimal satu frame video."); return false; }
    d.updateStyle({ manual: next }); setSelectedClipStart(null); setPreviewPending(false);
    return true;
  };
  /**
   * Rentang baru klip (waktu mentah). Lebih sempit = trim (cut manual). Lebih lebar = memulihkan bagian yang terpotong
   * (AI maupun manual), sampai klip tetangga di video mentah. Satu langkah undo.
   */
  const clipRange = (clip: Interval, a: number, b: number) => {
    if (manualDisabled) return say("Tutup simulasi usulan dan tunggu AI selesai sebelum edit manual.");
    const snappedA = snapTime(a, fps), snappedB = snapTime(b, fps);
    const lim = extendLimits(approvedEdl.segments, clip, duration, clipBounds(clip));
    const start = Math.abs(snappedA - clip.start) < 0.5 / fps ? clip.start : Math.max(lim.minStart, snappedA);
    const end = Math.abs(snappedB - clip.end) < 0.5 / fps ? clip.end : Math.min(lim.maxEnd, snappedB);
    if (!Number.isFinite(start) || !Number.isFinite(end) || Math.round(end * fps) - Math.round(start * fps) < 1) return say("Klip harus menyisakan minimal satu frame.");
    let next: ManualEdit | null = manual;
    if (start < clip.start) next = restoreRange(next, { start, end: clip.start });
    if (next && end > clip.end) next = restoreRange(next, { start: clip.end, end });
    if (!next) return say("Batas bagian yang dipulihkan tercapai.");
    const cuts = [...(start > clip.start ? [{ start: clip.start, end: start }] : []), ...(end < clip.end ? [{ start: end, end: clip.end }] : [])];
    next = { ...next, cuts: [...next.cuts, ...cuts] };
    if (next.cuts.length > MANUAL.maxCuts) return say("Batas potongan manual tercapai.");
    if (!framesOf(arrangeSegments(applyManualEdl(approvedEdl, { ...next, splits: [] }, duration).segments, clips, style.reelOrder, style.reelHidden), fps, duration).length) return say("Sisakan minimal satu frame video.");
    d.updateStyle({ manual: next }); setSelectedClipStart(start);
    const grew = start < clip.start || end > clip.end, shrank = cuts.length > 0;
    say(grew && shrank ? "Klip diubah. Undo tersedia." : grew ? `Bagian terpotong dimunculkan lagi (+${((clip.start - start) + Math.max(0, end - clip.end)).toFixed(2)} dtk). Undo tersedia.` : "Trim diterapkan. Undo tersedia.");
  };
  // ------------------------------------------------ klip subtitle (Fase 10)
  // Belum pernah diedit = klip dihitung dari subtitle otomatis yang tampil; edit pertama menyimpannya (membekukan).
  const autoClips = useMemo(
    // Subtitle otomatis hanya bila dinyalakan (Auto subtitle); proyek baru mulai tanpa subtitle
    () => (!ready || style.subtitles || !style.captions || !hasTranscript ? [] : autoSubtitleClips({ segments: approvedEdl.segments, source: { width: asset!.width ?? 1920, height: asset!.height ?? 1080, fps, durationS: duration }, words, style })),
    [ready, style, approvedEdl, asset, fps, duration, words, hasTranscript],
  );
  const subClips = style.subtitles?.clips ?? autoClips;
  const selectedSubClip = subClips.find((c) => c.id === selectedSub) ?? null;
  const wordVisible = useCallback((w: { start: number; end: number }) => { const m = (w.start + w.end) / 2; return approvedEdl.segments.some((sg) => m >= sg.start && m < sg.end); }, [approvedEdl]);
  const applySub = (r: SubResult, msg: string, select?: string | null) => {
    if (manualDisabled) return say("Tutup simulasi usulan dan tunggu AI selesai sebelum edit manual.");
    if (!r.ok) return say(r.error);
    d.updateStyle({ subtitles: { clips: r.clips } });
    if (select !== undefined) setSelectedSub(select);
    say(`${msg}${style.subtitles ? "" : " Subtitle sekarang klip mandiri; tombol Buat ulang dari transkrip mengembalikan otomatis."} Undo tersedia.`);
  };
  const selectSub = (id: string, focus = false) => {
    setSelectedSub(id); setSelectedCreative(null); setSelectedCam(null); setSelectedClipStart(null); setSelectedTitle(null); setSelectedId(null); setTab("manual");
    // 0 = jangan fokus. Tanpa reset, panel yang dipasang ulang akan memfokus kotak teks lagi dan tombol Delete
    // menghapus teks di kotak itu, bukan klipnya.
    setSubFocus((n) => (focus ? n + 1 : 0));
  };
  const subtitleRange = (id: string, a: number, b: number, moved: boolean) => {
    const c = subClips.find((x) => x.id === id); if (!c) return;
    applySub(moved ? moveClipSub(subClips, id, a - c.start, duration) : setClipRange(subClips, id, a, b, duration), moved ? "Subtitle digeser." : "Subtitle di-trim.");
  };
  const subtitleText = (id: string, text: string) => applySub(setClipText(subClips, id, text, wordVisible, approvedEdl.segments), "Teks subtitle diubah.");
  const subtitleDelete = (id: string) => applySub(removeClip(subClips, id), "Subtitle dihapus.", null);
  const subtitleSplit = (id: string) => applySub(splitClipSub(subClips, id, snapTime(lastSrc.current, fps)), "Subtitle dipecah di playhead.");
  const subtitleMerge = (id: string) => applySub(mergeWithNext(subClips, id), "Subtitle digabung.");
  // Auto subtitle (Fase 12): nyalakan subtitle; transkrip dibuat bila belum ada (efek di bawah)
  const autoSubtitle = () => {
    if (manualDisabled) return say("Tunggu AI selesai sebelum edit manual.");
    // Daftar subtitle manual yang KOSONG (semua subtitle pernah dihapus) tidak boleh menghalangi auto subtitle
    d.updateStyle({ captions: true, ...(style.subtitles && !style.subtitles.clips.length ? { subtitles: undefined } : {}) });
    transcriptAsked.current = false;
    say(hasTranscript ? "Subtitle otomatis dinyalakan dari ucapan. Klik subtitle di timeline untuk mengedit." : "Membuat transkrip dari ucapan… subtitle muncul otomatis setelah selesai.");
  };
  // Generate ulang (seperti CapCut): transkrip baru dari klip yang sekarang, subtitle lama (termasuk editannya) diganti.
  // Gaya subtitle bisa di-Undo; transkrip lama tetap tersimpan di database.
  const regenerateSubtitle = async () => {
    if (manualDisabled) return say("Tunggu AI selesai sebelum edit manual.");
    if (!await d.flushStyle()) return say("Edit belum tersimpan. Subtitle belum dibuat ulang.");
    const r = await fetch(`/api/projects/${id}/transcribe?force=1`, { method: "POST" });
    if (!r.ok) return say((await r.json().catch(() => ({}))).error ?? "Gagal membuat ulang subtitle");
    d.updateStyle({ captions: true, subtitles: undefined });
    setSelectedSub(null);
    say("Membuat subtitle baru dari klip yang sekarang… muncul otomatis setelah transkrip selesai. Undo mengembalikan subtitle sebelumnya.");
    await d.reloadAll();
  };
  const addSubtitle = () => {
    if (manualDisabled) return say("Tunggu AI selesai sebelum edit manual.");
    const at = snapTime(lastSrc.current, fps);
    const r = addSubtitleClip(subClips, at, 2, "Tulis subtitle", duration);
    if (!r.ok) return say(r.error);
    const added = r.clips.find((c) => !subClips.some((x) => x.id === c.id));
    d.updateStyle({ subtitles: { clips: r.clips }, captions: true });
    if (added) { setSelectedSub(added.id); setSelectedCreative(null); setSelectedCam(null); setSelectedClipStart(null); setSelectedTitle(null); setTab("manual"); setSubFocus((n) => n + 1); }
    say("Subtitle baru ditambahkan di playhead. Ketik teksnya, tarik tepinya untuk mengatur durasi.");
  };
  // Transkrip dibuat dari video yang SUDAH dipotong: simpan dulu trim/cut terbaru, baru minta worker mentranskrip
  const requestTranscript = useCallback(async () => {
    if (!await d.flushStyle()) return say("Edit belum tersimpan. Transkrip belum dibuat.");
    const r = await fetch(`/api/projects/${id}/transcribe`, { method: "POST" });
    if (!r.ok) say((await r.json().catch(() => ({}))).error ?? "Gagal membuat transkrip");
    await d.reloadAll();
  }, [d, id, say]);
  const transcriptAsked = useRef(false);
  useEffect(() => {
    if (!ready || !style.captions || hasTranscript || transcribing || transcriptAsked.current || style.subtitles?.clips.length) return;
    transcriptAsked.current = true;
    void requestTranscript();
  }, [ready, style.captions, style.subtitles, hasTranscript, transcribing, requestTranscript]);
  // Transkrip hanya mencakup bagian yang dipertahankan saat dibuat. Bagian yang dipulihkan sesudahnya belum punya kata.
  const transcriptCoverage = (d.transcript as { segments?: Interval[] | null } | null)?.segments ?? null;
  const needsRetranscribe = hasTranscript && !transcribing && !coversSegments(transcriptCoverage, approvedEdl.segments);

  // "Dengar" per usulan (Fase 12): sebelum = apa adanya; sesudah = simulasi dengan usulan diterapkan
  const listenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listen = (x: SuggestionRow, after: boolean) => {
    const a = Number(x.start_s), b = Number(x.end_s);
    if (listenTimer.current) clearTimeout(listenTimer.current);
    playerRef.current?.pause();
    setSelectedId(x.id);
    lastSrc.current = Math.max(0, a - (after ? 1.5 : 1));
    if (previewPending !== after) setPreviewPending(after); // efek "potongan berubah" mencari ulang ke lastSrc
    listenTimer.current = setTimeout(() => {
      seekSource(lastSrc.current);
      playerRef.current?.play();
      listenTimer.current = setTimeout(() => playerRef.current?.pause(), (after ? 3 : b - a + 2) * 1000);
    }, 250);
  };

  const subtitleRegenerate = () => { if (manualDisabled) return; d.updateStyle({ subtitles: undefined }); setSelectedSub(null); say("Subtitle dibuat ulang dari transkrip. Undo tersedia."); };

  // ------------------------------------------- lapisan Mode Kreatif sebagai klip (Fase 10)
  const creativeOn = !!style.creativeId && !!creative.code;
  const creativeRanges = style.creativeRanges ?? (creativeOn ? [{ start: 0, end: duration }] : []);
  const setCreativeRanges = (ranges: Interval[] | undefined, msg: string) => {
    if (manualDisabled) return say("Tutup simulasi usulan dan tunggu AI selesai sebelum edit manual.");
    d.updateStyle({ creativeRanges: ranges }); say(`${msg} Undo tersedia.`);
  };
  const creativeRange = (i: number, a: number, b: number) => {
    if (b - a < 1 / fps) return;
    const others = creativeRanges.filter((_, k) => k !== i);
    setCreativeRanges([...others, { start: Math.max(0, a), end: Math.min(duration, b) }], "Rentang lapisan kreatif diubah.");
  };
  const creativeDelete = (i: number) => { setCreativeRanges(creativeRanges.filter((_, k) => k !== i), "Lapisan kreatif dimatikan di bagian ini."); setSelectedCreative(null); };
  const creativeSplit = (i: number) => {
    const r = creativeRanges[i], t = snapTime(lastSrc.current, fps);
    if (!r || t - r.start < 1 / fps || r.end - t < 1 / fps) return say("Letakkan playhead di tengah lapisan kreatif untuk memecahnya.");
    // Dua rentang yang bersentuhan akan digabung lagi oleh normalisasi: sisakan satu frame celah
    setCreativeRanges([...creativeRanges.filter((_, k) => k !== i), { start: r.start, end: t }, { start: t + 1 / fps, end: r.end }], "Lapisan kreatif dipecah. Hapus salah satu bagian untuk mematikan efek di sana.");
  };
  const selectCreative = (i: number) => { setSelectedCreative(i); setSelectedSub(null); setSelectedCam(null); setSelectedClipStart(null); setSelectedTitle(null); setSelectedId(null); setTab("manual"); };

  // ---------------------------------------------- gerakan kamera sebagai klip (Fase 11)
  // Hapus gerakan otomatis = kamera diam di rentang itu (style.cameraMuted, waktu mentah). Hapus gerakan yang diminta
  // lewat perintah = buang permintaannya. "Hapus semua otomatis" = param kamera.otomatis false (perintah tetap jalan).
  const camMoves = built?.props.camera ?? [];
  const camSrc = (m: { start: number; end: number }) => ({ start: outputToSource(frameSegs, fps, m.start + 1e-6), end: outputToSource(frameSegs, fps, m.end - 1e-6) });
  const camRequests = (m: { start: number; end: number; preset: string }) => { const r = camSrc(m); return style.cameraOverrides.filter((q) => q.startS < r.end && q.endS > r.start && q.preset === m.preset); };
  const camStill = (m: { from: { scale: number; x: number; y: number; rot: number }; to: { scale: number; x: number; y: number; rot: number } }) => m.from.scale === m.to.scale && m.from.x === m.to.x && m.from.y === m.to.y && m.from.rot === m.to.rot;
  const selectCamera = (i: number) => { setSelectedCam(i); setSelectedSub(null); setSelectedCreative(null); setSelectedClipStart(null); setSelectedTitle(null); setSelectedId(null); setTab("manual"); const m = camMoves[i]; if (m) seekSource(camSrc(m).start); };
  const cameraDelete = (i: number) => {
    const m = camMoves[i]; if (!m) return;
    if (manualDisabled) return say("Tutup simulasi usulan dan tunggu AI selesai sebelum edit manual.");
    const req = camRequests(m);
    if (req.length) { d.updateStyle({ cameraOverrides: style.cameraOverrides.filter((q) => !req.includes(q)) }); say("Gerakan kamera yang diminta dihapus. Undo tersedia."); return; }
    if (camStill(m)) return say("Bagian ini sudah kamera diam.");
    d.updateStyle({ cameraMuted: [...(style.cameraMuted ?? []), camSrc(m)] });
    say("Gerakan kamera dihapus: kamera diam di bagian ini. Undo tersedia.");
  };
  const cameraRestore = (i: number) => {
    const m = camMoves[i]; if (!m) return;
    const r = camSrc(m), mid = (r.start + r.end) / 2;
    if (style.params["kamera.otomatis"] === false) return say("Gerakan otomatis sedang dimatikan untuk seluruh video. Nyalakan lagi lewat tombol di panel ini.");
    d.updateStyle({ cameraMuted: (style.cameraMuted ?? []).filter((x) => !(mid >= x.start && mid < x.end)) });
    say("Gerakan kamera dikembalikan. Undo tersedia.");
  };
  /** Ikuti safe area platform (param bingkai.safeArea). Bawaan menyala: kunci dihapus agar project lama tidak berubah. */
  const followSafeArea = style.params["bingkai.safeArea"] !== false;
  const setFollowSafeArea = (on: boolean) => {
    const { ["bingkai.safeArea"]: _drop, ...rest } = style.params;
    d.updateStyle({ params: on ? rest : { ...style.params, "bingkai.safeArea": false } });
    say(on ? "Subtitle, judul, dan animasi AI kembali mengikuti safe area Reels/TikTok. Undo tersedia." : "Safe area tidak diikuti: hanya jarak tepi biasa. Animasi AI yang sudah ada tidak berubah sampai dibuat versi baru. Undo tersedia.");
  };
  const cameraAuto = (on: boolean) => {
    if (manualDisabled) return say("Tutup simulasi usulan dan tunggu AI selesai sebelum edit manual.");
    const { ["kamera.otomatis"]: _drop, ...rest } = style.params;
    d.updateStyle(on ? { params: rest, cameraMuted: undefined } : { params: { ...style.params, "kamera.otomatis": false }, camera: true });
    say(on ? "Gerakan kamera otomatis dinyalakan lagi. Undo tersedia." : "Semua gerakan kamera otomatis dihapus. Gerakan yang Anda minta lewat perintah tetap jalan; minta gerakan baru di tab Perintah. Undo tersedia.");
  };

  useEffect(() => { if (selectedClipStart !== null || selectedTitle !== null || selectedSub !== null || selectedCreative !== null || selectedCam !== null) setSelectedSfx(null); }, [selectedClipStart, selectedTitle, selectedSub, selectedCreative, selectedCam]);
  // ------------------------------------------------------------- efek suara (Fase 14)
  // Isyarat edit memakai waktu SUMBER (ikut cut); isyarat versi kreatif memakai waktu hasil versi itu.
  const sfxCues = style.sfx?.cues ?? [];
  const sfxUseCreative = style.sfx?.useCreative !== false;
  const creativeSfx = creativeOn ? creative.code?.sfx ?? [] : [];
  const sfxMaster = Number(style.params["audio.sfx"] ?? SFX.defaultMaster);
  const setSfx = (cues: SfxCue[], msg: string | null, useCreative = sfxUseCreative, group?: string) => {
    if (manualDisabled) { say("Tutup simulasi usulan dan tunggu AI selesai sebelum edit manual."); return false; }
    const r = normalizeCues(cues, duration);
    d.updateStyle({ sfx: { cues: r.cues, useCreative } }, group);
    if (r.dropped.length) say(`SFX tidak dipasang: ${r.dropped[0]}.`);
    else if (msg) say(`${msg} Undo tersedia.`);
    return r.dropped.length === 0;
  };
  const selectSfx = (i: number | null) => {
    setSelectedSfx(i); setSelectedSub(null); setSelectedCreative(null); setSelectedCam(null); setSelectedClipStart(null); setSelectedTitle(null); setSelectedId(null);
    setTab("manual"); setSfxFocus((n) => n + 1);
  };
  const sfxAdd = (item: { id: string; name: string }) => {
    const at = snapTime(lastSrc.current, fps);
    if (setSfx([...sfxCues, { id: item.id, at, volume: 1 }], `SFX ${item.name} ditambahkan di ${fmtTime(at)}.`)) {
      const next = normalizeCues([...sfxCues, { id: item.id, at, volume: 1 }], duration).cues;
      setSelectedSfx(next.findIndex((c) => c.id === item.id && Math.abs(c.at - at) < 1e-3));
    }
  };
  const sfxPatch = (i: number, patch: Partial<SfxCue>) => {
    const next = sfxCues.map((c, k) => (k === i ? { ...c, ...patch } : c));
    if (setSfx(next, patch.at !== undefined ? "SFX dipindahkan." : null, sfxUseCreative, patch.at === undefined ? `sfx-vol-${i}` : undefined) && patch.at !== undefined) {
      setSelectedSfx(normalizeCues(next, duration).cues.findIndex((c) => c.id === sfxCues[i].id && Math.abs(c.at - patch.at!) < 1e-3));
    }
  };
  const sfxDelete = (i: number) => { setSfx(sfxCues.filter((_, k) => k !== i), "SFX dihapus."); setSelectedSfx(null); };
  // Salin isyarat kreatif (waktu hasil) ke isyarat edit (waktu sumber), lalu matikan yang kreatif agar tidak berbunyi dua kali
  const sfxCopyCreative = () => {
    const copied = creativeSfx.map((c) => ({ ...c, at: outputToSource(frameSegs, fps, c.at) }));
    setSfx([...sfxCues, ...copied], `${copied.length} SFX kreatif disalin ke edit dan bisa digeser.`, false);
  };

  // ------------------------------------------------------------- urutan video (Fase 16)
  const reelOrder = normalizeOrder(style.reelOrder, clips);
  const reelHidden = (style.reelHidden ?? []).filter((x) => clips.some((c) => c.id === x));
  const visibleOrder = reelOrder.filter((x) => !reelHidden.includes(x));
  const labelOf = (vid: string) => clips.find((c) => c.id === vid)?.label ?? "video";
  const setReel = (patch: { reelOrder?: string[]; reelHidden?: string[] }, msg: string) => {
    if (manualDisabled) return say("Tutup simulasi usulan dan tunggu AI selesai sebelum edit manual.");
    const hidden = patch.reelHidden ?? reelHidden;
    if (!clips.some((c) => !hidden.includes(c.id))) return say("Sisakan minimal satu video di timeline.");
    d.updateStyle({ reelOrder: patch.reelOrder ?? reelOrder, reelHidden: hidden.length ? hidden : undefined });
    say(`${msg} Undo tersedia.`);
  };
  /** Urutan baru video yang terlihat; video tersembunyi tetap di belakang. */
  const reorderVideos = (ids: string[]) => setReel({ reelOrder: [...ids, ...reelOrder.filter((x) => !ids.includes(x))] }, "Urutan video diubah.");
  const dropVideo = (vid: string, index: number) => {
    if (!clips.some((c) => c.id === vid)) return say("Video ini belum selesai diproses.");
    const ids = visibleOrder.filter((x) => x !== vid);
    ids.splice(Math.min(index, ids.length), 0, vid);
    setReel({ reelOrder: [...ids, ...reelOrder.filter((x) => !ids.includes(x))], reelHidden: reelHidden.filter((x) => x !== vid) }, reelHidden.includes(vid) ? `${labelOf(vid)} ditambahkan ke timeline.` : "Urutan video diubah.");
  };
  const toggleVideo = (vid: string) => setReel({ reelHidden: reelHidden.includes(vid) ? reelHidden.filter((x) => x !== vid) : [...reelHidden, vid] }, reelHidden.includes(vid) ? `${labelOf(vid)} ditampilkan lagi.` : `${labelOf(vid)} disembunyikan dari hasil (file tetap ada).`);
  const selectVideo = (vid: string) => {
    const c = clips.find((x) => x.id === vid);
    const first = c && approvedEdl.segments.find((sg) => sg.start >= c.offset - 1e-6 && sg.end <= c.offset + c.duration + 1e-6);
    if (first) seekSource(first.start);
  };

  const restoreGap = (gap: Interval) => {
    if (manualDisabled) return say("Tutup simulasi usulan dan tunggu AI selesai sebelum edit manual.");
    const next = restoreRange(manual, gap);
    if (!next) return say("Batas bagian yang dipulihkan tercapai.");
    d.updateStyle({ manual: next });
    say(`${(gap.end - gap.start).toFixed(1)} dtk yang terpotong dipulihkan. Undo tersedia.`);
  };
  const splitClip = () => {
    if (manualDisabled) return say("Tutup simulasi usulan dan tunggu AI selesai sebelum split.");
    if (manual.splits.length >= MANUAL.maxSplits) return say("Batas split tercapai.");
    const time = snapTime(lastSrc.current, fps);
    const clip = approvedEdl.segments.find((c) => time - c.start >= 1 / fps - 1e-7 && c.end - time >= 1 / fps - 1e-7);
    if (!clip) return say("Letakkan playhead di tengah klip, bukan pada batas atau bagian terpotong.");
    d.updateStyle({ manual: { ...manual, splits: [...manual.splits, time] } });
    setSelectedClipStart(time); setSelectedTitle(null); setTab("manual"); say("Klip dipisahkan tanpa membuang frame.");
  };
  const deleteClip = () => { if (selectedClip && addCuts([selectedClip])) say("Klip dihapus dari hasil. Gunakan Undo untuk mengembalikan."); };
  const selectClip = (i: number) => { const clip = approvedEdl.segments[i]; if (!clip) return; setSelectedClipStart(clip.start); setSelectedTitle(null); setSelectedSub(null); setSelectedCreative(null); setSelectedCam(null); setSelectedId(null); setTab("manual"); seekSource(clip.start); };
  const selectTitle = (i: number | null) => { setSelectedTitle(i); setSelectedClipStart(null); setSelectedSub(null); setSelectedCreative(null); setSelectedCam(null); setSelectedId(null); setTab("manual"); if (i !== null && style.titles?.[i]) seekSource(style.titles[i].startS); };
  const titleRange = (i: number, a: number, b: number) => {
    if (manualDisabled) return;
    if (b - a > MOTION.title.maxDurationSec || a < 0 || b > duration || b <= a) return say(`Durasi judul maksimal ${MOTION.title.maxDurationSec} detik.`);
    d.updateStyle({ titles: (style.titles ?? []).map((t, n) => n === i ? { ...t, startS: a, endS: b } : t) });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? d.redoStyle() : d.undoStyle(); }
        if (e.key.toLowerCase() === "y") { e.preventDefault(); d.redoStyle(); }
      } else if (e.key.toLowerCase() === "s") { e.preventDefault(); if (selectedSubClip) subtitleSplit(selectedSubClip.id); else if (selectedCreative !== null) creativeSplit(selectedCreative); else splitClip(); }
      else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedSfx !== null && sfxCues[selectedSfx]) { e.preventDefault(); sfxDelete(selectedSfx); }
        else if (selectedSubClip) { e.preventDefault(); subtitleDelete(selectedSubClip.id); }
        else if (selectedCreative !== null) { e.preventDefault(); creativeDelete(selectedCreative); }
        else if (selectedCam !== null) { e.preventDefault(); cameraDelete(selectedCam); }
        else if (selectedClip) { e.preventDefault(); deleteClip(); }
      }
      else if (["ArrowLeft", "ArrowRight"].includes(e.key) && (e.target as HTMLElement).getAttribute("role") !== "slider") { e.preventDefault(); playerRef.current?.seekTo(Math.max(0, Math.min((built?.durationInFrames ?? 1) - 1, (playerRef.current?.getCurrentFrame() ?? 0) + (e.key === "ArrowRight" ? 1 : -1)))); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });

  // ---------------------------------------------------------------------- tampilan
  if (d.loadError) return <div className={s.root}><div className={s.loading}><Icon name="film" size={32}/><span>{d.loadError}</span><Link href="/">Kembali ke project</Link></div></div>;
  if (!detail) return <div className={s.root}><div className={s.loading}><Icon name="film" size={32}/><span>Menyiapkan ruang editing…</span></div></div>;
  if ((detail.project as { kind?: string }).kind === "motion") {
    if (typeof window !== "undefined") window.location.replace(`/projects/${id}/motion`);
    return <div className={s.root}><div className={s.loading}><span>Membuka motion graphics…</span></div></div>;
  }

  const out = ASPECTS[style.aspect];
  const videoUrl = (a: { id: string; preview_status?: string | null }) => `/api/assets/${a.id}/file?view=1${previewRevision ? `&previewRetry=${previewRevision}` : ""}${a.preview_status === "siap" ? "&pv=1" : ""}`;
  // Geser video: video yang tampil di playhead menentukan ukuran sumber dan (multi video) fokus horizontal per video
  const panTarget = (() => {
    if (!built) return null;
    const srcs = built.props.sources;
    let vid: string | null = null;
    if (srcs?.length) {
      const frame = playerRef.current?.getCurrentFrame() ?? 0, f = built.props.fps;
      const seg = toFrameSegments(built.props.segments, f, built.props.sourceSeconds).find((x) => frame >= x.at && frame < x.at + x.length);
      const reel = seg ? seg.srcFrom + (frame - seg.at) : 0;
      vid = (srcs.find((x) => reel >= Math.round(x.offset * f) && reel < Math.round((x.offset + x.duration) * f)) ?? srcs[0]).id;
    }
    const a = (vid ? rawAssets.find((r) => r.id === vid) : null) ?? asset;
    return { vid, srcW: a?.width ?? 1920, srcH: a?.height ?? 1080, x: (vid ? style.focusBy?.[vid] : undefined) ?? style.focusX };
  })();
  const panFocusNow: Focus = { x: panTarget?.x ?? style.focusX, y: style.focusY ?? 0.5 };
  const setPan = (f: Focus) => d.updateStyle({ focusY: f.y, ...(panTarget?.vid && style.focusBy?.[panTarget.vid] !== undefined ? { focusBy: { ...style.focusBy, [panTarget.vid]: f.x } } : { focusX: f.x }) }, "geser-canvas");
  const videoScale = Number(style.params["video.skala"] ?? 1);
  const stage = built ? (
    <div className={s.stageBox} style={{ aspectRatio: `${out.width} / ${out.height}`, ["--video-ratio" as string]: out.width / out.height }}>
      <Player numberOfSharedAudioTags={SFX.playerAudioTags}
        // Audio hasil reduksi noise yang baru siap/berganti: pemutar dibuat ulang (dan berhenti). Audio yang dipasang di
        // tengah pemutaran tidak boleh berbunyi oleh browser (butuh klik), sehingga video bisu tanpa suara pengganti.
        key={`${style.aspect}-${previewRevision}-${audioKey}`}
        ref={playerRef}
        component={Edited}
        inputProps={{ ...built.props, src: videoUrl(asset!), ...(built.props.sources ? { sources: built.props.sources.map((x) => { const a = rawAssets.find((r) => r.id === x.id); return { ...x, src: a ? videoUrl(a) : "", ...(derived.audioSrc(x.id) ? { audioSrc: derived.audioSrc(x.id) } : {}), ...(talent?.[x.id] ? { talentSrc: talent[x.id].src } : {}) }; }) } : {}), onVideoError, onCreativeError, ...(derived.denoise.status === "siap" && !built.props.sources ? { denoisedSrc: derived.denoise.src } : {}) }}
        initialFrame={Math.min(previewResumeFrame.current, built.durationInFrames - 1)}
        durationInFrames={built.durationInFrames}
        fps={built.props.fps}
        compositionWidth={built.props.width}
        compositionHeight={built.props.height}
        style={{ width: "100%", height: "100%" }}
        controls={false}
        clickToPlay
        acknowledgeRemotionLicense
      />
      <SafeAreaGuide aspect={style.aspect} show={safeGuide && !panMode} />
      {panMode && panTarget && <CanvasPan focus={panFocusNow} scale={videoScale} compW={built.props.width} compH={built.props.height} srcW={panTarget.srcW} srcH={panTarget.srcH}
        keyframed={manual.keyframes.length > 0}
        onPan={setPan}
        onZoom={(v) => d.updateStyle({ params: { ...style.params, "video.skala": v } }, "zoom-canvas")}
        onReset={() => d.updateStyle({ focusY: 0.5, params: { ...style.params, "video.skala": 1 }, ...(panTarget.vid && style.focusBy?.[panTarget.vid] !== undefined ? { focusBy: { ...style.focusBy, [panTarget.vid]: 0.5 } } : { focusX: 0.5 }) })}
        onDone={() => setPanMode(false)} />}
      {(creative.error || endClipCode.error || creativeErrors.length > 0) && <div className={s.creativeError} role="status">
        <strong>{creative.error ? "Layer kreatif tidak dimuat" : endClipCode.error ? "Klip akhir tidak dimuat" : "Layer kreatif error di sebagian frame"}</strong>
        <p>{creative.error ?? endClipCode.error ?? "Frame yang error ditampilkan tanpa layer kreatif. Video, subtitle, dan EDL tidak terpengaruh."}</p>
        {creativeErrors.length > 0 && <details><summary>Detail ({creativeErrors.length}{creativeErrors.length >= 5 ? "+" : ""})</summary>{creativeErrors.map((e) => <p key={e}>{e}</p>)}</details>}
      </div>}
      {(asset?.preview_status === "antre" || asset?.preview_status === "gagal" || derived.previewError) && <div className={s.creativeError} role="status">
        <strong>{asset?.preview_status === "antre" ? "Menyiapkan salinan pratinjau…" : "Salinan pratinjau gagal dibuat"}</strong>
        <p>{asset?.preview_status === "antre"
          ? "Format video ini (mis. MOV HEVC dari iPhone) tidak bisa diputar browser. Worker sedang membuat salinan MP4 khusus pratinjau; layar akan muncul sendiri setelah selesai. Render tetap dari file asli."
          : derived.previewError ?? asset?.preview_error ?? "Coba muat ulang halaman."}</p>
      </div>}
      {needsRetranscribe && <div className={s.creativeError} role="status">
        <strong>Ada bagian video tanpa transkrip</strong>
        <p>Transkrip dibuat dari potongan sebelumnya. Bagian yang baru dipulihkan belum punya subtitle dan belum bisa dipakai perintah yang menyebut kata.</p>
        <button className={`${s.btn} ${s.primary}`} onClick={() => void requestTranscript()}>Perbarui transkrip</button>
      </div>}
      {derived.denoise.status === "gagal" && <div className={s.creativeError} role="status">
        <strong>Kurangi noise gagal</strong><p>{derived.denoise.error} Pratinjau memakai audio asli.</p>
      </div>}
      {previewError && <div className={s.previewError} role="alert">
        <strong>Preview video terputus</strong>
        <p>Browser gagal membaca video. Muat ulang preview untuk melanjutkan dari posisi ini.</p>
        <button className={`${s.btn} ${s.primary}`} onClick={retryPreview}>Muat ulang preview</button>
        <details><summary>Detail teknis</summary><p>{previewError}</p></details>
      </div>}
    </div>
  ) : (
    <div className={s.empty}>
      {detail.project.status !== "ready" ? <>Project belum siap ({detail.project.status}). <Link href={`/projects/${id}`}>Lihat status di halaman project</Link>.</> : "Menyiapkan pratinjau..."}
    </div>
  );

  return (
    <div className={`${s.root} ${focus ? s.focus : ""} ${timelineExpanded ? s.timelineExpanded : ""} ${inspector === true ? s.inspectorOpen : inspector === false ? s.inspectorHidden : ""}`}>
      <div className={s.top}>
        <Link href="/" title="Semua project" aria-label="Semua project"><span className={s.brandIcon}><Icon name="film" size={18}/></span></Link>
        <span className={s.topDivider}/>
        <div className={s.projectTitle}><small>Editing workspace</small><h1>{detail.project.name}</h1></div>
        <span className={s.chip}>{detail.project.status === "ready" ? "Siap diedit" : detail.project.status}</span>
        <div className={s.undoGroup}><button className={s.iconBtn} aria-label="Undo edit manual" title="Undo (Ctrl+Z)" disabled={!d.canUndoStyle || d.promptRunning} onClick={d.undoStyle}>↶</button><button className={s.iconBtn} aria-label="Redo edit manual" title="Redo (Ctrl+Shift+Z)" disabled={!d.canRedoStyle || d.promptRunning} onClick={d.redoStyle}>↷</button></div>
        <span className={`${s.saveStatus} ${d.styleError ? s.err : ""}`} role="status">{d.promptRunning ? "AI sedang mengedit…" : d.styleSave}</span>
        {toast && <span role="status" className={s.chip} style={{ color: "var(--text)", borderColor: "var(--accent)", maxWidth: "40vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={toast}>{toast}</span>}
        <span className={s.spacer} />
        <Link href={`/projects/${id}`} className={s.classicLink}>Detail project</Link>
        <button className={`${s.iconBtn} ${s.focusButton}`} aria-label="Mode fokus" title="Mode fokus — perluas preview" aria-pressed={focus} onClick={() => setFocus(!focus)}><Icon name="expand" size={16}/></button>
        <button className={s.iconBtn} aria-label="Panel properti" title="Tampilkan / sembunyikan properti" aria-pressed={inspector ?? undefined} onClick={() => { setFocus(false); setInspector((v) => !(v ?? window.innerWidth > 980)); }}><Icon name="panel" size={16}/></button>
        {/* Saat render berjalan tombol nonaktif: tampilkan progres dan alasannya, bukan tombol abu-abu tanpa keterangan */}
        <button className={`${s.btn} ${s.primary}`} onClick={() => void exportNow()} disabled={!ready || exporting || renderBusy}
          title={renderBusy ? "Render sedang berjalan. Ekspor berikutnya bisa dimulai setelah selesai." : saveState ?? "Pilih lokasi file, lalu render MP4"}>
          <Icon name="export" size={15}/>{exportInfo?.renderJob?.status === "queued" ? "Menunggu render…" : renderBusy ? `Merender… ${Math.round((exportInfo?.renderJob?.progress ?? 0) * 100)}%` : saveState?.startsWith("Menyimpan") ? "Menyimpan…" : "Ekspor MP4"}
        </button>
        {renderBusy && <button className={s.btn} onClick={() => void cancelRender(id).then((m) => { say(m); void d.loadExport(); })} title="Hentikan render ini. Video, EDL, dan hasil ekspor sebelumnya tidak berubah.">Batalkan render</button>}
      </div>

      <div className={s.main}>
        <div className={s.left}>
          <div className={s.panelHeading}><Icon name="sparkle" size={15}/> Studio editing <span>AI + MANUAL</span></div>
          {d.styleError && <div className={s.saveError} role="alert">{d.styleError}<div className={s.actions}><button className={s.mini} onClick={() => void d.flushStyle()}>Coba simpan</button><button className={s.mini} onClick={() => void d.discardLocalStyle()}>Buang edit lokal & muat server</button></div></div>}
          <div className={s.tabs} role="tablist" aria-label="Panel editing">
            <button role="tab" aria-selected={tab === "prompt"} className={tab === "prompt" ? s.on : ""} onClick={() => setTab("prompt")}>Prompt</button>
            <button role="tab" aria-selected={tab === "manual"} className={tab === "manual" ? s.on : ""} onClick={() => setTab("manual")}>Manual</button>
            <button role="tab" aria-selected={tab === "suggestions"} className={tab === "suggestions" ? s.on : ""} onClick={() => setTab("suggestions")}>Usulan {suggestions.length ? `(${suggestions.length})` : ""}</button>
            <button role="tab" aria-selected={tab === "transcript"} className={tab === "transcript" ? s.on : ""} onClick={() => setTab("transcript")}>Transkrip</button>
            <button role="tab" aria-selected={tab === "media"} className={tab === "media" ? s.on : ""} onClick={() => setTab("media")}>Media{rawAssets.length > 1 ? ` (${rawAssets.length})` : ""}</button>
            <button role="tab" aria-selected={tab === "aset"} className={tab === "aset" ? s.on : ""} onClick={() => setTab("aset")} title="Gambar milikmu + keterangan; AI mengusulkan kapan muncul dari transkrip">Aset{ownImages ? ` (${ownImages})` : ""}</button>
          </div>
          {tab === "prompt" ? (
            <>
              <div className={s.modeSwitch} role="group" aria-label="Mode prompt">
                <button aria-pressed={promptMode === "cepat"} title="Pengaturan siap pakai (kamera, subtitle, judul, jeda). Selesai dalam hitungan detik." onClick={() => setPromptMode("cepat")}>Cepat <small>· detik</small></button>
                <button aria-pressed={promptMode === "kreatif"} title="AI menulis kode Remotion khusus video ini memakai skill. 2–8 menit, Opus." onClick={() => setPromptMode("kreatif")}>Kreatif{style.creativeId ? " ●" : ""} <small>· 2–8 menit</small></button>
                <button aria-pressed={promptMode === "akhir"} title="Tambah klip motion di akhir video, misalnya CTA. Durasi kamu pilih, isinya dari prompt." onClick={() => setPromptMode("akhir")}>Klip akhir{style.endClip ? " ●" : ""} <small>· CTA</small></button>
              </div>
              {promptMode === "cepat"
                ? <PromptPanel projectId={id} prompts={d.prompts} promptsError={d.promptsError} analyzers={d.analyzers} busy={d.promptRunning} ready={ready} onSend={sendPrompt} onUndo={undoPrompt} onApproveAll={approveAllFromPrompt} />
                : promptMode === "akhir"
                ? <CreativePanel key="klip-akhir" endClip={{ seconds: endSeconds, onSeconds: changeEndSeconds }} onMaterialsChanged={() => void mats.reload()} projectId={id} aspect={style.aspect} ready={ready} analyzers={d.analyzers} activeId={style.endClip?.versionId} styleLocked={d.promptRunning}
                    onActivate={(versionId) => d.updateStyle({ endClip: versionId ? { seconds: endSeconds, versionId } : undefined })}
                    intro={{ title: "Tambah klip motion di akhir video.", body: "Pilih durasinya, lalu tulis isi motion-nya, misalnya ajakan bertindak dan logo. Video, subtitle, dan cut tidak berubah. Klip baru muncul setelah kamu menekan Aktifkan." }}
                    examples={[{ label: "CTA + logo", prompt: "Klip penutup CTA: logo di tengah muncul dengan animasi halus, lalu teks besar \"Follow untuk tips berikutnya\" dengan warna aksen. Latar gelap bersih." }, { label: "CTA link di bio", prompt: "Klip penutup: teks \"Cek link di bio\" besar di tengah, panah animasi mengarah ke bawah, latar warna aksen." }]} />
                : <CreativePanel key="kreatif" rig={{ images: mats.materials.filter((m) => String(m.mime ?? "").startsWith("image/") && m.role !== "logo" && m.role !== "design").length, rigged: mats.materials.filter((m) => (m as { rig?: unknown }).rig && m.role !== "logo").length }} talent={{ ready: !!talent && clips.length > 0 && clips.every((c) => !!talent[c.id]), seconds: duration }} onMaterialsChanged={() => void mats.reload()} projectId={id} aspect={style.aspect} ready={ready} analyzers={d.analyzers} activeId={style.creativeId} styleLocked={d.promptRunning} onActivate={(creativeId) => d.updateStyle({ creativeId })} />}
            </>
          ) : tab === "manual" ? (
            selectedSubClip ? (
              <SubtitleClipPanel clip={selectedSubClip} text={selectedSubClip.words.filter(wordVisible).map((w) => w.text).join(" ")} hiddenWords={selectedSubClip.words.filter((w) => !wordVisible(w)).length}
                frozen={!!style.subtitles} hasNext={subClips.some((c) => c.start > selectedSubClip.start)} focusToken={subFocus} disabled={manualDisabled}
                onText={(t) => subtitleText(selectedSubClip.id, t)} onDelete={() => subtitleDelete(selectedSubClip.id)} onSplit={() => subtitleSplit(selectedSubClip.id)} onMerge={() => subtitleMerge(selectedSubClip.id)}
                onRegenerate={subtitleRegenerate} onSeek={seekSource} onClose={() => setSelectedSub(null)} />
            ) : selectedCam !== null && camMoves[selectedCam] ? (
              <div className={s.manualPanel}>
                <div className={s.manualHero}><span>KAMERA</span><strong>{camStill(camMoves[selectedCam]) ? "Kamera diam." : camRequests(camMoves[selectedCam]).length ? "Gerakan yang Anda minta." : "Gerakan otomatis."}</strong>
                  <p>{fmtTime(camMoves[selectedCam].start)} — {fmtTime(camMoves[selectedCam].end)} hasil video. Gerakan kamera tidak menggeser subtitle (aturan 4).{style.params["kamera.otomatis"] === false ? " Gerakan otomatis sedang mati untuk seluruh video." : ""}</p></div>
                <fieldset disabled={manualDisabled} className={s.manualFields}><div className={s.manualActions}>
                  {!camStill(camMoves[selectedCam]) && <button onClick={() => cameraDelete(selectedCam)}>Hapus gerakan ini <kbd>Del</kbd></button>}
                  {camStill(camMoves[selectedCam]) && style.params["kamera.otomatis"] !== false && <button onClick={() => cameraRestore(selectedCam)}>↺ Kembalikan gerakan</button>}
                  {style.params["kamera.otomatis"] === false
                    ? <button onClick={() => cameraAuto(true)}>↺ Nyalakan lagi gerakan otomatis</button>
                    : <button onClick={() => cameraAuto(false)}>Hapus semua gerakan otomatis</button>}
                  <button onClick={() => setSelectedCam(null)}>Tutup</button>
                </div>
                <p className={s.muted}>Setelah gerakan otomatis dihapus, minta gerakan lewat tab Perintah, mis. “zoom pelan saat aku bilang dashboard”.</p></fieldset>
              </div>
            ) : selectedCreative !== null && creativeRanges[selectedCreative] ? (
              <div className={s.manualPanel}>
                <div className={s.manualHero}><span>MODE KREATIF</span><strong>Lapisan kreatif.</strong><p>Tampil {fmtTime(creativeRanges[selectedCreative].start)} — {fmtTime(creativeRanges[selectedCreative].end)} video mentah. Di luar rentang, efek kreatif mati dan subtitle biasa muncul kembali (bila versi ini menggantikannya).</p></div>
                <fieldset disabled={manualDisabled} className={s.manualFields}><div className={s.manualActions}>
                  <button onClick={() => creativeSplit(selectedCreative)}>✂ Pecah di playhead <kbd>S</kbd></button>
                  <button onClick={() => creativeDelete(selectedCreative)}>Matikan di bagian ini <kbd>Del</kbd></button>
                  {style.creativeRanges && <button onClick={() => { setCreativeRanges(undefined, "Lapisan kreatif tampil di seluruh video."); setSelectedCreative(null); }}>↺ Tampilkan di seluruh video</button>}
                  <button onClick={() => setSelectedCreative(null)}>Tutup</button>
                </div></fieldset>
              </div>
            ) :
            <ManualPanel sfxFocus={sfxFocus} audioFocus={audioFocus}sfx={<SfxPanel lib={sfxLib} cues={sfxCues} selected={selectedSfx} onSelect={setSelectedSfx} onAdd={sfxAdd} onPatch={sfxPatch} onDelete={sfxDelete}
                master={sfxMaster} onMaster={(v) => d.updateStyle({ params: { ...style.params, "audio.sfx": v } }, "audio.sfx")}
                creativeCount={creativeSfx.length} useCreative={sfxUseCreative} onUseCreative={(on) => setSfx(sfxCues, on ? "SFX Mode Kreatif dinyalakan." : "SFX Mode Kreatif dimatikan.", on)} onCopyCreative={sfxCopyCreative}
                onSeek={seekSource} disabled={manualDisabled} onMessage={say} timeNote="Waktu di sini = waktu video mentah; SFX ikut bergeser bila cut berubah."/>}
              style={style} update={d.updateStyle} duration={duration} fps={fps} clip={selectedClip} clipLimits={selectedClip ? extendLimits(approvedEdl.segments, selectedClip, duration, clipBounds(selectedClip)) : null} selectedTitle={selectedTitle} onSelectTitle={selectTitle} onTrim={clipRange} onDelete={deleteClip} onSplit={splitClip} getTime={() => lastSrc.current} onSeek={seekSource} disabled={manualDisabled} onMessage={say}/>
          ) : tab === "aset" ? (
            <OwnAssetPanel projectId={id} analyzers={d.analyzers?.analyzers} materials={mats.materials} onMaterialsChanged={mats.reload} hasTranscript={hasTranscript}
              getPlayhead={() => lastSrc.current} onSeek={seekSource} isCut={isCutOut} disabled={!ready} say={say}
              onGoCreative={() => { setTab("prompt"); setPromptMode("kreatif"); }} />
          ) : tab === "media" ? (
            <MediaPanel projectId={id} videos={rawAssets} order={reelOrder} hidden={reelHidden} focusBy={style.focusBy ?? {}} primaryId={asset?.id ?? null} disabled={manualDisabled}
              onReorder={reorderVideos} onToggleHidden={toggleVideo} onSelect={selectVideo} onChanged={() => void d.loadDetail()} onMessage={say} videoUrl={videoUrl}
              onFocus={(vid, x) => d.updateStyle({ focusBy: { ...(style.focusBy ?? {}), [vid]: x } }, `fokus-${vid}`)} />
          ) : tab === "suggestions" ? (
            <SuggestionsPanel suggestions={suggestions} keeps={manual.keeps} onListen={listen}
              header={<AutoCutBox projectId={id} analyzers={d.analyzers} jobs={detail.jobs} hasTranscript={hasTranscript} pendingCount={pendingCount}
                durations={{ now: approvedEdl.keptS, ifAll: makeEdl(true).keptS }} previewPending={previewPending} setPreviewPending={setPreviewPending}
                onStarted={() => void d.reloadAll()} disabled={!ready || d.promptRunning} />} selectedId={selectedId} onSelect={(sid) => { setSelectedId(sid); const x = suggestions.find((q) => q.id === sid); if (x) seekSource(Math.max(0, Number(x.start_s) - 0.5)); }} onStatus={onStatus} onBulk={onBulk} />
          ) : (
            <div className={s.tabBody}>
              <div className={s.transcriptHeader}><input aria-label="Cari kata dalam transkrip" placeholder="Cari kata dalam transkrip…" value={transcriptSearch} onChange={(e) => setTranscriptSearch(e.target.value)} style={{ width: "100%", padding: 8 }}/><p>{transcriptSearch.trim() ? `${transcriptMatches.length} kata cocok` : `${words.length} kata · Klik kata untuk menuju video, klik dua kali untuk memperbaiki typo subtitle.${d.transcript?.original_words ? " Sudah dikoreksi." : ""}`}</p>{transcriptMatches.length > 0 && <button className={s.mini} onClick={() => seekSource(transcriptMatches[0].start)}>Ke hasil pertama</button>}</div>
              <TranscriptAiFix aiFix={(detail?.jobs.find((j) => j.type === "transcribe")?.payload as { aiFix?: never } | undefined)?.aiFix} onSeek={seekSource} />
              <div className={s.transcriptWords}>{words.length === 0 ? <p className={s.muted}>Transkrip belum tersedia.</p> : words.map((w, i) => editingWord === i ? (
                <input
                  key={i}
                  autoFocus
                  defaultValue={w.text}
                  aria-label={`Koreksi kata di ${fmtTime(w.start)}`}
                  className={s.wordEdit}
                  style={{ width: `${Math.max(4, w.text.length + 2)}ch` }}
                  onFocus={(e) => e.target.select()}
                  onBlur={(e) => commitWord(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitWord(i, e.currentTarget.value); }
                    if (e.key === "Escape") setEditingWord(null);
                  }}
                />
              ) : <button key={i} title={`Ke ${fmtTime(w.start)} · klik dua kali untuk koreksi`} onClick={() => seekSource(w.start)} onDoubleClick={() => setEditingWord(i)} style={transcriptSearch && w.text.toLocaleLowerCase().includes(transcriptSearch.toLocaleLowerCase()) ? { background: "var(--ui-accent-soft)", color: "var(--accent)" } : undefined}>{w.text}</button>)}</div>
            </div>
          )}
        </div>

        <div className={s.center}>
          <div className={s.viewerBar}><span><Icon name="play" size={12}/> PREVIEW</span><span>{derived.denoise.level > 0 && <span className={s.chip} title="Kurangi noise (Audio)">{derived.denoise.status === "siap" ? `Noise −${derived.denoise.level}%` : derived.denoise.status === "memproses" ? `Memproses noise ${derived.denoise.level}%…` : "Noise: gagal"}</span>} {style.aspect} <span className={s.chip}>{out.width} × {out.height}</span> <button className={`${s.mini} ${s.panToggle}`} aria-pressed={safeGuide} onClick={() => setSafeGuide(!safeGuide)} title="Tampilkan bagian yang tertutup tombol dan caption Reels/TikTok (tidak ikut terekspor)">▣ Safe area</button> <label className={s.mini} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }} title="Dicentang: subtitle, judul, dan animasi AI menghindari bagian yang tertutup UI Reels/TikTok. Tidak dicentang: hanya jarak tepi biasa (ikut render)"><input type="checkbox" checked={followSafeArea} disabled={manualDisabled} onChange={(e) => setFollowSafeArea(e.target.checked)} style={{ margin: 0 }} /> Ikuti safe area</label> <button className={`${s.mini} ${s.panToggle}`} aria-pressed={panMode} disabled={!built || d.promptRunning} title="Geser dan zoom video langsung di canvas" onClick={() => { playerRef.current?.pause(); setPanMode((v) => !v); }}>✥ Geser video</button></span></div>
          <div className={s.stage}>{stage}</div>
          <div className={s.transport}>
            <button className={s.play} onClick={() => playerRef.current?.toggle()} disabled={!built || !!previewError} aria-label={playing ? "Jeda" : "Putar"}><Icon name={playing ? "pause" : "play"} size={16}/></button>
            <span className={s.time} ref={timecodeRef}><b>0:00.0</b> / {built ? fmtTime(built.durationInFrames / fps) : "0:00.0"}</span>
            <span className={s.spacer} />
            <span className={s.previewNote}>{previewPending ? "Simulasi semua usulan" : "Hanya potongan disetujui"}</span>
          </div>
        </div>

        <RightPanel
          ready={ready} onClose={() => setInspector(false)}
          noiseStatus={derived.denoise.status === "memproses" ? "memproses…" : derived.denoise.status === "siap" ? "aktif" : derived.denoise.status === "gagal" ? "gagal" : null}
          selected={selected} duration={duration} sourceAspect={(asset?.width ?? 16) / (asset?.height ?? 9)}
          style={style} updateStyle={d.updateStyle}
          previewPending={previewPending} setPreviewPending={setPreviewPending}
          pendingCount={pendingCount} approvedCount={approvedCount} keptS={viewEdl.keptS} removedS={viewEdl.removedS}
          exportInfo={exportInfo} edlStale={edlStale} exporting={exporting}
          onStatus={onStatus} onTime={onTime} onSeek={seekSource}
          onSaveEdl={() => void saveEdl()} onExport={() => void exportNow()} onSaveOutput={(o) => void saveOutput(o)} saveState={saveState}
        />
      </div>

      {ready ? (
        <Timeline
          clips={approvedEdl.segments} selectedClip={selectedClipIndex >= 0 ? selectedClipIndex : null} onSelectClip={selectClip} onClipRange={clipRange} onRestoreGap={restoreGap}
          titles={style.titles ?? []} selectedTitle={selectedTitle} onSelectTitle={selectTitle} onTitleRange={titleRange} keyframes={manual.keyframes}
          onSplit={splitClip} onDeleteClip={deleteClip} disabled={manualDisabled}
          subtitleClips={subClips} subtitlesOn={style.captions} selectedSub={selectedSub} onSelectSub={selectSub} onSubtitleRange={subtitleRange} subtitleText={(c) => c.words.filter(wordVisible).map((w) => w.text).join(" ")}
          creativeRanges={creativeOn || style.creativeRanges ? creativeRanges : null} selectedCreative={selectedCreative} onSelectCreative={selectCreative} onCreativeRange={creativeRange}
          selectedCamera={selectedCam} onSelectCamera={selectCamera}
          waveform={waveform}
          sfxCues={sfxCues} creativeSfx={sfxUseCreative ? creativeSfx : []} sfxInfo={(sid) => sfxLib.items.find((x) => x.id === sid)} selectedSfx={selectedSfx}
          reel={clips} reelOrder={visibleOrder} onReorder={reorderVideos} onDropVideo={dropVideo} onSelectVideo={selectVideo}
          endClipSeconds={built?.props.endClip ? style.endClip?.seconds ?? 0 : 0} onSelectEndClip={openEndClip}
          onSelectSfx={(i) => { selectSfx(i); const c = sfxCues[i]; if (c) seekSource(c.at); }} onSfxMove={(i, at) => sfxPatch(i, { at })} onOpenSfx={() => selectSfx(null)} onCopyCreativeSfx={sfxCopyCreative}
          audioVolume={Number(style.params["audio.volume"] ?? 1)} audioMuted={style.params["audio.bisu"] === true} onOpenAudio={() => { setTab("manual"); setAudioFocus((n) => n + 1); }}
          onAutoSubtitle={autoSubtitle} onAddSubtitle={addSubtitle} onRegenerateSubtitle={() => void regenerateSubtitle()} hasSubtitles={subClips.length > 0} subtitleStatus={transcribing && style.captions ? (hasTranscript ? "Membuat subtitle baru dari klip sekarang…" : "Membuat transkrip…") : null}
          ref={timelineRef}
          expanded={timelineExpanded} onExpand={() => setTimelineExpanded(!timelineExpanded)}
          duration={duration} fps={fps} frameSegs={frameSegs}
          suggestions={suggestions}
          camera={built?.props.camera ?? []} requests={style.cameraOverrides} pages={built?.props.pages ?? []}
          selectedId={selectedId} playing={playing}
          onSelect={(sid) => setSelectedId(sid)} onSeek={seekSource}
          onScrubStart={() => playerRef.current?.pause()}
        />
      ) : (
        <div className={s.tl}><div className={s.empty}>Timeline muncul setelah video selesai diproses.</div></div>
      )}
      <footer className={s.statusBar}><span><i className={s.statusDot}/>{approvedCount} cut AI disetujui · {manual.cuts.length} cut manual · {pendingCount} menunggu</span><span>Spasi: putar · S: split · Del: hapus klip · Ctrl Z: undo · Roda: geser · Shift+roda: naik/turun · Ctrl+roda: zoom</span><span>{Math.round(fps)} FPS · {style.aspect}</span></footer>
    </div>
  );
}
