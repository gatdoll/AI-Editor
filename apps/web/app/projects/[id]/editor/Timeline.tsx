"use client";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { SuggestionRow } from "@app/shared";
import type { CamMove } from "@app/remotion/src/camera-plan.ts";
import type { CaptionPage } from "@app/remotion/src/captions.ts";
import type { SubtitleClip } from "@app/shared/subtitles";
import type { CameraRequest } from "@app/remotion/src/build-props.ts";
import type { FrameSegment } from "@app/remotion/src/frames.ts";
import { assignLanes, clampZoom, outputToSource, rulerTicks, sourceToOutput, xToTime } from "@app/remotion/src/timeline.ts";
import { totalFrames } from "@app/remotion/src/frames.ts";
import { extendLimits } from "@app/shared/manual";
import { KIND_COLOR, KIND_LABEL, PRESET_LABEL, fmtTime } from "./kinds";
import s from "./editor.module.css";
import { Icon } from "../../../components/Icon";
import { EditableBlock } from "./EditableBlock";
import { WaveformLane, type Waveform } from "./WaveformLane";
import type { Interval } from "@app/shared/edl";
import type { MotionTitle } from "@app/remotion/src/title-plan.ts";
import type { ManualEdit } from "@app/shared/manual";
import { MANUAL } from "@app/config";
import type { SfxCue, SfxItem } from "@app/shared/sfx";
import { reelEnd, type ReelClip } from "@app/shared/reel";

/** Fase 16: tipe data seret dari panel Media ke timeline. */
export const REEL_DRAG_TYPE = "application/x-editing-video-reel";

export type TimelineHandle = { setPlayhead: (srcSeconds: number) => void; /** Waktu HASIL; dipakai di klip akhir yang tidak punya waktu sumber. */ setPlayheadOut: (outSeconds: number) => void };

const ROW_VIDEO = 46;
const LANE_H = 24;
const ROW_CAM = 36;
const ROW_SUB = 36;
const ROW_AUDIO = 44;
const ROW_FILES = 26;
const GUTTER = 40; // ruang kosong di ujung kanan

/**
 * Timeline dalam WAKTU HASIL (Fase 10), seperti CapCut: klip rapat tanpa celah, hapus/trim langsung merapatkan.
 * Semua data tetap dalam waktu video mentah; komponen ini hanya memetakan saat menggambar dan saat pengguna mengedit.
 * Props `onSeek`/`setPlayhead` tetap dalam waktu mentah.
 */
type Props = {
  clips: Interval[];
  selectedClip: number | null;
  onSelectClip: (i: number) => void;
  /** Rentang baru klip dalam waktu mentah: lebih sempit = trim, lebih lebar = memulihkan bagian terpotong. */
  onClipRange: (clip: Interval, start: number, end: number) => void;
  /** Pulihkan seluruh bagian terpotong di satu sambungan (waktu mentah). */
  onRestoreGap: (gap: Interval) => void;
  titles: MotionTitle[];
  selectedTitle: number | null;
  onSelectTitle: (i: number) => void;
  onTitleRange: (i: number, start: number, end: number) => void;
  keyframes: ManualEdit["keyframes"];
  onSplit: () => void; onDeleteClip: () => void; disabled: boolean;
  expanded: boolean;
  onExpand: () => void;
  duration: number;
  fps: number;
  frameSegs: FrameSegment[];
  suggestions: SuggestionRow[];
  camera: CamMove[];
  requests: CameraRequest[];
  pages: CaptionPage[];
  selectedId: string | null;
  playing: boolean;
  onSelect: (id: string | null) => void;
  onSeek: (srcSeconds: number) => void;
  onScrubStart: () => void;
  /** Klip subtitle (waktu mentah): yang tersimpan, atau subtitle otomatis yang akan dibekukan saat diedit. */
  subtitleClips: SubtitleClip[];
  subtitlesOn: boolean;
  selectedSub: string | null;
  onSelectSub: (id: string, focus?: boolean) => void;
  /** moved = digeser utuh (bukan trim). Waktu mentah. */
  onSubtitleRange: (id: string, start: number, end: number, moved: boolean) => void;
  subtitleText: (c: SubtitleClip) => string;
  /** Rentang lapisan kreatif (waktu mentah). null = Mode Kreatif tidak aktif (track disembunyikan). */
  creativeRanges: Interval[] | null;
  selectedCreative: number | null;
  onSelectCreative: (i: number) => void;
  onCreativeRange: (i: number, start: number, end: number) => void;
  /** Gerakan kamera terpilih (indeks di `camera`). */
  selectedCamera: number | null;
  onSelectCamera: (i: number) => void;
  /** Fase 12: subtitle otomatis dari ucapan, atau subtitle buatan sendiri di playhead. */
  onAutoSubtitle: () => void;
  onAddSubtitle: () => void;
  /** Transkrip baru dari klip sekarang, subtitle lama diganti (seperti generate ulang di CapCut). */
  onRegenerateSubtitle: () => void;
  hasSubtitles: boolean;
  subtitleStatus: string | null;
  /** Gelombang audio video mentah (null = sedang dimuat). */
  waveform: Waveform | null;
  /** Fase 14: SFX edit (waktu mentah) dan SFX versi kreatif (waktu hasil, hanya dibaca). */
  sfxCues: SfxCue[];
  creativeSfx: SfxCue[];
  sfxInfo: (id: string) => SfxItem | undefined;
  selectedSfx: number | null;
  onSelectSfx: (i: number) => void;
  /** Waktu mentah baru untuk SFX edit ke-i. */
  onSfxMove: (i: number, srcAt: number) => void;
  /** Buka panel SFX (pustaka) untuk menambah di playhead. */
  onOpenSfx: () => void;
  onCopyCreativeSfx: () => void;
  /** Volume audio sumber (pengali), bisu, dan pembuka pengaturan Audio (Manual → Audio). */
  audioVolume?: number; audioMuted?: boolean; onOpenAudio?: () => void;
  /** Fase 16: video project (sumbu reel) dan urutan tampil video yang terlihat. */
  reel: ReelClip[];
  reelOrder: string[];
  /** Urutan baru video (id). */
  onReorder: (ids: string[]) => void;
  /** Video diseret dari panel Media ke posisi `index` (di antara video yang terlihat). */
  onDropVideo: (id: string, index: number) => void;
  onSelectVideo: (id: string) => void;
  /** Fase 18: panjang klip akhir (detik), digambar sesudah video. */
  endClipSeconds?: number;
  onSelectEndClip?: () => void;
};

export const Timeline = memo(
  forwardRef<TimelineHandle, Props>(function Timeline(
    { clips, selectedClip, onSelectClip, onClipRange, onRestoreGap, titles, selectedTitle, onSelectTitle, onTitleRange, keyframes, onSplit, onDeleteClip, disabled, expanded, onExpand, duration: sourceDuration, fps, frameSegs, suggestions, camera, requests, pages, selectedId, playing, onSelect, onSeek, onScrubStart, subtitleClips, subtitlesOn, selectedSub, onSelectSub, onSubtitleRange, subtitleText, creativeRanges, selectedCreative, onSelectCreative, onCreativeRange, selectedCamera, onSelectCamera, onAutoSubtitle, onAddSubtitle, onRegenerateSubtitle, hasSubtitles, subtitleStatus, waveform, sfxCues, creativeSfx, sfxInfo, selectedSfx, onSelectSfx, onSfxMove, onOpenSfx, onCopyCreativeSfx, audioVolume = 1, audioMuted = false, onOpenAudio,reel, reelOrder, onReorder, onDropVideo, onSelectVideo, endClipSeconds = 0, onSelectEndClip },
    ref,
  ) {
    // Panjang dan pemetaan timeline hasil. `duration` di bawah = durasi HASIL (yang tampil).
    const duration = useMemo(() => (frameSegs.length ? totalFrames(frameSegs) / fps : sourceDuration), [frameSegs, fps, sourceDuration]);
    const toOut = useCallback((t: number) => (frameSegs.length ? sourceToOutput(frameSegs, fps, t).out : t), [frameSegs, fps]);
    const toSrc = useCallback((t: number) => (frameSegs.length ? outputToSource(frameSegs, fps, t) : t), [frameSegs, fps]);
    const toSrcRef = useRef(toSrc);
    toSrcRef.current = toSrc;
    const scrollRef = useRef<HTMLDivElement>(null);
    const labelsRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLDivElement>(null);
    const headTime = useRef(0);
    const scrub = useRef<{ pointerId: number; clientX: number; offset: number; original: number; lastFrame: number; lastSeekAt: number } | null>(null);
    const scrubRaf = useRef<number | null>(null);
    const seekRef = useRef(onSeek);
    seekRef.current = onSeek;
    const [scrubbing, setScrubbing] = useState(false);
    const [viewport, setViewport] = useState(800);
    const [pps, setPps] = useState(0); // 0 = belum diinisialisasi (muat seluruh video)
    const playingRef = useRef(playing);
    playingRef.current = playing;

    // ukuran area gulir
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const ro = new ResizeObserver(() => setViewport(el.clientWidth));
      ro.observe(el);
      setViewport(el.clientWidth);
      return () => ro.disconnect();
    }, []);

    // `duration` tetap panjang video (batas trim dan geser); klip akhir hanya menambah ruang tampilan sesudahnya
    const shownDuration = duration + endClipSeconds;
    const fit = useMemo(() => clampZoom((viewport - GUTTER) / Math.max(1, shownDuration), shownDuration, viewport - GUTTER), [viewport, shownDuration]);
    const z = pps || fit;
    const zRef = useRef(z);
    zRef.current = z;

    const placeHead = useCallback(() => {
      const el = playheadRef.current;
      if (!el) return;
      el.style.left = `${headTime.current * zRef.current}px`;
      el.setAttribute("aria-valuenow", String(Number(headTime.current.toFixed(3))));
      el.setAttribute("aria-valuetext", fmtTime(headTime.current));
      const sc = scrollRef.current;
      if (sc && playingRef.current && !scrub.current) {
        const x = headTime.current * zRef.current;
        if (x < sc.scrollLeft + 30 || x > sc.scrollLeft + sc.clientWidth - 60) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.3);
      }
    }, []);

    useImperativeHandle(ref, () => ({
      setPlayhead: (t: number) => { if (!scrub.current) { headTime.current = toOut(t); placeHead(); } },
      setPlayheadOut: (t: number) => { if (!scrub.current) { headTime.current = t; placeHead(); } },
    }), [placeHead, toOut]);
    useEffect(placeHead, [z, placeHead]);

    // The line follows every animation frame, but decoding is capped at 10 seeks/s.
    // Releasing always commits the exact final frame, without a trailing stale seek.
    const scrubAtPointer = () => {
      const active = scrub.current, inner = innerRef.current;
      if (!active || !inner) return;
      const time = Math.min(duration, Math.max(0, Math.round(((active.clientX - inner.getBoundingClientRect().left - active.offset) / zRef.current) * fps) / fps));
      const frame = Math.round(time * fps);
      const now = performance.now();
      if (frame !== active.lastFrame && now - active.lastSeekAt >= MANUAL.scrubIntervalMs) {
        active.lastFrame = frame; active.lastSeekAt = now; seekRef.current(toSrcRef.current(time));
      }
      headTime.current = time; placeHead();
    };
    const scrubTick = () => {
      const active = scrub.current, sc = scrollRef.current;
      if (!active || !sc) return;
      const rect = sc.getBoundingClientRect();
      const edge = 36;
      const speed = active.clientX < rect.left + edge ? -Math.min(18, (rect.left + edge - active.clientX) / 3)
        : active.clientX > rect.right - edge ? Math.min(18, (active.clientX - rect.right + edge) / 3) : 0;
      if (speed) sc.scrollLeft += speed;
      scrubAtPointer();
      scrubRaf.current = requestAnimationFrame(scrubTick);
    };
    const beginScrub = (e: React.PointerEvent<HTMLDivElement>, fromLine: boolean) => {
      if (e.button !== 0 || scrub.current) return;
      e.preventDefault(); e.stopPropagation();
      const inner = innerRef.current;
      if (!inner) return;
      scrub.current = { pointerId: e.pointerId, clientX: e.clientX, offset: fromLine ? e.clientX - inner.getBoundingClientRect().left - headTime.current * zRef.current : 0, original: headTime.current, lastFrame: -1, lastSeekAt: -Infinity };
      e.currentTarget.setPointerCapture(e.pointerId);
      playheadRef.current?.focus({ preventScroll: true });
      onScrubStart(); setScrubbing(true); scrubAtPointer();
      scrubRaf.current = requestAnimationFrame(scrubTick);
    };
    const moveScrub = (e: React.PointerEvent<HTMLDivElement>) => {
      if (scrub.current?.pointerId !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation(); scrub.current.clientX = e.clientX;
    };
    const endScrub = (e: React.PointerEvent<HTMLDivElement>, cancel = false) => {
      const active = scrub.current;
      if (!active || active.pointerId !== e.pointerId) return;
      e.stopPropagation();
      if (scrubRaf.current !== null) cancelAnimationFrame(scrubRaf.current);
      scrubRaf.current = null;
      active.clientX = e.clientX;
      if (!cancel) scrubAtPointer();
      const finalTime = cancel ? active.original : headTime.current;
      scrub.current = null; setScrubbing(false);
      seekRef.current(toSrcRef.current(finalTime));
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };
    useEffect(() => () => { if (scrubRaf.current !== null) cancelAnimationFrame(scrubRaf.current); scrub.current = null; }, []);

    // ctrl + roda = zoom, berpusat pada kursor
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) {
          // Seperti CapCut/Premiere: roda = geser kiri/kanan, Shift + roda = naik/turun antar track.
          // Gerakan horizontal trackpad (deltaX) dibiarkan ke browser.
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
          e.preventDefault();
          const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY;
          if (e.shiftKey) el.scrollTop += px; else el.scrollLeft += px;
          return;
        }
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const anchor = (e.clientX - rect.left + el.scrollLeft) / zRef.current;
        const next = clampZoom(zRef.current * (e.deltaY < 0 ? 1.2 : 1 / 1.2), duration, viewport - GUTTER);
        setPps(next);
        requestAnimationFrame(() => { el.scrollLeft = anchor * next - (e.clientX - rect.left); });
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, [duration, viewport]);

    // ------------------------------------------------------------- jalur usulan
    const { lanes, laneCount } = useMemo(
      () => assignLanes(suggestions.map((x) => ({ id: x.id, start: toOut(Number(x.start_s)), end: toOut(Number(x.end_s)) })), 3 / z),
      [suggestions, z, toOut],
    );
    const sugH = Math.max(1, laneCount) * LANE_H + 8;
    // Semua posisi di bawah dalam waktu hasil
    const clipViews = useMemo(() => clips.map((clip) => {
      // Fase 16: ujung klip dihitung dari panjangnya (waktu akhir bisa jatuh di video lain yang urutannya berbeda)
      const a = toOut(clip.start), b = a + (clip.end - clip.start);
      const f = reel.find((r) => (clip.start + clip.end) / 2 >= r.offset && (clip.start + clip.end) / 2 <= reelEnd(r));
      const lim = extendLimits(clips, clip, sourceDuration, f ? { start: f.offset, end: reelEnd(f) } : undefined);
      // Tepi boleh ditarik ke luar sejauh bagian terpotong yang bisa dipulihkan (sampai klip tetangga di video mentah)
      return { clip, a, b, minA: a - (clip.start - lim.minStart), maxB: b + (lim.maxEnd - clip.end) };
    }), [clips, toOut, sourceDuration, reel]);
    // Bagian terpotong per sambungan (waktu mentah) dan posisinya di timeline hasil
    const fileOf = useCallback((t: number) => reel.find((r) => t >= r.offset - 1e-6 && t <= reelEnd(r) + 1e-6), [reel]);
    const gaps = useMemo(() => {
      const out: Array<{ gap: Interval; x: number }> = [];
      // Fase 16: per video. Tanpa reel (data lama) seluruh sumber dianggap satu video.
      const files = reel.length ? reel : [{ id: "_", offset: 0, duration: sourceDuration }];
      for (const f of files) {
        const views = clipViews.filter((v) => v.clip.start >= f.offset - 1e-6 && v.clip.end <= reelEnd(f) + 1e-6).sort((a, b) => a.clip.start - b.clip.start);
        if (!views.length) continue;
        let prevEnd = f.offset;
        for (const v of views) {
          if (v.clip.start - prevEnd > 1 / fps) out.push({ gap: { start: prevEnd, end: v.clip.start }, x: v.a });
          prevEnd = v.clip.end;
        }
        const last = views[views.length - 1];
        if (reelEnd(f) - last.clip.end > 1 / fps) out.push({ gap: { start: last.clip.end, end: reelEnd(f) }, x: last.b });
      }
      return out;
    }, [clipViews, reel, fps, sourceDuration]);
    // Blok per video (waktu hasil) untuk strip urutan: rentang dari klip pertama sampai terakhir video itu
    const fileBlocks = useMemo(() => reelOrder.flatMap((id) => {
      const f = reel.find((r) => r.id === id);
      if (!f) return [];
      const views = clipViews.filter((v) => fileOf((v.clip.start + v.clip.end) / 2)?.id === id);
      if (!views.length) return [];
      return [{ id, label: f.label ?? "video", a: Math.min(...views.map((v) => v.a)), b: Math.max(...views.map((v) => v.b)) }];
    }), [reelOrder, reel, clipViews, fileOf]);
    const [dragFile, setDragFile] = useState<{ id: string; x0: number; dx: number; pointerId: number } | null>(null);
    const [dropAt, setDropAt] = useState<number | null>(null);
    /** Posisi sisip (indeks di antara blok video) untuk x piksel pada timeline. */
    const insertIndex = (x: number, skip?: string) => {
      const others = fileBlocks.filter((f) => f.id !== skip);
      const i = others.findIndex((f) => x < ((f.a + f.b) / 2) * z);
      return i < 0 ? others.length : i;
    };
    const finishFileDrag = (e: React.PointerEvent) => {
      const d = dragFile;
      if (!d || d.pointerId !== e.pointerId) return;
      setDragFile(null);
      if (Math.abs(d.dx) < 4) { onSelectVideo(d.id); return; }
      const block = fileBlocks.find((f) => f.id === d.id)!;
      const idx = insertIndex(((block.a + block.b) / 2) * z + d.dx, d.id);
      const ids = fileBlocks.map((f) => f.id).filter((id) => id !== d.id);
      ids.splice(idx, 0, d.id);
      if (ids.join() !== fileBlocks.map((f) => f.id).join()) onReorder(ids);
    };
    const titleViews = useMemo(() => titles.map((t) => ({ a: toOut(t.startS), b: Math.max(toOut(t.startS) + 1 / fps, toOut(t.endS)) })), [titles, toOut, fps]);
    const titleLanes = useMemo(() => assignLanes(titleViews.map((t, i) => ({ id: String(i), start: t.a, end: t.b })), 3 / z), [titleViews, z]);
    const titleH = Math.max(1, titleLanes.laneCount) * ROW_VIDEO;
    const anchors = [...clipViews.flatMap((c) => [c.a, c.b]), ...titleViews.flatMap((t) => [t.a, t.b]), headTime.current];

    // kamera dan subtitle: timeline hasil -> waktu sumber
    const camBlocks = useMemo(
      () =>
        camera.map((m, i) => {
          const sa = toSrc(m.start + 1e-6), sb = toSrc(m.end - 1e-6);
          const requested = requests.some((r) => r.startS < sb && r.endS > sa && r.preset === m.preset);
          // Gerakan yang dihapus pengguna menjadi kamera diam (from = to)
          const still = m.from.scale === m.to.scale && m.from.x === m.to.x && m.from.y === m.to.y && m.from.rot === m.to.rot;
          return { i, a: m.start, b: m.end, preset: m.preset, requested, still };
        }),
      [camera, toSrc, requests],
    );
    // Klip subtitle dan rentang kreatif di timeline hasil. Klip yang seluruhnya terpotong tidak tampil.
    const subViews = useMemo(
      // Tanpa kata yang terlihat = tidak tampil di video (sama dengan render), jadi tidak ditampilkan juga
      () => subtitleClips.flatMap((c) => { const a = toOut(c.start), b = toOut(c.end), text = subtitleText(c); return b - a >= 1 / fps && text ? [{ c, a, b, text }] : []; }),
      [subtitleClips, toOut, fps, subtitleText],
    );
    const creativeViews = useMemo(
      () => (creativeRanges ?? []).map((r, i) => ({ i, r, a: toOut(r.start), b: toOut(r.end) })).filter((v) => v.b - v.a >= 1 / fps),
      [creativeRanges, toOut, fps],
    );

    // SFX: kotak sepanjang durasi suaranya. SFX edit di bagian yang dipotong tidak berbunyi, jadi tidak tampil.
    const sfxLen = useCallback((id: string) => Math.max(0.15, sfxInfo(id)?.durationS || 0.5), [sfxInfo]);
    const sfxViews = useMemo(() => sfxCues.flatMap((c, i) => {
      const m = frameSegs.length ? sourceToOutput(frameSegs, fps, c.at) : { out: c.at, inCut: false };
      return m.inCut ? [] : [{ i, c, a: m.out, b: Math.min(duration, m.out + sfxLen(c.id)) }];
    }), [sfxCues, frameSegs, fps, duration, sfxLen]);
    const hiddenSfx = sfxCues.length - sfxViews.length;

    const ticks = useMemo(() => rulerTicks(shownDuration, z), [shownDuration, z]);
    const width = shownDuration * z + GUTTER;

    const seekFromEvent = (e: React.MouseEvent) => {
      const rect = innerRef.current!.getBoundingClientRect();
      onSeek(toSrc(Math.min(duration, Math.max(0, xToTime(e.clientX - rect.left, z)))));
    };

    const multi = reel.length > 1;
    const rows: Array<{ label: string; h: number }> = [
      ...(multi ? [{ label: "Urutan", h: ROW_FILES }] : []),
      { label: "Video", h: ROW_VIDEO },
      { label: "Audio", h: ROW_AUDIO },
      { label: "SFX", h: ROW_SUB },
      { label: "Teks", h: titleH },
      { label: "Keyframe", h: ROW_CAM },
      { label: "Usulan", h: sugH },
      { label: "Kamera", h: ROW_CAM },
      { label: "Subtitle", h: ROW_SUB },
      ...(creativeRanges ? [{ label: "Kreatif", h: ROW_SUB }] : []),
    ];

    return (
      <div className={s.tl}>
        <div className={s.tlBar}>
          <Icon name="film" size={14}/><b>Timeline</b>
          <button className={s.iconBtn} onClick={onExpand} aria-label="Perluas timeline" aria-pressed={expanded} title="Perluas / ringkas timeline"><Icon name="expand" size={13}/></button>
          <button className={s.mini} onClick={onSplit} disabled={disabled} title="Split di playhead (S)">✂ Split</button>
          <button className={s.mini} onClick={onDeleteClip} disabled={disabled || selectedClip === null} title="Hapus klip terpilih (Delete)">Hapus klip</button>
          {hasSubtitles
            ? <button className={s.mini} onClick={onRegenerateSubtitle} disabled={disabled || !!subtitleStatus} title="Buat subtitle baru dari klip yang sekarang. Subtitle lama dan editannya diganti (bisa Undo).">↻ Generate ulang subtitle</button>
            : <button className={s.mini} onClick={onAutoSubtitle} disabled={disabled || !!subtitleStatus} title="Buat subtitle dari ucapan di klip yang dipertahankan">✦ Auto subtitle</button>}
          <button className={s.mini} onClick={onAddSubtitle} disabled={disabled} title="Tulis subtitle sendiri di posisi playhead">＋ Subtitle</button>
          <button className={s.mini} onClick={onOpenSfx} disabled={disabled} title="Efek suara: pilih dari pustaka lalu tambahkan di playhead">♪ SFX</button>
          {subtitleStatus && <span className={s.muted}><span className={s.spin} /> {subtitleStatus}</span>}
          <span className={s.muted}>
            {fmtTime(duration)} · {suggestions.length} usulan
          </span>
          <span className={s.spacer} />
          <button className={s.mini} onClick={() => { setPps(0); scrollRef.current && (scrollRef.current.scrollLeft = 0); }} title="Muat seluruh video">Pas layar</button>
          <button className={s.mini} onClick={() => setPps(clampZoom(z / 1.4, duration, viewport - GUTTER))} aria-label="Perkecil">−</button>
          <input
            type="range" min={Math.log(fit)} max={Math.log(400)} step={0.01} value={Math.log(z)}
            onChange={(e) => setPps(clampZoom(Math.exp(Number(e.target.value)), duration, viewport - GUTTER))}
            style={{ width: 110 }} aria-label="Zoom timeline"
          />
          <button className={s.mini} onClick={() => setPps(clampZoom(z * 1.4, duration, viewport - GUTTER))} aria-label="Perbesar">+</button>
          <span className={s.muted} style={{ width: 70, textAlign: "right" }}>{z.toFixed(z < 10 ? 1 : 0)} px/dtk</span>
        </div>
        <div className={s.tlBody}>
          <div className={s.tlLabels} ref={labelsRef}>
            {rows.map((r) => r.label === "Audio" && onOpenAudio
              ? <button key={r.label} type="button" className={`${s.tlLabel} ${s.tlLabelBtn}`} style={{ height: r.h }} onClick={onOpenAudio} title="Atur volume, bisu, fade, dan reduksi noise audio sumber">Audio <small>{audioMuted ? "bisu" : `${Math.round(audioVolume * 100)}%`}</small></button>
              : <div key={r.label} className={s.tlLabel} style={{ height: r.h }}>{r.label}</div>)}
          </div>
          <div className={s.tlScroll} ref={scrollRef} onScroll={(e) => { if (labelsRef.current) labelsRef.current.scrollTop = e.currentTarget.scrollTop; }}>
            <div className={s.tlInner} ref={innerRef} style={{ width }}>
              <div className={s.ruler} data-testid="timeline-ruler" title="Drag untuk menggeser playhead" onPointerDown={(e) => beginScrub(e, false)} onPointerMove={moveScrub} onPointerUp={(e) => endScrub(e)} onPointerCancel={(e) => endScrub(e, true)} onLostPointerCapture={(e) => endScrub(e, true)}>
                {ticks.map((t) => (
                  <div key={t.t} className={`${s.tick} ${t.major ? s.major : ""}`} style={{ left: t.t * z, top: t.major ? 0 : 14 }}>
                    {t.label && <span className={s.tickLabel}>{t.label}</span>}
                  </div>
                ))}
              </div>

              {/* Fase 16: urutan video. Seret blok untuk menukar urutan; seret video dari panel Media untuk menaruhnya di sini. */}
              {multi && (
                <div className={`${s.lane} ${s.fileLane}`} style={{ height: ROW_FILES }}
                  onDragOver={(e) => { if (![...e.dataTransfer.types].includes(REEL_DRAG_TYPE)) return; e.preventDefault(); const r = innerRef.current!.getBoundingClientRect(); setDropAt(insertIndex(e.clientX - r.left)); }}
                  onDragLeave={() => setDropAt(null)}
                  onDrop={(e) => { const id = e.dataTransfer.getData(REEL_DRAG_TYPE); setDropAt(null); if (!id) return; e.preventDefault(); const r = innerRef.current!.getBoundingClientRect(); onDropVideo(id, insertIndex(e.clientX - r.left, id)); }}>
                  {fileBlocks.map((f, i) => (
                    <div key={f.id} role="button" tabIndex={0} className={`${s.fileBlock} ${dragFile?.id === f.id ? s.fileDragging : ""}`}
                      style={{ left: f.a * z + (dragFile?.id === f.id ? dragFile.dx : 0), width: Math.max(14, (f.b - f.a) * z - 2) }}
                      title={`${f.label} · video ${i + 1} dari ${fileBlocks.length}. Seret untuk mengubah urutan.`}
                      aria-label={`Video ${i + 1}: ${f.label}. Seret atau pakai tombol panah kiri/kanan untuk mengubah urutan.`}
                      onPointerDown={(e) => { if (disabled || e.button !== 0) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setDragFile({ id: f.id, x0: e.clientX, dx: 0, pointerId: e.pointerId }); }}
                      onPointerMove={(e) => { if (dragFile?.pointerId === e.pointerId) setDragFile({ ...dragFile, dx: e.clientX - dragFile.x0 }); }}
                      onPointerUp={finishFileDrag}
                      onPointerCancel={() => setDragFile(null)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (disabled || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
                        e.preventDefault(); e.stopPropagation();
                        const ids = fileBlocks.map((x) => x.id), j = i + (e.key === "ArrowRight" ? 1 : -1);
                        if (j < 0 || j >= ids.length) return;
                        [ids[i], ids[j]] = [ids[j], ids[i]];
                        onReorder(ids);
                      }}>
                      <span className={s.fileNum}>{i + 1}</span>{(f.b - f.a) * z > 60 ? f.label : ""}
                    </div>
                  ))}
                  {dropAt !== null && <div className={s.dropMark} style={{ left: (dropAt < fileBlocks.length ? fileBlocks[dropAt].a : fileBlocks.at(-1)?.b ?? 0) * z }} />}
                </div>
              )}

              {/* video: klip rapat (waktu hasil). Tarik tepi ke dalam = trim, ke luar = munculkan bagian terpotong. */}
              <div className={s.lane} style={{ height: ROW_VIDEO }} onClick={seekFromEvent}
                onDragOver={(e) => { if ([...e.dataTransfer.types].includes(REEL_DRAG_TYPE)) e.preventDefault(); }}
                onDrop={(e) => { const id = e.dataTransfer.getData(REEL_DRAG_TYPE); if (!id) return; e.preventDefault(); const r = innerRef.current!.getBoundingClientRect(); onDropVideo(id, insertIndex(e.clientX - r.left, id)); }}>
                {clipViews.map((v, i) => <EditableBlock key={`${v.clip.start}-${v.clip.end}`} start={v.a} end={v.b} minStart={v.minA} maxEnd={v.maxB} pps={z} fps={fps} duration={duration} label={`Klip ${i + 1}`} selected={selectedClip === i} onSelect={() => onSelectClip(i)} onCommit={(a, b) => onClipRange(v.clip, v.clip.start + (a - v.a), v.clip.end + (b - v.b))} anchors={anchors} disabled={disabled}/>)}
                {endClipSeconds > 0 && (
                  <button className={s.creativeBlock} title="Klip motion di akhir video. Klik untuk melihat dan mengubahnya." aria-label={`Klip akhir ${endClipSeconds} detik`}
                    style={{ position: "absolute", left: duration * z, width: Math.max(14, endClipSeconds * z - 2), top: 4, height: ROW_VIDEO - 8, borderWidth: 1, borderStyle: "solid", borderRadius: 4, color: "var(--text)", fontSize: 11, overflow: "hidden", whiteSpace: "nowrap", cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); onSelectEndClip?.(); }}>
                    ✦ Klip akhir · {endClipSeconds}s
                  </button>
                )}
                {gaps.map((g) => (
                  <button key={`${g.gap.start}-${g.gap.end}`} className={s.gapMark} style={{ left: g.x * z }} disabled={disabled}
                    title={`${(g.gap.end - g.gap.start).toFixed(1)} dtk terpotong di sini (${fmtTime(g.gap.start)}–${fmtTime(g.gap.end)} video mentah). Klik untuk memulihkan semuanya, atau tarik tepi klip ke luar untuk sebagian.`}
                    aria-label={`Pulihkan ${(g.gap.end - g.gap.start).toFixed(1)} detik yang terpotong`}
                    onClick={(e) => { e.stopPropagation(); onRestoreGap(g.gap); }}>
                    {(g.gap.end - g.gap.start).toFixed(1)}s
                  </button>
                ))}
              </div>

              <WaveformLane scrollRef={scrollRef} pps={z} duration={duration} frameSegs={frameSegs} fps={fps} wave={waveform} height={ROW_AUDIO} onClick={seekFromEvent} gain={audioMuted ? 0 : audioVolume} />

              {/* SFX (Fase 14): kotak edit bisa digeser; garis putus-putus = dari Mode Kreatif (salin ke edit untuk mengubah) */}
              <div className={s.lane} style={{ height: ROW_SUB }} onClick={seekFromEvent}>
                {creativeSfx.map((c, k) => { const a = Math.min(duration, c.at), b = Math.min(duration, c.at + sfxLen(c.id)); return (
                  <button key={`k${k}-${c.at}`} className={s.sfxCreative} style={{ left: a * z, width: Math.max(8, (b - a) * z) }}
                    title={`${sfxInfo(c.id)?.name ?? c.id} · Mode Kreatif · ${fmtTime(a)}. Klik untuk menyalin semua SFX kreatif ke edit agar bisa digeser.`}
                    onClick={(e) => { e.stopPropagation(); onCopyCreativeSfx(); }} disabled={disabled}>✦ {sfxInfo(c.id)?.name ?? c.id}</button>); })}
                {sfxViews.map((v) => <EditableBlock key={`${v.i}-${v.c.at}-${v.c.id}`} start={v.a} end={v.b} pps={z} fps={fps} duration={duration} label={sfxInfo(v.c.id)?.name ?? v.c.id} icon="♪ " className={s.sfxBlock} top={5}
                  selected={selectedSfx === v.i} onSelect={() => onSelectSfx(v.i)} movable fixedLength disabled={disabled} anchors={anchors.filter((x) => x !== v.a && x !== v.b)}
                  onCommit={(a) => onSfxMove(v.i, toSrc(a))}/>)}
                {!sfxViews.length && !creativeSfx.length
                  ? <span className={s.trackActions}><button className={s.mini} disabled={disabled} onClick={(e) => { e.stopPropagation(); onOpenSfx(); }} title="Pilih efek suara dan tambahkan di playhead">＋ SFX</button>{hiddenSfx > 0 && <span className={s.muted}>{hiddenSfx} SFX di bagian terpotong</span>}</span>
                  : hiddenSfx > 0 && <span className={s.trackHint} style={{ position: "absolute", right: 6, top: 0 }}>{hiddenSfx} SFX di bagian terpotong</span>}
              </div>

              <div className={s.lane} style={{ height: titleH }} onClick={seekFromEvent}>
                {titles.map((title, i) => <EditableBlock key={`${i}-${title.startS}-${title.endS}`} start={titleViews[i].a} end={titleViews[i].b} pps={z} fps={fps} duration={duration} label={title.text} selected={selectedTitle === i} onSelect={() => onSelectTitle(i)} onCommit={(a, b) => onTitleRange(i, toSrc(a), toSrc(b - 1e-6) + 1e-6)} anchors={anchors.filter((a) => a !== titleViews[i].a && a !== titleViews[i].b)} movable disabled={disabled} top={5 + (titleLanes.lanes.get(String(i)) ?? 0) * ROW_VIDEO}/>)}
                {!titles.length && <span className={s.trackHint}>Manual → Teks → ＋ Teks</span>}
              </div>
              <div className={s.lane} style={{ height: ROW_CAM }} onClick={seekFromEvent}>{keyframes.map((k, i) => <button key={i} className={s.keyframeDot} style={{ left: toOut(k.time) * z }} aria-label={`Keyframe pada ${k.time.toFixed(2)} detik`} title={`${k.scale}× · ${k.rotation}°`} onClick={(e) => { e.stopPropagation(); onSeek(k.time); }}>◆</button>)}{!keyframes.length && <span className={s.trackHint}>Manual → Gambar → Simpan keyframe</span>}</div>

              {/* usulan */}
              <div className={s.lane} style={{ height: sugH }} onClick={seekFromEvent}>
                {suggestions.map((x) => {
                  const st = Number(x.start_s), en = Number(x.end_s);
                  // Usulan yang sudah diterapkan berada di bagian terpotong: tampil sebagai penanda tipis di sambungan
                  const vs = toOut(st), ve = toOut(en);
                  const cls = [s.blk, x.status === "pending" && x.kind !== "unclear" ? s.blkPending : "", x.status === "rejected" ? s.blkRejected : "", x.status === "approved" ? s.blkApproved : "", x.id === selectedId ? s.sel : ""].join(" ");
                  return (
                    <div
                      key={x.id}
                      role="button" tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelect(x.id); onSeek(Math.max(0, st - 0.5)); } }}
                      className={cls}
                      style={{ left: vs * z, width: Math.max(4, (ve - vs) * z), top: 4 + (lanes.get(x.id) ?? 0) * LANE_H, height: LANE_H - 3, backgroundColor: `color-mix(in srgb, ${KIND_COLOR[x.kind]} 28%, var(--panel))`, borderColor: KIND_COLOR[x.kind] }}
                      title={`${KIND_LABEL[x.kind]} · ${fmtTime(st)}–${fmtTime(en)} · ${x.status === "approved" ? "disetujui" : x.status === "rejected" ? "ditolak" : "menunggu keputusan"}${x.quote ? ` · "${x.quote}"` : ""}`}
                      onClick={(e) => { e.stopPropagation(); onSelect(x.id); onSeek(Math.max(0, st - 0.5)); }}
                    >
                      {x.status === "approved" ? "✓ " : ""}{(ve - vs) * z > 50 ? KIND_LABEL[x.kind] : ""}
                    </div>
                  );
                })}
              </div>

              {/* kamera */}
              <div className={s.lane} style={{ height: ROW_CAM }} onClick={seekFromEvent}>
                {camBlocks.map((b) => (
                  <div key={b.i} role="button" tabIndex={0} aria-pressed={selectedCamera === b.i}
                    className={`${s.blk} ${s.camBlk} ${b.still ? s.camStill : ""} ${selectedCamera === b.i ? s.sel : ""}`}
                    style={{ left: b.a * z, width: Math.max(3, (b.b - b.a) * z - 1), top: 4, height: ROW_CAM - 8, background: b.still ? undefined : b.requested ? "var(--ui-accent-soft)" : "var(--ui-track-camera)" }}
                    title={b.still ? "Kamera diam (gerakan otomatis dihapus). Pilih lalu Kembalikan untuk memunculkan lagi." : `${PRESET_LABEL[b.preset] ?? b.preset}${b.requested ? " (permintaan Anda)" : ""} · klik untuk pilih, Delete untuk hapus`}
                    onClick={(e) => { e.stopPropagation(); onSelectCamera(b.i); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onSelectCamera(b.i); } }}>
                    {(b.b - b.a) * z > 52 ? (b.still ? "Diam" : `${b.requested ? "★ " : ""}${PRESET_LABEL[b.preset] ?? b.preset}`) : ""}
                  </div>
                ))}
              </div>

              {/* subtitle: klip mandiri. Klik pilih, klik dua kali edit teks, tarik tepi trim, tarik badan geser. */}
              <div className={`${s.lane} ${subtitlesOn ? "" : s.laneOff}`} style={{ height: ROW_SUB }} onClick={seekFromEvent} title={subtitlesOn ? undefined : "Subtitle sedang dimatikan (Gaya). Klip tetap bisa diedit."}>
                {subViews.map((v) => <EditableBlock key={`${v.c.id}-${v.c.start}-${v.c.end}`} start={v.a} end={v.b} pps={z} fps={fps} duration={duration} label={v.text} icon="≡ " className={s.subBlock} top={4}
                  selected={selectedSub === v.c.id} onSelect={() => onSelectSub(v.c.id)} onDoubleClick={() => onSelectSub(v.c.id, true)} movable disabled={disabled} anchors={anchors.filter((x) => x !== v.a && x !== v.b)}
                  onCommit={(a, b) => { const moved = Math.abs((b - a) - (v.b - v.a)) < 1e-6 && Math.abs(a - v.a) > 1e-6; onSubtitleRange(v.c.id, toSrc(a), toSrc(b - 1e-6) + 1e-6, moved); }}/>)}
                {!subViews.length && (subtitleStatus
                  ? <span className={s.trackHint}><span className={s.spin} /> {subtitleStatus}</span>
                  : <span className={s.trackActions}>
                      <button className={s.mini} disabled={disabled} onClick={(e) => { e.stopPropagation(); onAutoSubtitle(); }} title="Buat subtitle dari ucapan (transkrip dibuat bila belum ada)">✦ Auto subtitle</button>
                      <button className={s.mini} disabled={disabled} onClick={(e) => { e.stopPropagation(); onAddSubtitle(); }} title="Tulis subtitle sendiri di posisi playhead">＋ Subtitle</button>
                    </span>)}
              </div>

              {creativeRanges && (
                <div className={s.lane} style={{ height: ROW_SUB }} onClick={seekFromEvent}>
                  {creativeViews.map((v) => <EditableBlock key={`${v.i}-${v.r.start}-${v.r.end}`} start={v.a} end={v.b} pps={z} fps={fps} duration={duration} label="Lapisan kreatif" icon="✦ " className={s.creativeBlock} top={4}
                    selected={selectedCreative === v.i} onSelect={() => onSelectCreative(v.i)} movable disabled={disabled} anchors={anchors.filter((x) => x !== v.a && x !== v.b)}
                    onCommit={(a, b) => onCreativeRange(v.i, toSrc(a), toSrc(b - 1e-6) + 1e-6)}/>)}
                  {!creativeViews.length && <span className={s.trackHint}>Lapisan kreatif dimatikan di semua bagian</span>}
                </div>
              )}

              <div className={`${s.playhead} ${scrubbing ? s.playheadDragging : ""}`} ref={playheadRef} role="slider" tabIndex={0} aria-label="Garis penunjuk waktu" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={headTime.current} aria-orientation="horizontal" title="Tarik garis ini untuk mencari bagian video"
                onPointerDown={(e) => beginScrub(e, true)} onPointerMove={moveScrub} onPointerUp={(e) => endScrub(e)} onPointerCancel={(e) => endScrub(e, true)} onLostPointerCapture={(e) => endScrub(e, true)} onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
                  e.preventDefault(); e.stopPropagation(); onScrubStart();
                  const next = e.key === "Home" ? 0 : e.key === "End" ? duration : headTime.current + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1) / fps;
                  seekRef.current(toSrcRef.current(Math.min(duration, Math.max(0, next))));
                }}/>
            </div>
          </div>
        </div>
      </div>
    );
  }),
);
