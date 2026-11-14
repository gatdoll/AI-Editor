// Logika murni EDL -> frame. Dipakai komposisi, Root (durasi), dan worker, supaya satu rumus.

export type TimeSegment = { start: number; end: number };

export type FrameSegment = {
  /** Frame sumber tempat segmen mulai/berakhir (eksklusif). */
  srcFrom: number;
  srcTo: number;
  /** Posisi segmen pada timeline hasil. */
  at: number;
  length: number;
  /** Apakah segmen berawal/berakhir di tepi file mentah (tidak perlu fade di sana). */
  atFileStart: boolean;
  atFileEnd: boolean;
};

/**
 * Ubah segmen detik menjadi segmen frame. Batas dibulatkan ke frame terdekat;
 * segmen yang jadi 0 frame dibuang. Total durasi = jumlah `length`.
 */
export function toFrameSegments(segments: TimeSegment[], fps: number, sourceSeconds?: number): FrameSegment[] {
  const out: FrameSegment[] = [];
  let at = 0;
  const lastFrame = sourceSeconds != null ? Math.round(sourceSeconds * fps) : Infinity;
  for (const s of segments) {
    const srcFrom = Math.max(0, Math.round(s.start * fps));
    const srcTo = Math.min(lastFrame, Math.round(s.end * fps));
    const length = srcTo - srcFrom;
    if (length <= 0) continue;
    out.push({ srcFrom, srcTo, at, length, atFileStart: srcFrom === 0, atFileEnd: srcTo >= lastFrame });
    at += length;
  }
  return out;
}

export function totalFrames(segments: FrameSegment[]): number {
  return segments.reduce((n, s) => n + s.length, 0);
}
