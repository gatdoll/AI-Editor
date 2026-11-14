import { KineticCaptions } from "./KineticCaptions.tsx";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EASING, FX, SUBTITLE, type AspectId, type CaptionAnim, type StyleDef } from "@app/config";
import { activeTokenIndex, pageAt, pageLines, type CaptionPage } from "../captions.ts";
import { clamp01, exitFactor, highlightLook, SweepBox } from "./text-fx.tsx";
import type { TextFx } from "../build-props.ts";
import { fontFor } from "./fonts.ts";

/**
 * Subtitle per kata dengan empat animasi (config.CAPTION_ANIMS):
 *  - sorot : kata aktif berwarna dan terangkat, kata lain redup
 *  - pop   : kata muncul satu per satu dengan "pop"; yang belum diucapkan tersembunyi
 *  - kotak : kata aktif diberi kotak berwarna
 *  - pendek: 1-3 kata besar sekaligus, muncul dengan pop
 * Maksimal 2 baris, di zona aman bawah. Layer terpisah di atas kamera: tidak ikut bergerak (aturan 4).
 */
export const Subtitles = ({ pages, style, aspect, anim, textScale, textBottom, textFx }: { pages: CaptionPage[]; style: StyleDef; aspect: AspectId; anim: CaptionAnim; textScale: number; textBottom: number | null; textFx?: TextFx }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const page = pageAt(pages, t);
  if (anim === "kinetik" || anim === "blur-slide") return <KineticCaptions variant={anim} pages={pages} style={style} aspect={aspect} textScale={textScale} textBottom={textBottom} textFx={textFx}/>;
  if (!page) return null;

  const lines = pageLines(page);
  const active = activeTokenIndex(page, t);
  const safe = SUBTITLE.safeZone[aspect];
  const scale = height / SUBTITLE.referenceHeight[aspect];
  const chunk = anim === "pendek";
  const fontSize = SUBTITLE.fontSizePx[aspect] * scale * (chunk ? SUBTITLE.chunkFontScale : 1) * textScale;
  const fade = interpolate(t, [page.start, page.start + 0.08], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // Pada animasi sorot/kotak, kata yang belum diucapkan tetap terbaca samar
  const dim = Math.max(0.35, style.dimOpacity);
  const exit = exitFactor(textFx, t, page.end);
  const font = fontFor(textFx?.font, style.fontWeight);
  const popFrom = textFx?.popFrom ?? SUBTITLE.popFromScale;

  let index = 0;
  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: height * (textBottom ?? safe.bottom),
        paddingLeft: width * safe.side,
        // 9:16: kanan lebih lebar dari kiri agar tidak tertimpa kolom tombol like/komentar (SAFE_AREA)
        paddingRight: width * safe.right,
        opacity: (chunk || anim === "pop" ? 1 : fade) * exit,
        transform: textFx?.exit === "geser" ? `translateY(${-(1 - exit) * FX.exitTravelEm * fontSize}px)` : undefined,
      }}
    >
      <div style={{ textAlign: "center", lineHeight: SUBTITLE.lineHeight }}>
        {lines.map((line, li) => (
          <div key={li} style={{ whiteSpace: "nowrap" }}>
            {line.map((tok) => {
              const i = index++;
              const isActive = i === active;
              const spoken = i <= active;
              const startFrame = Math.round((tok.startMs / 1000) * fps);
              const popIn = spring({ frame: frame - startFrame, fps, config: EASING.pop });

              let opacity = 1;
              let transform = "none";
              let color = style.colors.text;
              let background: string | undefined;
              let boxPad = "0";

              if (anim === "sorot") {
                color = isActive ? style.colors.accent : style.colors.text;
                opacity = isActive ? 1 : dim;
                transform = `translateY(${-SUBTITLE.activeLiftEm * fontSize * clamp01(spring({ frame: frame - startFrame, fps, config: EASING.spring }))}px)`;
              } else if (anim === "pop" || anim === "pendek") {
                opacity = spoken ? 1 : 0;
                const s = popFrom + (1 - popFrom) * Math.max(0, popIn);
                transform = spoken ? `scale(${s})` : "scale(1)";
                color = isActive ? style.colors.accent : style.colors.text;
              } else if (anim === "kotak") {
                if (isActive) {
                  background = style.colors.accent;
                  color = style.colors.dark;
                  boxPad = `${SUBTITLE.boxPadYEm}em ${SUBTITLE.boxPadXEm}em`;
                } else opacity = dim;
              }

              const hl = highlightLook(tok, frame, fps, style);
              if (hl) {
                color = hl.color;
                if (hl.transform) transform = hl.transform;
                if (hl.opacity !== undefined) opacity = hl.opacity;
                else if (anim !== "pop" && anim !== "pendek") opacity = 1;
                background = undefined;
                boxPad = "0";
              }

              return (
                <span
                  key={i}
                  style={{
                    position: "relative",
                    zIndex: 0,
                    display: "inline-block",
                    whiteSpace: "pre",
                    fontFamily: font.fontFamily,
                    fontWeight: font.fontWeight,
                    fontSize: fontSize * (hl?.scale ?? 1),
                    textTransform: style.uppercase || chunk ? "uppercase" : "none",
                    color,
                    background,
                    padding: boxPad,
                    borderRadius: background ? `${SUBTITLE.boxRadiusEm}em` : undefined,
                    opacity,
                    transform,
                    WebkitTextStroke: style.strokePx > 0 && !background ? `${style.strokePx * scale}px ${style.colors.dark}` : undefined,
                    paintOrder: "stroke fill",
                    textShadow: background || hl?.sweep ? "none" : `0 ${fontSize * SUBTITLE.shadowOffsetEm}px ${fontSize * SUBTITLE.shadowBlurEm}px ${style.colors.dark}`,
                  }}
                >
                  {hl && <SweepBox sweep={hl.sweep} color={style.colors.accent} />}
                  {tok.text}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
