// Pemilihan frame still pratinjau dan pemeriksaan hasil render (murni, tanpa renderer).
import type { CreativeWord } from "../../../../packages/remotion/src/creative/contract.ts";

export type StillFrame = { label: "awal" | "tengah" | "sambungan" | "akhir"; frame: number };

/**
 * Empat frame uji: awal, tengah, sambungan cut, akhir. Diletakkan di tengah kata bila ada kata,
 * karena overlay tipografi biasanya hanya tampil saat ada ucapan. Tanpa sambungan, frame ketiga
 * diambil di seperempat video. Frame kembar dibuang.
 */
export function pickStillFrames(a: { durationInFrames: number; fps: number; words: CreativeWord[]; joins: number[]; joinOffsetFrames: number }): StillFrame[] {
  const last = Math.max(0, a.durationInFrames - 1);
  const clamp = (f: number) => Math.min(last, Math.max(0, Math.round(f)));
  const mid = (w: CreativeWord) => ((w.start + w.end) / 2) * a.fps;
  const nearest = (t: number) => {
    let best: CreativeWord | null = null;
    for (const w of a.words) if (!best || Math.abs(mid(w) - t) < Math.abs(mid(best) - t)) best = w;
    return best ? mid(best) : t;
  };
  const words = a.words.length > 0;
  // Sambungan yang terlalu dekat awal/akhir video tertumpuk dengan frame awal/akhir: pilih yang di tengah bila ada
  const edge = a.fps;
  const join = a.joins.find((j) => j * a.fps >= edge && j * a.fps <= last - edge) ?? a.joins[0];
  const candidates: StillFrame[] = [
    { label: "awal", frame: clamp(words ? mid(a.words[0]) : a.fps * 0.5) },
    { label: "tengah", frame: clamp(nearest(last / 2)) },
    { label: "sambungan", frame: clamp(join !== undefined ? join * a.fps + a.joinOffsetFrames : nearest(last / 4)) },
    { label: "akhir", frame: clamp(words ? mid(a.words[a.words.length - 1]) : last - a.fps * 0.5) },
  ];
  const seen = new Set<number>();
  return candidates.filter((c) => (seen.has(c.frame) ? false : (seen.add(c.frame), true)));
}

/** Ambil pesan error kode kreatif dari log browser renderer ("[kreatif] overlay: ..."). */
export function creativeErrorsFromLogs(logs: string[]): string[] {
  return [...new Set(logs.filter((l) => l.includes("[kreatif]")).map((l) => l.slice(l.indexOf("[kreatif]") + 9).trim()))];
}
