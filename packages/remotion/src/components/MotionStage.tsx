import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { MOTION, type StyleDef } from "@app/config";
import { spatialMotionAt, type MotionDesign } from "../motion-plan.ts";

/** Intentional designed canvas revealed behind a floating shot. No video timing changes. */
export function MotionBackdrop({ style, opacity = 1 }: { style: StyleDef; opacity?: number }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const unit = Math.min(width, height);
  const angle = frame / fps / MOTION.orbitSec * 360;
  return <AbsoluteFill style={{ background: style.colors.dark, overflow: "hidden", opacity }}>
    {[0, 1].map((i) => <div key={i} style={{ position: "absolute", width: unit * MOTION.ringSize, height: unit * MOTION.ringSize, left: i ? width - unit * MOTION.ringSize / 2 : -unit * MOTION.ringSize / 2, top: i ? -unit * MOTION.ringSize / 2 : height - unit * MOTION.ringSize / 2, borderRadius: "50%", border: `${unit * MOTION.ringStroke}px solid ${style.colors.accent}`, opacity: MOTION.detailOpacity, transform: `rotate(${angle * (i ? -1 : 1)}deg)` }}>
      <div style={{ position: "absolute", top: "50%", width: "100%", height: unit * MOTION.lineThickness, background: style.colors.accent }} />
      <div style={{ position: "absolute", left: "50%", height: "100%", width: unit * MOTION.lineThickness, background: style.colors.accent }} />
    </div>)}
  </AbsoluteFill>;
}

export function MotionStage({ design, style, children }: { design?: MotionDesign; style: StyleDef; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { amount, x, rotX, rotY, rotZ } = spatialMotionAt(design, frame / fps);
  const scale = 1 - (1 - MOTION.frameScale) * amount;
  const unit = Math.min(width, height);
  return <AbsoluteFill style={{ isolation: "isolate" }}>
    {design?.enabled && <MotionBackdrop style={style} />}
    <AbsoluteFill style={{ zIndex: 1, overflow: "hidden", borderRadius: unit * MOTION.frameRadius * amount, transform: `perspective(${unit * MOTION.spatial.perspective}px) translate(${width * x}px,${-height * MOTION.frameLift * amount}px) rotateY(${rotY}deg) rotateX(${rotX}deg) rotateZ(${rotZ}deg) scale(${scale})`, boxShadow: amount ? `0 ${unit * MOTION.frameRadius}px ${unit * MOTION.frameShadow}px ${style.colors.dark}` : undefined }}>
      {children}
    </AbsoluteFill>
  </AbsoluteFill>;
}
