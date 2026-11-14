// Fase 25: rig karakter 2D dari satu gambar bahan (ilustrasi berdiri, latar polos). Dibuat apps/worker/py/rig.py,
// dipakai komponen Character di komposisi: gambar ASLI dipotong (clip-path) menjadi kepala/badan/kaki dan digerakkan.
// Latar dibuang dengan topeng alfa (data URL kecil), jadi tidak ada berkas baru yang perlu disajikan. Murni (tanpa Node).
import { z } from "zod";

const Pt = z.object({ x: z.number(), y: z.number() });
export const RigSchema = z.object({
  version: z.literal(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Kotak karakter (tanpa latar dan bayangan lantai), piksel gambar asli. */
  box: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }),
  /** Garis leher: kepala di atas `y`. l/r = kolom leher (badan sedikit naik di kolom ini agar sambungan tertutup saat kepala bergerak). */
  neck: z.object({ y: z.number(), l: z.number(), r: z.number(), cx: z.number() }),
  /** null = kedua kaki menyatu di gambar (gerak jalan memakai seluruh badan). */
  legs: z.object({ hip: z.number(), split: z.number() }).nullable(),
  /** null = wajah tidak terdeteksi (tanpa kedip). */
  eyes: z.array(Pt.extend({ rx: z.number().positive(), ry: z.number().positive() })).max(2).nullable(),
  /** null = mulut tidak terdeteksi dengan yakin (tanpa gerak mulut). */
  mouth: Pt.extend({ w: z.number().positive() }).nullable(),
  skin: z.string().regex(/^#[0-9a-f]{6}$/i).nullable(),
  /** PNG grayscale (putih = karakter), resolusi bebas; diregangkan ke ukuran gambar. */
  mask: z.string().startsWith("data:image/png;base64,").max(400_000),
  notes: z.array(z.string()).default([]),
});
export type CharacterRig = z.infer<typeof RigSchema>;

export const parseRig = (raw: unknown): CharacterRig | null => {
  const r = RigSchema.safeParse(raw);
  return r.success ? r.data : null;
};

export const rigRel = (projectId: string, assetId: string) => `projects/${projectId}/rig/${assetId}.json`;
