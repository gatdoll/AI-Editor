import { AbsoluteFill, useCurrentFrame } from "remotion";
import { EFFECTS, GRAIN_EVERY_FRAMES, type StyleDef } from "@app/config";
import { GRAIN_PNG, GRAIN_SIZE } from "../grain-data.ts";

/**
 * Efek film tipis di atas kamera: gradient halus, vignette ringan, grain. Layar-tetap (tidak ikut bergerak).
 * Semua intensitas dari config (aturan 8).
 */
export const Effects = ({ style }: { style: StyleDef }) => {
  const frame = useCurrentFrame();
  const dark = style.colors.dark;
  const rgba = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  // Grain berganti posisi tiap GRAIN_EVERY_FRAMES frame seperti butiran film, bukan getar tiap frame.
  // Tekstur noise kecil yang digeser jauh lebih murah daripada filter SVG per frame (hampir separuh waktu render).
  const step = Math.floor(frame / GRAIN_EVERY_FRAMES);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(to top, ${rgba(dark, style.gradient)} 0%, transparent ${EFFECTS.gradientClearFromPct}%, transparent ${EFFECTS.gradientClearToPct}%, ${rgba(dark, style.gradient * EFFECTS.gradientTopFactor)} 100%)`,
        }}
      />
      <AbsoluteFill
        style={{ background: `radial-gradient(ellipse at 50% 50%, transparent ${EFFECTS.vignetteClearToPct}%, ${rgba(dark, style.vignette)} 100%)` }}
      />
      {style.grain > 0 && (
        <AbsoluteFill
          style={{
            opacity: Math.min(1, style.grain * 1.6),
            backgroundImage: `url(${GRAIN_PNG})`,
            backgroundSize: `${GRAIN_SIZE}px ${GRAIN_SIZE}px`,
            backgroundPosition: `${(step * 73) % GRAIN_SIZE}px ${(step * 151) % GRAIN_SIZE}px`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
