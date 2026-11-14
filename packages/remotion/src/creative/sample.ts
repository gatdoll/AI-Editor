// Contoh kode kreatif tulisan tangan untuk bukti konsep 9.0 (bentuk yang sama dengan keluaran AI nanti).
// Overlay: caption kata per kata dengan scale-pop spring, kata kunci berkotak aksen, headline hook.
// Video: whip pan di sambungan cut + punch-in kecil di kata kunci.
import type { CreativeWord } from "./contract.ts";

export const SAMPLE_OVERLAY = `import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import type { FC } from "react";

type Word = { text: string; start: number; end: number; hl?: "aksen" | "slam" };
type Data = { width: number; height: number; fps: number; words: Word[]; colors: { text: string; accent: string; dark: string }; fonts: { montserrat: string } };

const Overlay: FC<{ data: Data }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const t = frame / fps;
  const unit = height / 1920;
  // Kelompokkan 3 kata per layar mengikuti ucapan
  const groups: Word[][] = [];
  data.words.forEach((w, i) => { if (i % 3 === 0) groups.push([]); groups[groups.length - 1].push(w); });
  const g = groups.find((ws) => t >= ws[0].start - 0.05 && t <= ws[ws.length - 1].end + 0.2);
  const hookOut = interpolate(t, [2.6, 3], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      {t < 3 && (
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: hookOut }}>
          <div style={{ fontFamily: data.fonts.montserrat, fontWeight: 800, fontSize: 150 * unit, color: data.colors.text, textTransform: "uppercase", textAlign: "center", lineHeight: 1, width: width * 0.86 }}>
            {["STOP", "SCROLL", "SEKARANG"].map((w, i) => {
              const p = spring({ frame: frame - i * 6, fps, config: { damping: 12, stiffness: 200 } });
              const dir = [[0, -1], [-1, 0], [1, 0]][i];
              return <div key={i} style={{ transform: \`translate(\${dir[0] * (1 - p) * width}px, \${dir[1] * (1 - p) * 600 * unit}px)\`, color: i === 2 ? data.colors.accent : data.colors.text }}>{w}</div>;
            })}
          </div>
        </AbsoluteFill>
      )}
      {g && t >= 3 && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.26 }}>
          <div style={{ display: "flex", gap: 22 * unit, fontFamily: data.fonts.montserrat, fontWeight: 800, fontSize: 92 * unit, textTransform: "uppercase" }}>
            {g.map((w, i) => {
              const f0 = Math.round(w.start * fps);
              const pop = spring({ frame: frame - f0, fps, config: { damping: 10, stiffness: 260, mass: 0.6 } });
              const scale = frame < f0 ? 0 : 0.8 + 0.2 * pop;
              const sweep = interpolate(frame - f0, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
              const key = w.hl !== undefined;
              return (
                <span key={i} style={{ position: "relative", display: "inline-block", transform: \`scale(\${scale * (key ? 1.3 : 1)})\`, color: key && sweep > 0.5 ? data.colors.dark : data.colors.text, textShadow: key ? "none" : "0 6px 18px rgba(0,0,0,0.6)" }}>
                  {key && <span style={{ position: "absolute", inset: "-4% -8%", background: data.colors.accent, transform: \`scaleX(\${sweep})\`, transformOrigin: "left", zIndex: -1, borderRadius: 10 * unit }} />}
                  {w.text.replace(/[.,!?]+$/, "")}
                </span>
              );
            })}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
export default Overlay;
`;

export const SAMPLE_VIDEO = `type Data = { fps: number; width: number; joins: number[]; words: { start: number; hl?: string }[] };

export default function video(frame: number, data: Data) {
  const t = frame / data.fps;
  let x = 0, blur = 0, scale = 1;
  for (const j of data.joins) {
    const p = (t - j) / (4 / data.fps); // 4 frame sebelum dan sesudah sambungan
    if (Math.abs(p) <= 1) {
      const e = 1 - Math.abs(p);
      x += (p < 0 ? -1 : 1) * e * e * data.width * 0.4;
      blur = Math.max(blur, e * 40);
      scale = Math.max(scale, 1 + 0.8 * e);
    }
  }
  for (const w of data.words) {
    if (!w.hl) continue;
    const d = t - w.start;
    if (d >= 0 && d < 0.5) scale *= 1 + 0.12 * Math.sin(Math.min(1, d / 0.12) * Math.PI / 2) * (1 - d / 0.5);
  }
  return { transform: \`translateX(\${x}px) scale(\${scale})\`, filter: blur > 0.5 ? \`blur(\${blur}px)\` : undefined };
}
`;

export type CreativeProofProps = { overlay: string; video: string; words: CreativeWord[]; joins: number[] };

const TEXT = "hari ini aku kasih tujuh rahasia editing yang bikin video kamu viral tanpa ribet sama sekali";
export const creativeProofDefaults: CreativeProofProps = {
  overlay: SAMPLE_OVERLAY,
  video: SAMPLE_VIDEO,
  words: TEXT.split(" ").map((text, i) => ({ text, start: 3 + i * 0.35, end: 3 + i * 0.35 + 0.3, ...(text === "tujuh" || text === "viral" ? { hl: "aksen" as const } : {}) })),
  joins: [5.2],
};
