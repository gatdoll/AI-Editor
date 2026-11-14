// Fase 17: uji asap tanpa database. Rekaman + naskah -> Codex CLI -> VoxCPM2 -> Whisper -> render MP4 komposisi Motion.
// Jalankan: node --env-file=.env apps/worker/src/voiceover-smoke.ts <rekaman> "<transkrip rekaman>" ["<naskah>"]
// Butuh `npm run setup:voiceover` sekali. Di CPU memakan belasan menit.
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { STYLES } from "@app/config";
import { resolveMediaPath } from "@app/shared";
import { voiceoverAudioPath, voiceProfileAudioPath } from "@app/shared/voiceover-store";
import { buildMotionProps, VOICEOVER_ID } from "../../../packages/remotion/src/motion-props.ts";
import { renderMotion } from "./render.ts";
import { REPO_ROOT } from "./creative/workdir.ts";
import { produceVoiceover } from "./voiceover.ts";

const OVERLAY = `import { AbsoluteFill, useCurrentFrame } from "remotion";
export default function CreativeOverlay({ data }) {
  const t = useCurrentFrame() / data.fps;
  const w = data.words.filter((x) => x.start <= t).slice(-1)[0];
  return <AbsoluteFill style={{ background: "#0B0D0F", color: "#fff", alignItems: "center", justifyContent: "center", fontFamily: data.fonts.montserrat, fontSize: 96, fontWeight: 800 }}>{w ? w.text : ""}</AbsoluteFill>;
}`;

const [recording, recordingText, scriptArg] = process.argv.slice(2);
if (!recording || !recordingText) throw new Error("Pakai: voiceover-smoke.ts <rekaman> \"<transkrip rekaman>\" [\"<naskah>\"]");
const script = scriptArg ?? "Tugas yang biasanya memakan waktu 3 jam, sekarang selesai dalam 10 menit. Hemat 80% waktu kerjamu dengan AI.";
const projectId = randomUUID(), jobId = randomUUID(), profileId = randomUUID();
const profileFile = voiceProfileAudioPath(profileId);
await mkdir(path.dirname(profileFile), { recursive: true });
await copyFile(recording, profileFile);
const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(0)}s]`;
try {
  const info = await produceVoiceover({
    projectId, jobId, script, profile: { id: profileId, text: recordingText, durationS: 0, createdAt: "" },
    onStage: (s, d) => console.log(stamp(), s, d ?? ""),
  });
  console.log(JSON.stringify({ direction: info.direction, model: info.directionModel, durationS: info.durationS, note: info.note, readingText: info.readingText, words: info.words.length }, null, 1));
  console.log("Whisper:", info.words.map((w) => w.text).join(" "));
  const out = path.join(REPO_ROOT, "out", "voiceover-smoke.mp4");
  await mkdir(path.dirname(out), { recursive: true });
  const r = await renderMotion({
    materials: [{ id: VOICEOVER_ID, file: voiceoverAudioPath(projectId, jobId), type: "audio/mp4" }], outFile: out, onProgress: () => {},
    props: (srcFor) => buildMotionProps({ aspect: "16:9", settings: { durationS: 3 }, colors: STYLES.bersih.colors, materials: [], srcFor, overlay: OVERLAY, voiceover: info }),
  });
  console.log(`OK ${out} (${r.durationInFrames} frame, total ${((Date.now() - t0) / 1000).toFixed(0)} dtk)`);
} finally {
  await rm(profileFile, { force: true });
  await rm(resolveMediaPath(`projects/${projectId}`), { recursive: true, force: true });
}
