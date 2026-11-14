// Fase 14: efek suara. Tiap isyarat = satu <Audio> pendek mulai di frame-nya. Tidak dipengaruhi kamera atau kode AI.
import { Audio, Sequence } from "remotion";
import type { SfxProp } from "../sfx-props.ts";

export const SfxTrack = ({ cues }: { cues?: SfxProp[] }) => (
  <>{(cues ?? []).map((c, i) => <Sequence key={`${c.id}-${c.from}-${i}`} from={c.from} durationInFrames={c.frames} layout="none" name={`SFX ${c.id}`}><Audio src={c.src} volume={c.volume} /></Sequence>)}</>
);
