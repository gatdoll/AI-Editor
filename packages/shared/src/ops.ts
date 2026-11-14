// Operasi hasil terjemahan prompt (murni, aman di browser dan Node).
// LLM hanya MENERJEMAHKAN kalimat pengguna menjadi operasi dari himpunan tertutup ini.
// Kode kita yang memvalidasi dan menerapkannya; operasi yang tidak valid ditolak dan dilaporkan.
import { z } from "zod";
import { ALL_PRESETS, ASPECT_IDS, LIMITS, MOTION, STYLES, TITLE_ANIMS } from "@app/config";

export const OP_TYPES = [
  "propose_cut_phrase",
  "propose_cut_time",
  "propose_pauses",
  "set_style",
  "emphasize_phrase",
  "highlight_phrase",
  "auto_highlight",
  "camera_at",
  "add_title",
  "clear_titles",
  "add_sfx",
  "clear_sfx",
  "set_param",
  "reset_param",
  "fix_word",
  "render",
  "undo_last",
  "answer",
] as const;
export type OpType = (typeof OP_TYPES)[number];

const STYLE_IDS = Object.keys(STYLES) as [keyof typeof STYLES, ...(keyof typeof STYLES)[]];
const ASPECTS = ASPECT_IDS;
const PRESETS = ALL_PRESETS;

const reason = z.string().trim().max(200).optional();
const phrase = z.string().trim().min(1).max(200);

export const OpSchema = z.discriminatedUnion("type", [
  // Potong semua kemunculan frasa (atau kalimat yang memuatnya). Hanya MENGUSULKAN (aturan 2).
  z.object({ type: z.literal("propose_cut_phrase"), phrase, scope: z.enum(["phrase", "sentence"]).default("phrase"), reason }),
  // Potong rentang waktu mentah. Hanya mengusulkan.
  z.object({ type: z.literal("propose_cut_time"), startS: z.number().min(0), endS: z.number().min(0), reason }),
  // Usulkan pemotongan jeda diam lebih panjang dari minSec. Hanya mengusulkan.
  z.object({ type: z.literal("propose_pauses"), minSec: z.number().min(0.2).max(30), keepSec: z.number().min(0).max(2).optional() }),
  z.object({
    type: z.literal("set_style"),
    styleId: z.enum(STYLE_IDS).optional(),
    aspect: z.enum(ASPECTS).optional(),
    camera: z.boolean().optional(),
    captions: z.boolean().optional(),
    effects: z.boolean().optional(),
  }).refine((o) => o.styleId !== undefined || o.aspect !== undefined || o.camera !== undefined || o.captions !== undefined || o.effects !== undefined, "set_style tanpa perubahan"),
  // Kamera zoom saat frasa diucapkan.
  z.object({ type: z.literal("emphasize_phrase"), phrase, preset: z.enum(PRESETS).default("zoom-point") }),
  // Kata kunci di subtitle: aksen (1.3x + kotak menyapu) atau slam (banting 3x -> 1x + guncangan).
  z.object({ type: z.literal("highlight_phrase"), phrase, effect: z.enum(["aksen", "slam"]).default("aksen") }),
  // Kata kunci dipilih KODE dari transkrip (angka, kata bermakna); slam untuk yang terkuat; punch = zoom kamera di slam.
  z.object({ type: z.literal("auto_highlight"), density: z.enum(["jarang", "sedang", "sering"]).default("sedang"), slamCount: z.number().int().min(0).max(3).default(1), punch: z.boolean().default(true) }),
  z.object({ type: z.literal("camera_at"), startS: z.number().min(0), endS: z.number().min(0), preset: z.enum(PRESETS) }).refine((o) => o.endS > o.startS, "akhir kamera harus setelah awal"),
  // text kosong hanya untuk hook: kode mengambil kata yang diucapkan pada rentang itu.
  z.object({ type: z.literal("add_title"), text: z.string().trim().max(MOTION.title.maxChars).default(""), subtext: z.string().trim().max(MOTION.title.maxChars).optional(), startS: z.number().min(0), endS: z.number().min(0), animation: z.enum(TITLE_ANIMS), position: z.enum(["atas", "tengah"]).default("tengah") })
    .refine((o) => o.endS > o.startS && o.endS - o.startS <= MOTION.title.maxDurationSec, "durasi judul harus 0–20 detik")
    .refine((o) => o.text.length > 0 || o.animation === "hook", "teks judul kosong"),
  z.object({ type: z.literal("clear_titles") }),
  // Fase 14: efek suara dari pustaka. `sound` = nama/id/tag; di awal tiap kemunculan `phrase` ATAU di `startS` (detik SUMBER).
  z.object({ type: z.literal("add_sfx"), sound: z.string().trim().min(1).max(60), phrase: phrase.optional(), startS: z.number().min(0).optional(), volume: z.number().min(0).max(1).optional() })
    .refine((o) => !!o.phrase !== (o.startS !== undefined), "add_sfx butuh phrase ATAU startS (salah satu)"),
  z.object({ type: z.literal("clear_sfx") }),
  // Ubah satu pengaturan dari registri parameter (params.ts). value selalu string; kode memvalidasi menurut jenisnya.
  z.object({ type: z.literal("set_param"), paramId: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(60) }),
  // Kembalikan satu pengaturan ke bawaan gaya, atau semuanya bila paramId = "semua".
  z.object({ type: z.literal("reset_param"), paramId: z.string().trim().min(1).max(60) }),
  // Perbaiki ejaan satu kata di transkrip (tidak memotong apa pun).
  z.object({ type: z.literal("fix_word"), from: z.string().trim().min(1).max(60), to: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal("render"), aspect: z.enum(ASPECTS).optional() }),
  z.object({ type: z.literal("undo_last") }),
  z.object({ type: z.literal("answer") }),
]);
export type Op = z.infer<typeof OpSchema>;

/**
 * Skema keluaran untuk CLI (mode ketat: semua properti wajib, boleh null).
 * Bentuk datar; `normalizeOps` mengubahnya menjadi `Op` yang tervalidasi.
 */
export const LLM_OPS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ops", "reply", "unsupported"],
  properties: {
    ops: {
      type: "array",
      maxItems: LIMITS.promptOperations,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "phrase", "scope", "reason", "startS", "endS", "minSec", "keepSec", "styleId", "aspect", "camera", "captions", "effects", "preset", "from", "to", "paramId", "value", "text", "subtext", "animation", "position", "effect", "density", "slamCount", "punch", "sound", "volume"],
        properties: {
          type: { type: "string", enum: [...OP_TYPES] },
          phrase: { type: ["string", "null"] },
          scope: { type: ["string", "null"], enum: ["phrase", "sentence", null] },
          reason: { type: ["string", "null"] },
          startS: { type: ["number", "null"] },
          endS: { type: ["number", "null"] },
          minSec: { type: ["number", "null"] },
          keepSec: { type: ["number", "null"] },
          styleId: { type: ["string", "null"], enum: [...STYLE_IDS, null] },
          aspect: { type: ["string", "null"], enum: [...ASPECTS, null] },
          camera: { type: ["boolean", "null"] },
          captions: { type: ["boolean", "null"] },
          effects: { type: ["boolean", "null"] },
          preset: { type: ["string", "null"], enum: [...PRESETS, null] },
          from: { type: ["string", "null"] },
          to: { type: ["string", "null"] },
          paramId: { type: ["string", "null"] },
          value: { type: ["string", "null"] },
          text: { type: ["string", "null"] },
          subtext: { type: ["string", "null"] },
          animation: { type: ["string", "null"], enum: [...TITLE_ANIMS, null] },
          position: { type: ["string", "null"], enum: ["atas", "tengah", null] },
          effect: { type: ["string", "null"], enum: ["aksen", "slam", null] },
          density: { type: ["string", "null"], enum: ["jarang", "sedang", "sering", null] },
          slamCount: { type: ["integer", "null"] },
          punch: { type: ["boolean", "null"] },
          sound: { type: ["string", "null"] },
          volume: { type: ["number", "null"] },
        },
      },
    },
    reply: { type: "string" },
    // Bagian permintaan yang tidak bisa dijalankan dengan operasi/katalog ini, masing-masing satu kalimat pendek.
    unsupported: { type: "array", maxItems: 12, items: { type: "string" } },
  },
} as const;

type FlatOp = Record<string, unknown>;

export type NormalizedOps = {
  ops: Op[];
  /** Operasi yang ditolak beserta alasannya (ditampilkan ke pengguna, tidak dijalankan). */
  rejected: Array<{ raw: FlatOp; reason: string }>;
};

/** Buang nilai null/undefined, lalu validasi dengan skema ketat. */
export function normalizeOps(flat: FlatOp[], maxOps: number = LIMITS.promptOperations): NormalizedOps {
  // Never execute an arbitrary prefix: omitted operations may change the meaning of the edit.
  if (flat.length > maxOps) return {
    ops: [],
    rejected: [{ raw: {}, reason: `Perintah menghasilkan ${flat.length} operasi (maksimal ${maxOps}). Tidak ada operasi yang dijalankan; ringkas permintaan atau bagi menjadi dua perintah.` }],
  };
  const ops: Op[] = [];
  const rejected: NormalizedOps["rejected"] = [];
  for (const raw of flat) {
    const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined));
    const r = OpSchema.safeParse(cleaned);
    if (r.success) ops.push(r.data);
    else rejected.push({ raw, reason: r.error.issues.map((i) => `${i.path.join(".") || "op"}: ${i.message}`).join("; ") });
  }

  // Dalam satu perintah hanya satu undo dan satu render yang masuk akal
  const seen = new Set<string>();
  const unique = ops.filter((o) => {
    if (o.type === "undo_last" || o.type === "render") {
      if (seen.has(o.type)) return false;
      seen.add(o.type);
    }
    return true;
  });
  // undo_last tidak boleh digabung dengan operasi lain (ambigu: batalkan sebelum atau sesudah?)
  if (unique.some((o) => o.type === "undo_last") && unique.length > 1) {
    return {
      ops: [],
      rejected: [...rejected, { raw: {}, reason: "'batalkan' tidak bisa digabung dengan perintah lain. Kirim 'batalkan' sendiri." }],
    };
  }
  return { ops: unique, rejected };
}
