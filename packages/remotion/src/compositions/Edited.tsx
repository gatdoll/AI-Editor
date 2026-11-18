import { MotionStage } from "../components/MotionStage.tsx";
import { TitleOverlays } from "../components/TitleOverlays.tsx";
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, useVideoConfig, useCurrentFrame } from "remotion";
import { FRAME } from "@app/config";
import type { EditedProps, VideoEdit } from "../edited-props.ts";
import { transformAt } from "../../../shared/src/manual.ts";
import { Camera } from "../components/Camera.tsx";
import { FxStage } from "../components/FxStage.tsx";
import { CreativeBehind, CreativeFontLoader, CreativeOverlay, CreativeVideo, creativeFonts, faceBlurAt, hasBehind, type CreativeErrorHandler } from "../creative/CreativeLayer.tsx";
import { coverBox, faceAt, type FaceSample } from "../../../shared/src/talent.ts";
import { safeAreaPx, type CreativeData } from "../creative/contract.ts";
import { Effects } from "../components/Effects.tsx";
import { Subtitles } from "../components/Subtitles.tsx";
import { SfxTrack } from "../components/SfxTrack.tsx";
import { toFrameSegments, type FrameSegment } from "../frames.ts";

type PreviewPlayback = { onVideoError?: (error: Error) => void; onCreativeError?: CreativeErrorHandler };

/** Fase 24: blur wajah di ruang video (ikut kamera dan transform manual). `px` per frame hasil dari kode AI (`faceBlur`). */
type PieceBlur = { px: (outFrame: number) => number; faces: { width: number; height: number; samples: FaceSample[] } };

const Piece = ({ seg, reelFrom, src, audioSrc, fadeFrames, focusX, focusY, edit, total, onVideoError, talent, blur }: { seg: FrameSegment; /** Frame reel awal segmen (keyframe memakai waktu reel). */ reelFrom: number; src: string; audioSrc?: string; fadeFrames: number; focusX: number; focusY: number; edit?: VideoEdit; total: number;
  /** Fase 24: lapisan talent transparan (bisu, tanpa audio). */ talent?: boolean; blur?: PieceBlur } & PreviewPlayback) => {
  // Titik fokus sekaligus poros skala: video yang diperbesar tetap menempel ke tepi canvas di ujung rentang geser
  // (fokus 0 = tepi kiri/atas video di tepi canvas, 1 = tepi kanan/bawah), jadi tidak pernah muncul celah kosong.
  const focus = `${focusX * 100}% ${focusY * 100}%`;
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const transform = edit ? transformAt(edit.keyframes, (reelFrom + frame) / fps, edit.transform) : undefined;
  const cssTransform = transform ? `translate(${transform.x}%, ${transform.y}%) rotate(${transform.rotation}deg) scale(${transform.scale * (edit?.flipX ? -1 : 1)}, ${transform.scale * (edit?.flipY ? -1 : 1)})` : undefined;
  // Blur wajah: kotak wajah pada waktu file ini, dipetakan seperti objectFit cover + fokus (sama dengan video di bawahnya)
  const blurPx = blur ? blur.px(seg.at + frame) : 0;
  const face = blurPx > 0.5 && blur ? faceAt(blur.faces.samples, (seg.srcFrom + frame) / fps) : null;
  const box = face && blur ? coverBox({ x: face.x - face.w * 0.18, y: face.y - face.h * 0.22, w: face.w * 1.36, h: face.h * 1.44 }, blur.faces, { width, height }, focusX, focusY) : null;
  // interpolate() butuh rentang naik ketat: butuh length > 2f. Segmen yang terlalu pendek tanpa fade.
  const f = Math.min(fadeFrames, Math.floor((seg.length - 1) / 2));
  // Fade hanya di sambungan, bukan di awal/akhir file mentah.
  const joinVolume = (frame: number) =>
    f <= 0
      ? 1
      : interpolate(
          frame,
          [0, f, seg.length - f, seg.length],
          [seg.atFileStart ? 1 : 0, 1, 1, seg.atFileEnd ? 1 : 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
  const volume = (frame: number) => {
    const out = seg.at + frame;
    const fadeIn = edit?.fadeIn ? Math.min(1, out / (edit.fadeIn * fps)) : 1;
    const fadeOut = edit?.fadeOut ? Math.min(1, Math.max(0, total - out - 1) / (edit.fadeOut * fps)) : 1;
    return joinVolume(frame) * (edit?.volume ?? 1) * fadeIn * fadeOut;
  };
  return (
    <>
      {/* Reduksi noise (Fase 11): audio diganti file hasil noisereduce, dipotong dengan frame yang sama dengan video */}
      {audioSrc && !talent && <Audio src={audioSrc} trimBefore={seg.srcFrom} trimAfter={seg.srcTo} muted={edit?.muted} volume={volume} />}
      <OffthreadVideo
        src={src}
        onError={onVideoError}
        trimBefore={seg.srcFrom}
        trimAfter={seg.srcTo}
        muted={talent || edit?.muted || !!audioSrc}
        volume={talent ? 0 : volume}
        transparent={talent || undefined}
        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: focus, transformOrigin: focus, ...(transform ? { transform: cssTransform, opacity: transform.opacity, filter: `brightness(${edit!.brightness}) contrast(${edit!.contrast}) saturate(${edit!.saturation})` } : {}) }}
      />
      {box && (
        <AbsoluteFill style={{ pointerEvents: "none", transformOrigin: focus, transform: cssTransform }}>
          <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: "50%", backdropFilter: `blur(${blurPx}px)`, WebkitBackdropFilter: `blur(${blurPx}px)` }} />
        </AbsoluteFill>
      )}
    </>
  );
};

/**
 * Video hasil edit. Urutan layer (bawah ke atas):
 *   1. Camera > video (segmen EDL)   : bergerak
 *      (FxStage: transisi sambungan, guncangan, dutch tilt; hanya video)
 *   2. Effects                       : gradient, vignette, grain (layar-tetap)
 *   3. Subtitles                     : layar-tetap, TIDAK ikut gerakan kamera (aturan 4)
 */
// The optional handler is supplied only by the editor. Server rendering still
// fails on unreadable media instead of silently exporting missing footage.
/** Fase 16: file yang memuat segmen ini (frame reel) dan posisi awalnya; tanpa `sources` = satu file. */
const sourceFor = (sources: EditedProps["sources"], seg: FrameSegment, fps: number) => {
  if (!sources?.length) return null;
  const mid = (seg.srcFrom + seg.srcTo) / 2;
  const s = sources.find((x) => mid >= Math.round(x.offset * fps) && mid < Math.round((x.offset + x.duration) * fps)) ?? sources[0];
  return { ...s, startFrame: Math.round(s.offset * fps) };
};

export const Edited = ({ endClip, onVideoError, onCreativeError, denoisedSrc, sources, talent, sfx, creative, fx, textFx, videoEdit, titles = [], motion, src, segments, sourceSeconds, fadeFrames, focusX, focusY = 0.5, aspect, style, textScale, textBottom, safeArea, captionAnim, camera, pages, showCamera, showCaptions, showEffects }: EditedProps & PreviewPlayback) => {
  const safe = safeArea !== false;
  const { fps } = useVideoConfig();
  const frames = toFrameSegments(segments, fps, sourceSeconds);
  const total = frames.reduce((n, f) => n + f.length, 0);
  const { width, height } = useVideoConfig();
  const creativeData: CreativeData | null = creative ? { width, height, fps, durationInFrames: total, aspect, words: creative.words, joins: frames.slice(1).map((f) => f.at / fps), colors: style.colors, fonts: creativeFonts(), safeArea: safeAreaPx(aspect, width, height, safe), ...(creative.assets?.length ? { assets: creative.assets } : {}), ...(creative.faces?.length ? { faces: creative.faces } : {}) } : null;
  // Fase 24: teks di belakang talent butuh lapisan talent transparan untuk SEMUA video; tanpa itu lapisan Behind tidak digambar
  const talentReady = !!sources?.length && sources.every((x) => !!x.talentSrc);
  const behind = talentReady && hasBehind(creative?.overlay);
  const blurFor = (id: string | undefined): PieceBlur | undefined => {
    const faces = id ? talent?.[id] : undefined;
    return faces && creative?.overlay ? { faces, px: (f) => faceBlurAt(creative.overlay, f, creativeData, creative.ranges, onCreativeError) } : undefined;
  };
  return (
    <AbsoluteFill style={{ backgroundColor: FRAME.background, overflow: "hidden" }}>
      <MotionStage design={motion} style={style}>
      <FxStage plan={fx} style={style}>
      <CreativeVideo code={creative?.video} data={creativeData!} ranges={creative?.ranges} onError={onCreativeError}>
      <Camera moves={camera} enabled={showCamera && camera.length > 0}>
        {frames.map((seg, i) => {
          // Fase 16: segmen memutar file videonya sendiri; frame sumber digeser ke waktu lokal file itu
          const s = sourceFor(sources, seg, fps);
          const local = s ? { ...seg, srcFrom: seg.srcFrom - s.startFrame, srcTo: seg.srcTo - s.startFrame } : seg;
          return <Sequence key={i} from={seg.at} durationInFrames={seg.length} layout="none"><Piece seg={local} reelFrom={seg.srcFrom} src={s?.src ?? src} audioSrc={s ? s.audioSrc : denoisedSrc} fadeFrames={fadeFrames} focusX={s?.focusX ?? focusX} focusY={focusY} edit={videoEdit} total={total} onVideoError={onVideoError} blur={behind ? undefined : blurFor(s?.id)} /></Sequence>;
        })}
        {/* Fase 24: teks di BELAKANG talent, lalu talent transparan (gerak sama persis) di atasnya. Blur wajah pindah ke talent. */}
        {behind && creativeData && <CreativeBehind code={creative?.overlay} data={creativeData} ranges={creative?.ranges} onError={onCreativeError} />}
        {/* AbsoluteFill: potongan memakai layout="none", jadi tanpa pembungkus ini video talent terdorong ke bawah layar */}
        {behind && <AbsoluteFill>{frames.map((seg, i) => {
          const s = sourceFor(sources, seg, fps);
          if (!s?.talentSrc) return null;
          const local = { ...seg, srcFrom: seg.srcFrom - s.startFrame, srcTo: seg.srcTo - s.startFrame };
          return <Sequence key={`t${i}`} from={seg.at} durationInFrames={seg.length} layout="none"><Piece talent seg={local} reelFrom={seg.srcFrom} src={s.talentSrc} fadeFrames={0} focusX={s.focusX ?? focusX} focusY={focusY} edit={videoEdit} total={total} onVideoError={onVideoError} blur={blurFor(s.id)} /></Sequence>;
        })}</AbsoluteFill>}
      </Camera>
      </CreativeVideo>
      </FxStage>
      {showEffects && <Effects style={style} />}
      </MotionStage>
      <TitleOverlays titles={titles} style={style} aspect={aspect} textFx={textFx} safe={safe} />
      {/* Subtitle yang digantikan lapisan kreatif sudah dibuang dari `pages` di build-props (hanya di rentang kreatif) */}
      {showCaptions && <Subtitles pages={pages} style={style} aspect={aspect} anim={captionAnim} textScale={textScale} textBottom={textBottom} textFx={textFx} safe={safe} />}
      <SfxTrack cues={sfx} />
      <CreativeFontLoader fonts={creative?.fonts} onError={onCreativeError} />
      {creativeData && <CreativeOverlay code={creative?.overlay} data={creativeData} ranges={creative?.ranges} onError={onCreativeError} />}
      {/* Fase 18: klip penutup sesudah video. Frame di dalam Sequence dimulai dari 0, jadi kode AI melihat klipnya sendiri. */}
      {endClip && (
        <Sequence from={total} durationInFrames={endClip.frames} name="Klip akhir">
          <AbsoluteFill style={{ backgroundColor: endClip.background }}>
            <CreativeFontLoader fonts={endClip.fonts} onError={onCreativeError} />
            <CreativeOverlay code={endClip.overlay} onError={onCreativeError} data={{ width, height, fps, durationInFrames: endClip.frames, aspect, words: [], joins: [], colors: style.colors, fonts: creativeFonts(), safeArea: safeAreaPx(aspect, width, height, safe), mode: "motion", assets: endClip.assets ?? [] }} />
          </AbsoluteFill>
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
