import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, DEMO, EASING, FONT } from "@app/config";

// Komposisi contoh Fase 1: bukti render dari kode. Diganti di Fase 4.
export const Sample = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: EASING.spring });
  const scale = interpolate(s, [0, 1], [0.9, 1]);
  return (
    <AbsoluteFill
      style={{ backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}
    >
      <div
        style={{
          color: COLORS.text,
          fontFamily: FONT.family,
          fontWeight: FONT.weightBold,
          fontSize: DEMO.fontSizePx,
          transform: `scale(${scale})`,
        }}
      >
        Fondasi <span style={{ color: COLORS.accent }}>OK</span>
      </div>
    </AbsoluteFill>
  );
};
