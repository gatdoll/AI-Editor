import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/PlusJakartaSans";
import { FONT, MOTION, STYLES, type AspectId } from "@app/config";
import { MotionBackdrop } from "../components/MotionStage.tsx";
import { KineticCaptions } from "../components/KineticCaptions.tsx";
import { motionEase } from "../motion-plan.ts";
import type { CaptionPage } from "../captions.ts";

const { fontFamily } = loadFont("normal", { weights: [String(FONT.weightRegular), String(FONT.weightBold)] as never, subsets: ["latin"] });
const C = MOTION.showcase;
const theme = STYLES.motion;
const demoPages: CaptionPage[] = C.captionPages.map(({ start, end, words }) => ({
  start, end, lineStarts: [0],
  tokens: words.map((text, i) => ({ text, startMs: (start + i * (end - start) / words.length) * 1000, endMs: (start + (i + 1) * (end - start) / words.length) * 1000, timestampMs: null, confidence: null })),
}));

/** An original motion study, using the same kinetic renderer available on real footage. */
export function MotionShowcase({ aspect = "16:9" }: { aspect?: AspectId }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  const scene = Math.min(C.titles.length - 1, Math.floor(t / C.sceneSec));
  const local = t - scene * C.sceneSec;
  const portrait = height > width;
  const unit = Math.min(width, height);
  const pad = unit * C.inset;
  const enter = spring({ frame: Math.max(0, local * fps), fps, config: MOTION.wordSpring });
  const exit = motionEase((local - (C.sceneSec - MOTION.exitSec)) / MOTION.exitSec);
  const titleSize = unit * C.titleSize * (portrait ? 0.8 : 1);
  return <AbsoluteFill style={{ background: theme.colors.dark, color: theme.colors.text, fontFamily, overflow: "hidden" }}>
    <MotionBackdrop style={theme} />
    <AbsoluteFill style={{ padding: pad, transform: `scale(${1 + local / C.sceneSec * MOTION.frameLift})`, opacity: 1 - exit }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: unit * C.labelSize, letterSpacing: "0.18em", fontWeight: FONT.weightRegular }}>
        <span>EDITING STUDIO</span><span style={{ color: theme.colors.accent }}>MOTION / {String(scene + 1).padStart(2, "0")}</span>
      </div>
      {scene < 2 ? <div style={{ position: "absolute", left: pad, top: portrait ? height * 0.24 : height * 0.25, zIndex: 2 }}>
        {C.titles[scene].map((text, i) => {
          const delay = C.staggerSec * i + MOTION.sceneLeadSec;
          const p = spring({ frame: Math.max(0, (local - delay) * fps), fps, config: MOTION.wordSpring });
          const shown = local >= delay;
          return <div key={`${scene}-${i}`} style={{ overflow: "hidden", paddingBottom: `${MOTION.underlineOffsetEm}em`, fontSize: titleSize, fontWeight: FONT.weightBold, lineHeight: C.titleLineHeight, letterSpacing: `${C.tracking}em` }}>
            <div style={{ opacity: shown ? 1 : 0, transformOrigin: "left bottom", transform: `translateY(${(1 - p) * 115}%) rotate(${(1 - p) * -MOTION.wordRotationDeg}deg)`, color: i === 2 ? theme.colors.accent : theme.colors.text }}>{text}</div>
          </div>;
        })}
        <div style={{ width: unit * MOTION.lineWidth, height: unit * MOTION.lineThickness * 2, background: theme.colors.accent, marginTop: pad / 2, transformOrigin: "left", transform: `scaleX(${motionEase((local - C.lineDelaySec) / MOTION.entranceSec)})` }}/>
      </div> : <div style={{ position: "absolute", left: pad, top: height * 0.2, color: theme.colors.accent, fontSize: unit * C.labelSize, letterSpacing: "0.16em", opacity: enter }}>KATA → TIMING → EKSPRESI</div>}

      {scene === 0 && <div style={{ position: "absolute", right: portrait ? -unit * 0.15 : unit * 0.16, top: portrait ? height * 0.62 : height * 0.24, width: unit * MOTION.ringSize, height: unit * MOTION.ringSize, opacity: enter, transform: `translateY(${(1 - enter) * pad}px) rotate(${local * C.ringDegreesPerSec}deg) scale(${0.75 + enter * 0.25})` }}>
        <svg width="100%" height="100%" viewBox="0 0 400 400" fill="none">
          {[150, 110, 70].map((r, i) => <circle key={r} cx="200" cy="200" r={r} stroke={theme.colors.accent} strokeWidth={i === 0 ? 2 : 1} strokeDasharray={2 * Math.PI * r} strokeDashoffset={2 * Math.PI * r * (1 - motionEase((local - i * C.staggerSec) / C.ringDrawSec))} opacity={1 - i * 0.25} />)}
          <rect x="180" y="180" width="40" height="40" fill={theme.colors.accent} transform={`rotate(${local * C.squareDegreesPerSec} 200 200)`}/>
        </svg>
      </div>}

      {scene === 1 && <div style={{ position: "absolute", right: portrait ? pad : pad * 1.5, top: portrait ? height * C.cardPortraitTop : height * 0.22, width: unit * (portrait ? 0.8 : 0.54), height: unit * 0.46 }}>
        {[0, 1, 2].map((i) => {
          const p = spring({ frame: Math.max(0, (local - C.cardDelaySec - i * C.staggerSec) * fps), fps, config: MOTION.wordSpring });
          const drift = Math.sin((local + i * C.cardFloatPhaseSec) * Math.PI * 2 / C.cardFloatPeriodSec) * unit * 0.012;
          return <div key={i} style={{ position: "absolute", inset: 0, borderRadius: unit * C.cardRadius, border: `${unit * MOTION.ringStroke}px solid ${theme.colors.accent}`, background: i === 2 ? theme.colors.accent : theme.colors.dark, color: theme.colors.dark, transform: `translate(${(i - 1) * unit * 0.035}px,${(1 - p) * height + (i - 1) * unit * 0.025 + drift}px) rotate(${(i - 1) * 9 + (1 - p) * 12}deg)`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {i === 2 && <svg viewBox="0 0 400 300" width="80%" height="80%" fill="none" stroke="currentColor" strokeWidth="5">
              {[0, 1, 2, 3, 4, 5, 6].map((j) => <path key={j} d={`M ${50 + j * 50} 230 V ${150 - Math.sin(local * C.barRadiansPerSec - j * C.barPhaseRadians) * 65}`} strokeLinecap="round" />)}
            </svg>}
          </div>;
        })}
      </div>}

      <div style={{ position: "absolute", left: pad, right: pad, bottom: pad, display: "flex", alignItems: "center", justifyContent: "space-between", gap: pad, fontSize: unit * C.labelSize, letterSpacing: "0.12em" }}>
        <span>{C.labels[scene]}</span>
        <div style={{ width: unit * MOTION.lineWidth, height: unit * MOTION.lineThickness, background: theme.colors.text, opacity: 0.7, transform: `scaleX(${motionEase(local / C.sceneSec)})`, transformOrigin: "left" }}/>
      </div>
    </AbsoluteFill>
    {scene === 2 && <KineticCaptions pages={demoPages} aspect={aspect} style={theme} textScale={C.captionScale} textBottom={C.captionBottom}/>}
    {/* A graphic wipe straddles the scene boundary; it never changes timeline length. */}
    {[C.sceneSec, C.sceneSec * 2].map((at) => {
      const p = motionEase((t - at + MOTION.exitSec) / (MOTION.exitSec * 2));
      return p > 0 && p < 1 ? <AbsoluteFill key={at} style={{ background: theme.colors.accent, transform: `translateX(${(1 - p * 2) * 100}%)`, zIndex: 5 }}/> : null;
    })}
  </AbsoluteFill>;
}
