// Fase 13: motion graphics berdiri sendiri. Kanvas kosong + kode Mode Kreatif sebagai SELURUH video + musik opsional.
// Komposisi yang sama dipakai pratinjau (Player), still, dan render MP4.
import { AbsoluteFill, Audio } from "remotion";
import { CreativeFontLoader, CreativeOverlay, creativeFonts, type CreativeErrorHandler } from "../creative/CreativeLayer.tsx";
import { safeAreaPx, type CreativeData } from "../creative/contract.ts";
import { duckedVolume, type MotionProps } from "../motion-props.ts";
import { SfxTrack } from "../components/SfxTrack.tsx";
import { Subtitles } from "../components/Subtitles.tsx";

export const Motion = (p: MotionProps & { onCreativeError?: CreativeErrorHandler }) => {
  // Data kode AI = motionCreativeData, kecuali font: nama keluarga yang SUDAH dimuat (bukan label tampilan)
  const data: CreativeData = {
    width: p.width, height: p.height, fps: p.fps, durationInFrames: p.durationInFrames, aspect: p.aspect,
    words: p.voiceover?.words ?? [], joins: [], colors: p.colors, fonts: creativeFonts(), safeArea: safeAreaPx(p.aspect, p.width, p.height), mode: "motion", assets: p.assets,
    ...(p.table ? { table: p.table } : {}), ...(p.opini ? { opini: p.opini } : {}),
  };
  return (
    <AbsoluteFill style={{ backgroundColor: p.background, overflow: "hidden" }}>
      {p.music && <Audio src={p.music.src} volume={p.music.duck ? (f) => duckedVolume(f / p.fps, p.music!.volume, p.music!.duck!) : p.music.volume} />}
      {p.voiceover && <Audio src={p.voiceover.src} volume={p.voiceover.volume} />}
      <SfxTrack cues={p.sfx} />
      <CreativeFontLoader fonts={p.fonts} onError={p.onCreativeError} />
      <CreativeOverlay code={p.overlay} data={data} onError={p.onCreativeError} />
      {/* Subtitle otomatis voice over: layer terpisah di atas animasi (aturan 4) */}
      {p.captions && <Subtitles pages={p.captions.pages} style={p.captions.style} aspect={p.aspect} anim={p.captions.anim} textScale={p.captions.textScale} textBottom={p.captions.textBottom} textFx={p.captions.textFx} />}
    </AbsoluteFill>
  );
};
