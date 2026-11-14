// Fase 24: data talent (pemisahan orang dari latar + kotak wajah). Murni (tanpa fs): dipakai komposisi, web, worker, tes.
// File: projects/<pid>/talent/<assetId>.webm (VP9 + alpha, waktu = waktu file mentah) dan <assetId>.faces.json.

/** Satu sampel wajah: [detik file, x, y, w, h, skor] (pecahan lebar/tinggi frame sumber); x = null bila tidak ada wajah. */
export type FaceSample = [number, number | null, number | null, number | null, number | null, number];
export type TalentFaces = { version: 1; fps: number; width: number; height: number; frames: number; every: number; samples: FaceSample[] };
export type FaceBox = { x: number; y: number; w: number; h: number };

export const talentRel = (projectId: string, assetId: string) => `projects/${projectId}/talent/${assetId}.webm`;
export const facesRel = (projectId: string, assetId: string) => `projects/${projectId}/talent/${assetId}.faces.json`;

/** Validasi ringan isi faces.json (berkas buatan worker; tetap dicek sebelum dipakai). */
export function parseFaces(raw: unknown): TalentFaces | null {
  const f = raw as TalentFaces;
  if (!f || f.version !== 1 || !(f.width > 0) || !(f.height > 0) || !(f.fps > 0) || !Array.isArray(f.samples)) return null;
  return { ...f, samples: f.samples.filter((s) => Array.isArray(s) && s.length >= 6 && Number.isFinite(s[0])) };
}

/**
 * Kotak wajah pada detik `t` file sumber (pecahan). Interpolasi linear antara dua sampel berwajah terdekat; tidak ada wajah
 * di sekitar (lebih dari `maxGap` detik) = null. Sampel urut waktu.
 */
export function faceAt(samples: FaceSample[], t: number, maxGap = 0.5): FaceBox | null {
  if (!samples.length) return null;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (samples[mid][0] <= t) lo = mid; else hi = mid - 1; }
  const a = samples[lo], b = samples[Math.min(samples.length - 1, lo + 1)];
  const ok = (s: FaceSample) => s[1] !== null && Math.abs(s[0] - t) <= maxGap;
  const box = (s: FaceSample): FaceBox => ({ x: s[1]!, y: s[2]!, w: s[3]!, h: s[4]! });
  if (ok(a) && ok(b) && b[0] > a[0]) {
    const k = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    const A = box(a), B = box(b);
    return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, w: A.w + (B.w - A.w) * k, h: A.h + (B.h - A.h) * k };
  }
  if (ok(a)) return box(a);
  if (ok(b)) return box(b);
  return null;
}

/**
 * Kotak sumber (pecahan) -> piksel kanvas untuk video yang ditampilkan `objectFit: cover` dengan titik fokus (sama dengan
 * komposisi Edited). Tanpa gerak kamera: cukup untuk menaruh teks; blur wajah dihitung di ruang video (ikut kamera).
 */
export function coverBox(box: FaceBox, src: { width: number; height: number }, out: { width: number; height: number }, focusX: number, focusY: number): FaceBox {
  const scale = Math.max(out.width / src.width, out.height / src.height);
  const dw = src.width * scale, dh = src.height * scale;
  const ox = (out.width - dw) * focusX, oy = (out.height - dh) * focusY;
  return { x: ox + box.x * dw, y: oy + box.y * dh, w: box.w * dw, h: box.h * dh };
}
