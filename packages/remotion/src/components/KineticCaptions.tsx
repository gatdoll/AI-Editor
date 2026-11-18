import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Fragment } from "react";
import { FX, MOTION, SUBTITLE, subtitleZone, type AspectId, type StyleDef } from "@app/config";
import { activeTokenIndex, pageAt, type CaptionPage } from "../captions.ts";
import { blurSlideProgress, wordMotion } from "../motion-plan.ts";
import type { TextFx } from "../build-props.ts";
import { fontFor } from "./fonts.ts";
import { exitFactor, highlightLook, SweepBox } from "./text-fx.tsx";

/** Word-timed masked reveals, a spring settle, and a drawn accent. All driven by frame. */
export function KineticCaptions({ pages, style, aspect, textScale = 1, textBottom = null, variant = "kinetik", textFx, safe: follow = true }: { pages: CaptionPage[]; style: StyleDef; aspect: AspectId; textScale?: number; textBottom?: number | null; variant?: "kinetik" | "blur-slide"; textFx?: TextFx; /** false = tidak mengikuti safe area platform */ safe?: boolean }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const page = pageAt(pages, t);
  if (!page) return null;
  const active = activeTokenIndex(page, t);
  const unit = height / SUBTITLE.referenceHeight[aspect];
  const longest = Math.max(...page.tokens.map((w) => w.text.trim().length), 1);
  // Conservative long-word fit; natural wrapping supports narrow portrait canvases.
  const font = fontFor(textFx?.font, style.fontWeight);
  const leave = exitFactor(textFx, t, page.end);
  // Lebar teks dibatasi safe area (9:16: kolom tombol like/komentar di kanan), bukan hanya captionMaxWidth
  const safe = subtitleZone(aspect, follow);
  const maxW = width * Math.min(MOTION.captionMaxWidth, 1 - safe.side - safe.right);
  const fontSize = Math.min(SUBTITLE.fontSizePx[aspect] * unit * MOTION.captionScale * textScale, maxW / longest);
  return <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * (textBottom ?? safe.bottom), paddingLeft: width * safe.side, paddingRight: width * safe.right, pointerEvents: "none", opacity: leave, transform: textFx?.exit === "geser" ? `translateY(${-(1 - leave) * FX.exitTravelEm * fontSize}px)` : undefined }}>
    <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", flexWrap: "wrap", gap: `${MOTION.captionGapEm}em`, maxWidth: maxW, fontFamily: font.fontFamily, fontWeight: font.fontWeight, fontSize, lineHeight: MOTION.captionLineHeight, textTransform: style.uppercase ? "uppercase" : "none", color: style.colors.text }}>
      {page.tokens.map((tok, i) => {
        const start = tok.startMs / 1000;
        const timed = wordMotion(t, start, tok.endMs / 1000, page.end);
        const blurred = variant === "blur-slide";
        const enter = blurred ? blurSlideProgress(t - start) : timed.enter;
        const exit = timed.exit;
        const opacity = enter * exit;
        const settle = blurred ? enter : spring({ frame: Math.max(0, frame - start * fps), fps, config: MOTION.wordSpring });
        const selected = i === active;
        const hl = highlightLook(tok, frame, fps, style);
        return <Fragment key={`${page.start}-${i}`}>
          {i > 0 && page.lineStarts.includes(i) && <span style={{ flexBasis: "100%", height: 0 }} />}
          <span style={{ position: "relative", zIndex: 0, display: "inline-block", paddingBottom: `${MOTION.underlineOffsetEm}em`, fontSize: hl ? `${hl.scale}em` : undefined, transform: hl?.transform, opacity: hl?.opacity }}>
          {hl && <SweepBox sweep={hl.sweep} color={style.colors.accent} />}
          <span style={{ display: "block", clipPath: `inset(${-MOTION.captionGapEm * 100}% -15% -15% -15%)`, overflow: "hidden" }}>
            <span style={{ display: "inline-block", opacity: opacity * (selected || hl ? 1 : style.dimOpacity), color: hl ? hl.color : selected ? style.colors.accent : style.colors.text, WebkitTextStroke: style.strokePx > 0 ? `${style.strokePx * unit}px ${style.colors.dark}` : undefined, paintOrder: "stroke fill", transformOrigin: "0 100%", filter: blurred && enter < 1 ? `blur(${(1 - enter) * MOTION.blurSlide.blurEm * fontSize}px)` : undefined, transform: `translateY(${(1 - settle) * (blurred ? MOTION.blurSlide.travelEm : MOTION.wordTravelEm) - (1 - exit) * MOTION.pageExitEm}em) rotate(${blurred ? 0 : (1 - settle) * -MOTION.wordRotationDeg}deg)`, textShadow: `0 ${SUBTITLE.shadowOffsetEm}em ${SUBTITLE.shadowBlurEm}em ${style.colors.dark}` }}>{tok.text.trim()}</span>
          </span>
          <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${MOTION.underlineHeightEm}em`, background: style.colors.accent, transform: `scaleX(${selected ? enter : 0})`, transformOrigin: "left center", opacity }} />
        </span></Fragment>;
      })}
    </div>
  </AbsoluteFill>;
}
