"use client";
// Fase 9.0: bukti konsep Mode Kreatif di Player browser. ?frame=N membekukan frame tertentu untuk dibandingkan dengan render worker.
import { use } from "react";
import { Player } from "@remotion/player";
import { ASPECTS, VIDEO } from "@app/config";
import { CreativeProof, creativeProofDefaults } from "@app/remotion/src/compositions/CreativeProof.tsx";

export default function CreativeProofPage({ searchParams }: { searchParams: Promise<{ frame?: string }> }) {
  const { frame } = use(searchParams);
  const still = frame !== undefined ? Math.max(0, Number(frame) || 0) : null;
  const out = ASPECTS["9:16"];
  return (
    <main style={{ background: "#000", minHeight: "100vh", display: "flex", justifyContent: "center" }}>
      <Player
        component={CreativeProof}
        inputProps={creativeProofDefaults}
        durationInFrames={VIDEO.fps * 9}
        fps={VIDEO.fps}
        compositionWidth={out.width}
        compositionHeight={out.height}
        style={{ width: 540, height: 960 }}
        initialFrame={still ?? 0}
        controls={still === null}
        autoPlay={still === null}
        loop
        acknowledgeRemotionLicense
      />
    </main>
  );
}
