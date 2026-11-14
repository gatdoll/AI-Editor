// Bukti konsep Fase 9.0: kode kreatif (string) di-compile saat runtime dan dirender sama di Player dan renderer.
// "Video" di sini latar sintetis bergaris agar gerakan whip/punch-in terlihat jelas tanpa file video.
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { STYLES } from "@app/config";
import { CreativeOverlay, CreativeVideo, creativeFonts } from "../creative/CreativeLayer.tsx";
import { safeAreaPx, type CreativeData } from "../creative/contract.ts";
import { creativeProofDefaults } from "../creative/sample.ts";

export { creativeProofDefaults };

export type { CreativeProofProps } from "../creative/sample.ts";
import type { CreativeProofProps } from "../creative/sample.ts";

function FakeFootage() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, #1d2b3a, #3a2b1d)` }}>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} style={{ position: "absolute", left: (i / 12) * width, top: 0, width: width / 24, height, background: i % 2 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.12)" }} />
      ))}
      <div style={{ position: "absolute", left: width * 0.3, top: height * 0.25, width: width * 0.4, height: width * 0.4, borderRadius: "50%", background: "#c98b62", boxShadow: "0 0 0 12px #3b2a20" }} />
      <div style={{ position: "absolute", left: 24, top: 24, color: "#fff", fontSize: 36, fontFamily: "monospace" }}>frame {frame}</div>
    </AbsoluteFill>
  );
}

export const CreativeProof = ({ overlay, video, words, joins }: CreativeProofProps) => {
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const style = STYLES.modern;
  const data: CreativeData = { width, height, fps, durationInFrames, aspect: width > height ? "16:9" : "9:16", words, joins, colors: { ...style.colors, accent: "#B6FF00" }, fonts: creativeFonts(), safeArea: safeAreaPx(width > height ? "16:9" : "9:16", width, height) };
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <CreativeVideo code={video} data={data}><FakeFootage /></CreativeVideo>
      <CreativeOverlay code={overlay} data={data} />
    </AbsoluteFill>
  );
};
