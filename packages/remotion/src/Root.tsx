import { Composition } from "remotion";
import { ASPECTS, MOTION, VIDEO, type AspectId } from "@app/config";
import { MotionShowcase } from "./compositions/MotionShowcase.tsx";
import { Edited } from "./compositions/Edited.tsx";
import { Motion } from "./compositions/Motion.tsx";
import type { MotionProps } from "./motion-props.ts";
import { editedDefaults, type EditedProps } from "./edited-props.ts";
import { Sample } from "./compositions/Sample.tsx";
import { CreativeProof, creativeProofDefaults } from "./compositions/CreativeProof.tsx";
import { toFrameSegments, totalFrames } from "./frames.ts";

export const RemotionRoot = () => (
  <>
    <Composition id="MotionShowcase" component={MotionShowcase} defaultProps={{ aspect: "16:9" as const }} durationInFrames={MOTION.showcase.durationSec * VIDEO.fps} fps={VIDEO.fps} width={ASPECTS["16:9"].width} height={ASPECTS["16:9"].height} calculateMetadata={({ props }: { props: { aspect?: AspectId } }) => ({ width: ASPECTS[props.aspect ?? "16:9"].width, height: ASPECTS[props.aspect ?? "16:9"].height })}/>
    <Composition
      id="Sample"
      component={Sample}
      durationInFrames={VIDEO.fps * 3}
      fps={VIDEO.fps}
      width={ASPECTS["16:9"].width}
      height={ASPECTS["16:9"].height}
    />
    <Composition id="CreativeProof" component={CreativeProof} defaultProps={creativeProofDefaults} durationInFrames={VIDEO.fps * 9} fps={VIDEO.fps} width={ASPECTS["9:16"].width} height={ASPECTS["9:16"].height} />
    {/* Fase 13: motion graphics berdiri sendiri; ukuran, fps, dan durasi dari props */}
    <Composition id="Motion" component={Motion} defaultProps={{ width: 1080, height: 1920, fps: VIDEO.fps, durationInFrames: VIDEO.fps * 5, aspect: "9:16", background: "#0B0D0F", colors: { text: "#FFFFFF", accent: "#B6FF00", dark: "#000000" }, assets: [] } as MotionProps}
      durationInFrames={VIDEO.fps * 5} fps={VIDEO.fps} width={1080} height={1920}
      calculateMetadata={({ props }: { props: MotionProps }) => ({ durationInFrames: Math.max(1, props.durationInFrames), fps: props.fps, width: props.width, height: props.height })} />
    <Composition
      id="Edited"
      component={Edited}
      defaultProps={editedDefaults}
      durationInFrames={VIDEO.fps}
      fps={VIDEO.fps}
      width={ASPECTS["16:9"].width}
      height={ASPECTS["16:9"].height}
      calculateMetadata={({ props }: { props: EditedProps }) => {
        // Ukuran/fps mengikuti sumber; durasi = jumlah frame segmen EDL (rumus yang sama dengan komposisi).
        const frames = totalFrames(toFrameSegments(props.segments, props.fps, props.sourceSeconds));
        return {
          durationInFrames: Math.max(1, frames) + (props.endClip?.frames ?? 0),
          fps: props.fps,
          width: props.width,
          height: props.height,
        };
      }}
    />
  </>
);
