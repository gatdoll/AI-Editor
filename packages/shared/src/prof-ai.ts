// Fase 27: Prof. AI, karakter tetap untuk project Animasi. Set gambar di MEDIA_DIR/karakter/prof-ai/ (satu untuk semua project),
// rig dibuat sekali oleh apps/worker/py/prof_ai_rig.py (`npm run setup:prof-ai`) dan diperiksa pengguna lewat check.png.
// Murni (tanpa Node): dipakai worker, rute web, dan komposisi.
import { z } from "zod";

export const PROF_AI_DIR = "karakter/prof-ai";
export const PROF_AI_RIG_FILE = `${PROF_AI_DIR}/character.json`;
/** Awalan id berkas yang disajikan (render: server lokal; pratinjau: rute web). */
export const PROF_AI_SRC_PREFIX = "profai:";

/** Semua berkas gambar yang boleh disajikan. Rute dan server hanya menyajikan nama di daftar ini. */
export const PROF_AI_FILES = [
  "front-tpose.png", "threequarter-tpose.png", "back-tpose.png", "side-arms-down.png",
  "front-blink.png", "mouth-closed.png", "mouth-small.png", "mouth-wide.png", "mouth-o.png",
  "expr-happy.png", "expr-surprised.png", "expr-thinking.png", "expr-serious.png",
  // Avatar mesh (mesh-avatar-studio): tampak depan tangan turun, kepala menoleh 3D, rambut/badan/kaki/lengan ber-fisika
  "prof-ai.mavatar",
] as const;
/** Avatar mesh tampak depan (mesh-avatar-studio, WebGL). */
export const PROF_AI_MESH: ProfAiFile = "prof-ai.mavatar";
export type ProfAiFile = (typeof PROF_AI_FILES)[number];
export const isProfAiFile = (f: string): f is ProfAiFile => (PROF_AI_FILES as readonly string[]).includes(f);

const Box = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const Arm = z.object({
  /** Kolom potong di ketiak: lengan = bagian di luar kolom ini. */
  cut: z.number(),
  top: z.number(),
  bottom: z.number(),
  /** Titik putar bahu. */
  pivot: z.object({ x: z.number(), y: z.number() }),
  /** Ujung jari (kolom terluar). */
  tip: z.number(),
});
const View = z.object({
  file: z.string().refine(isProfAiFile, "berkas tidak dikenal"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  box: Box,
  neck: z.object({ y: z.number(), l: z.number(), r: z.number(), cx: z.number() }),
  /** null = lengan menumpuk badan (tampak samping): tidak dipisah. */
  arms: z.object({ left: Arm, right: Arm }).nullable(),
  /** hip = selangkangan, split = pemisah kaki, hem = ujung bawah jas, jointL/R = kolom sendi pinggul, ankle = pergelangan kaki. */
  legs: z.object({ hip: z.number(), split: z.number(), hem: z.number(), jointL: z.number(), jointR: z.number(), ankle: z.number() }).nullable(),
  /** Mulut sederhana (tampak tanpa varian wajah). Tidak ada = mulut tidak digerakkan di tampak ini. */
  mouth: z.object({ x: z.number(), y: z.number(), w: z.number().positive() }).optional(),
});
export const PROF_AI_VIEWS = ["front", "threequarter", "side", "back"] as const;
export type ProfAiView = (typeof PROF_AI_VIEWS)[number];

export const ProfAiRigSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  views: z.object({ front: View, threequarter: View.optional(), side: View.optional(), back: View.optional() }),
  /** Varian wajah tampak depan (sejajar piksel). split = batas mata (atas) / mulut (bawah). */
  face: z.object({ box: Box, split: z.number().nullable(), files: z.record(z.string(), z.string().refine(isProfAiFile)) }).nullable(),
  /** Avatar mesh tampak depan: gambar persegi `size` px, puncak rambut `top`, telapak kaki `foot`, sumbu badan `cx`. */
  mesh: z.object({ file: z.string().refine(isProfAiFile), size: z.number().positive(), top: z.number(), foot: z.number(), cx: z.number() }).optional(),
  notes: z.array(z.string()).default([]),
});
export type ProfAiRig = z.infer<typeof ProfAiRigSchema>;
export type ProfAiViewRig = z.infer<typeof View>;

export const parseProfAiRig = (raw: unknown): ProfAiRig | null => {
  const r = ProfAiRigSchema.safeParse(raw);
  return r.success ? r.data : null;
};

/** Yang diterima komposisi dan kode AI: rig + URL tiap berkas. */
export type ProfAiData = { rig: ProfAiRig; src: Partial<Record<ProfAiFile, string>> };

/** URL tiap berkas dari `srcFor` pemanggil (id = `profai:<berkas>`). */
export function profAiData(rig: ProfAiRig, srcFor: (id: string) => string): ProfAiData {
  return { rig, src: Object.fromEntries(PROF_AI_FILES.map((f) => [f, srcFor(PROF_AI_SRC_PREFIX + f)])) };
}
