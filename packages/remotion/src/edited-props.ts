// Tipe props komposisi "Edited" (murni, tanpa JSX) agar bisa diimpor worker dan browser.
import { ASPECTS, STYLES, VIDEO, type AspectId, type CaptionAnim, type StyleDef, type StyleId } from "@app/config";
import type { MotionDesign } from "./motion-plan.ts";
import type { MotionTitle } from "./title-plan.ts";
import type { CamMove } from "./camera-plan.ts";
import type { FxPlan } from "./fx-plan.ts";
import type { CreativeAsset, CreativeCode, CreativeFace, CreativeFontFile, CreativeWord } from "./creative/contract.ts";
import type { TextFx } from "./build-props.ts";
import type { CaptionPage } from "./captions.ts";
import type { TimeSegment } from "./frames.ts";
import type { Transform, ManualEdit } from "../../shared/src/manual.ts";
import type { FaceSample } from "../../shared/src/talent.ts";

export type VideoEdit = { transform: Transform; keyframes: ManualEdit["keyframes"]; flipX: boolean; flipY: boolean; brightness: number; contrast: number; saturation: number; volume: number; muted: boolean; fadeIn: number; fadeOut: number };

export type EditedProps = {
  /** Mode Kreatif (Fase 9): kode buatan AI + kata pada timeline hasil. */
  creative?: CreativeCode & { /** Fase 24: posisi wajah (px kanvas, timeline hasil) untuk kode AI. */ faces?: CreativeFace[]; words: CreativeWord[]; /** Detik hasil tempat lapisan tampil. Tidak ada = seluruh video. */ ranges?: Array<{ start: number; end: number }>; /** Fase 15: gambar/logo pengguna (src diisi pemanggil). */ assets?: CreativeAsset[] };
  /** Fase 18: klip motion penutup, diputar SESUDAH semua segmen EDL dan menambah durasi hasil. `assets[].src` diisi pemanggil. */
  endClip?: { frames: number; overlay: string; background: string; assets?: CreativeAsset[]; fonts?: CreativeFontFile[] };
  /** Transisi, guncangan, dan dutch tilt (detik hasil). */
  fx?: FxPlan;
  /** Font, skala awal pop, dan cara teks keluar. */
  textFx?: TextFx;
  videoEdit?: VideoEdit;
  titles?: MotionTitle[];
  /** URL http(s) ke file mentah. File mentah hanya dibaca (aturan 1). */
  motion?: MotionDesign;
  src: string;
  /** Fase 14: efek suara. `from` = frame hasil; `src` diisi pemanggil (pratinjau: rute web, render: server lokal). */
  sfx?: Array<{ id: string; src: string; from: number; volume: number; frames: number }>;
  /**
   * Fase 16: video project (sumbu reel). Ada = tiap segmen memutar file yang memuat waktunya: waktu lokal = waktu reel - offset.
   * `src`/`audioSrc` diisi pemanggil (pratinjau: rute web; render: server lokal). Tidak ada = satu file `src` (data lama).
   */
  sources?: Array<{ id: string; src: string; audioSrc?: string; offset: number; duration: number; focusX?: number;
    /** Fase 24: video yang sama dengan latar transparan (VP9+alpha); diisi pemanggil bila talent sudah disiapkan. */ talentSrc?: string }>;
  /** Fase 24: kotak wajah per video sumber (id = id video; waktu file). Untuk blur wajah di ruang video. */
  talent?: Record<string, { width: number; height: number; samples: FaceSample[] }>;
  /** Fase 11: URL audio hasil reduksi noise (timeline sama dengan file mentah). Ada = audio video dibisukan, audio ini yang diputar. */
  denoisedSrc?: string;
  /** Segmen yang DIPERTAHANKAN dari EDL, dalam detik. */
  segments: TimeSegment[];
  /** Durasi file mentah (detik), untuk mengenali tepi file. */
  sourceSeconds: number;
  /** Fade audio di tiap sambungan (frame) agar tidak ada bunyi klik. */
  fadeFrames: number;
  /** Ukuran dan fps OUTPUT. Dipakai calculateMetadata di Root. */
  width: number;
  height: number;
  fps: number;
  /** Titik fokus horizontal (0..1) saat sumber dipotong ke rasio yang lebih sempit. */
  focusX: number;
  /** Titik fokus vertikal (0..1). Tidak ada = 0,5. */
  focusY?: number;
  aspect: AspectId;
  styleId: StyleId;
  /** Gaya final: bawaan gaya ditimpa pengaturan pengguna (warna, tebal, efek...). */
  style: StyleDef;
  /** Pengali ukuran teks subtitle. */
  textScale: number;
  /** Jarak subtitle dari bawah (pecahan tinggi layar); null = zona aman otomatis. */
  textBottom: number | null;
  /** false = pengguna tidak mengikuti safe area platform (jarak tepi biasa). Tidak ada = ikuti. */
  safeArea?: boolean;
  /** Animasi teks yang dipakai (sudah diputuskan: pilihan pengguna atau bawaan gaya). */
  captionAnim: CaptionAnim;
  /** Rencana kamera dari EDL (detik pada timeline hasil). */
  camera: CamMove[];
  /** Halaman subtitle (detik pada timeline hasil). */
  pages: CaptionPage[];
  showCamera: boolean;
  showCaptions: boolean;
  showEffects: boolean;
};

export const editedDefaults: EditedProps = {
  src: "",
  segments: [{ start: 0, end: 1 }],
  sourceSeconds: 1,
  fadeFrames: 2,
  width: ASPECTS["16:9"].width,
  height: ASPECTS["16:9"].height,
  fps: VIDEO.fps,
  focusX: 0.5,
  aspect: "16:9",
  styleId: "bersih",
  style: STYLES.bersih,
  textScale: 1,
  textBottom: null,
  captionAnim: "sorot",
  camera: [],
  pages: [],
  showCamera: true,
  showCaptions: true,
  showEffects: true,
};
