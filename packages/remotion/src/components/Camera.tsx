import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { cameraStateAt, driftAt, type CamMove } from "../camera-plan.ts";

/**
 * Membungkus scene dan menggerakkan scale/translate/rotate sesuai rencana kamera.
 * Semua gerakan memakai easing (easeCamera), tidak ada yang linear. Subtitle TIDAK boleh
 * menjadi anak komponen ini (aturan 4): ia berada di layer terpisah di atasnya.
 */
export const Camera = ({ moves, enabled, children }: { moves: CamMove[]; enabled: boolean; children: React.ReactNode }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (!enabled) return <AbsoluteFill>{children}</AbsoluteFill>;
  const t = frame / fps;
  const s = cameraStateAt(moves, t);
  const d = driftAt(t);
  return (
    <AbsoluteFill
      style={{
        transformOrigin: "50% 50%",
        transform: `translate(${s.x * width + d.dx}px, ${s.y * height + d.dy}px) rotate(${s.rot}deg) scale(${s.scale})`,
        willChange: "transform",
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
