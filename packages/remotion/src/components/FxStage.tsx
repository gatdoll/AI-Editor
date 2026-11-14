import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { FX, type StyleDef } from "@app/config";
import { fxStateAt, hash01, type FxPlan } from "../fx-plan.ts";

/**
 * Transisi sambungan, guncangan, dan dutch tilt. Hanya membungkus video (di dalam MotionStage);
 * subtitle dan judul tetap di layer terpisah dan tidak ikut bergerak (aturan 4).
 */
export function FxStage({ plan, style, children }: { plan?: FxPlan; style: StyleDef; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const s = fxStateAt(plan, frame, fps, width, height);
  const idle = s.x === 0 && s.y === 0 && s.rot === 0 && s.scale === 1 && s.blur === 0 && s.skew === 0 && !s.filter;
  if (idle) return <AbsoluteFill>{children}</AbsoluteFill>;
  const filter = [s.blur > 0.3 ? `blur(${s.blur}px)` : "", s.filter ?? ""].join(" ").trim();
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transformOrigin: "50% 50%", transform: `translate(${s.x}px, ${s.y}px) rotate(${s.rot}deg) skewX(${s.skew}deg) scale(${s.scale})`, filter: filter || undefined, willChange: "transform" }}>
        {children}
      </AbsoluteFill>
      {s.glitch > 0.05 && Array.from({ length: FX.transition.glitchBars }, (_, i) => {
        const r = hash01(s.seedFrame * 31 + i * 17);
        if (r > 0.65) return null;
        const top = hash01(s.seedFrame * 11 + i * 5) * 100;
        const h = 1 + hash01(s.seedFrame * 3 + i) * 6;
        const color = i % 3 === 0 ? style.colors.accent : FX.transition.glitchColors[(i % 3) - 1];
        return <div key={i} style={{ position: "absolute", left: 0, right: 0, top: `${top}%`, height: `${h}%`, background: color, opacity: FX.transition.glitchBarOpacity * s.glitch, mixBlendMode: "screen", transform: `translateX(${(r - 0.3) * 20 * s.glitch}%)` }} />;
      })}
    </AbsoluteFill>
  );
}
