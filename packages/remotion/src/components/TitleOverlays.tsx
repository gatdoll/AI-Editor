import { FONT, FX, MOTION, SUBTITLE, type AspectId, type StyleDef } from "@app/config";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { KineticCaptions } from "./KineticCaptions.tsx";
import { fontFor } from "./fonts.ts";
import { titleBottom, titlePage, titleScale, type MotionTitle } from "../title-plan.ts";
import type { TextFx } from "../build-props.ts";

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;


/** Headline hook: tiap kata masuk bergantian dari atas, kiri, kanan, lalu menyatu jadi satu kalimat. */
function HookTitle({ title, style, aspect, textFx }: { title: MotionTitle; style: StyleDef; aspect: AspectId; textFx?: TextFx }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  if (t < title.startS || t > title.endS) return null;
  const words = title.text.split(/\s+/).slice(0, FX.hook.maxWords);
  const font = fontFor(textFx?.font, style.fontWeight);
  const size = SUBTITLE.fontSizePx[aspect] * (height / SUBTITLE.referenceHeight[aspect]) * titleScale(title.text, width, height, aspect) * MOTION.captionScale;
  const out = interpolate(t, [title.endS - MOTION.exitSec, title.endS], [1, 0], clamp);
  const dirs = [[0, -1], [-1, 0], [1, 0]] as const;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * titleBottom(title.position, aspect), paddingLeft: width * SUBTITLE.safeZone[aspect].side, paddingRight: width * SUBTITLE.safeZone[aspect].right, pointerEvents: "none", opacity: out }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "0.22em", maxWidth: width * Math.min(MOTION.captionMaxWidth, 1 - SUBTITLE.safeZone[aspect].side - SUBTITLE.safeZone[aspect].right), fontFamily: font.fontFamily, fontWeight: font.fontWeight, fontSize: size, lineHeight: MOTION.captionLineHeight, textTransform: style.uppercase ? "uppercase" : "none" }}>
        {words.map((w, i) => {
          const start = title.startS + i * FX.hook.wordSec;
          const p = spring({ frame: Math.round((t - start) * fps), fps, config: MOTION.wordSpring });
          const [dx, dy] = dirs[i % dirs.length];
          const travel = FX.hook.travel * (dx ? width : height) * (1 - p);
          return <span key={i} style={{ display: "inline-block", color: i === words.length - 1 ? style.colors.accent : style.colors.text, opacity: t < start ? 0 : Math.min(1, p * 1.5), transform: `translate(${dx * travel}px, ${dy * travel}px) scale(${1 + 0.4 * (1 - p)})`, textShadow: `0 ${SUBTITLE.shadowOffsetEm}em ${SUBTITLE.shadowBlurEm}em ${style.colors.dark}` }}>{w}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
}

/** Lower third modern: garis tipis aksen tumbuh dari kiri, lalu label (dan subteks) geser masuk dengan easing. */
function LowerThird({ title, style, aspect, textFx }: { title: MotionTitle; style: StyleDef; aspect: AspectId; textFx?: TextFx }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const f0 = Math.round(title.startS * fps), f1 = Math.round(title.endS * fps);
  if (frame < f0 || frame > f1) return null;
  const L = FX.lowerThird;
  const df = frame - f0;
  const line = interpolate(df, [0, L.lineFrames], [0, 1], { ...clamp, easing: ease });
  const text = interpolate(df, [L.textDelayFrames, L.textDelayFrames + L.textFrames], [0, 1], { ...clamp, easing: ease });
  const leave = interpolate(frame, [f1 - L.exitFrames, f1], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const font = fontFor(textFx?.font, style.fontWeight);
  const size = SUBTITLE.fontSizePx[aspect] * (height / SUBTITLE.referenceHeight[aspect]) * L.fontScale;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: width * L.left, bottom: height * L.bottom[aspect], fontFamily: font.fontFamily, opacity: 1 - leave, transform: `translateX(${-leave * width * 0.08}px)` }}>
        <div style={{ overflow: "hidden" }}>
          <div style={{ fontSize: size, fontWeight: font.fontWeight, color: style.colors.text, lineHeight: 1.1, transform: `translateX(${(text - 1) * 105}%)`, textShadow: `0 ${SUBTITLE.shadowOffsetEm}em ${SUBTITLE.shadowBlurEm}em ${style.colors.dark}`, whiteSpace: "nowrap" }}>{title.text}</div>
        </div>
        <div style={{ height: size * L.lineEm, minHeight: 2, background: style.colors.accent, margin: `${size * 0.18}px 0`, transform: `scaleX(${line})`, transformOrigin: "left center", width: "100%" }} />
        {title.subtext && <div style={{ overflow: "hidden" }}>
          <div style={{ fontSize: size * (L.subScale / L.fontScale), fontWeight: FONT.weightRegular, color: style.colors.text, opacity: 0.85, transform: `translateX(${(text - 1) * 105}%)`, whiteSpace: "nowrap" }}>{title.subtext}</div>
        </div>}
      </div>
    </AbsoluteFill>
  );
}

export function TitleOverlays({ titles, style, aspect, textFx }: { titles: MotionTitle[]; style: StyleDef; aspect: AspectId; textFx?: TextFx }) {
  const { width, height } = useVideoConfig();
  return <>{titles.map((title, i) => {
    const key = `${i}-${title.startS}`;
    if (title.animation === "hook") return <HookTitle key={key} title={title} style={style} aspect={aspect} textFx={textFx} />;
    if (title.animation === "lower-third") return <LowerThird key={key} title={title} style={style} aspect={aspect} textFx={textFx} />;
    return <KineticCaptions key={key} pages={[titlePage(title)]} style={{ ...style, dimOpacity: 1 }} aspect={aspect} variant={title.animation} textScale={titleScale(title.text, width, height, aspect)} textBottom={titleBottom(title.position, aspect)} textFx={textFx ? { ...textFx, exit: "potong" } : undefined} />;
  })}</>;
}
