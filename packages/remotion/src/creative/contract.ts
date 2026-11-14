// Kontrak Mode Kreatif (Fase 9): data yang diterima kode buatan AI, dan bentuk kodenya.
// Murni (tanpa JSX), dipakai komposisi, worker, dan dokumen kontrak untuk AI.
import { SAFE_AREA, type AspectId } from "@app/config";
import type { AssetCue } from "../../../shared/src/opinion.ts";
import type { CharacterRig } from "../../../shared/src/rig.ts";

/** Satu kata pada timeline HASIL (sesudah cut), detik. hl = kata kunci yang ditandai pengguna/otomatis. */
export type CreativeWord = { text: string; start: number; end: number; hl?: "aksen" | "slam" };

/** Data project yang boleh dibaca kode kreatif. Tidak ada URL, kunci, atau akses jaringan. */
export type CreativeData = {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  aspect: AspectId;
  words: CreativeWord[];
  /** Waktu sambungan cut pada timeline hasil (detik). */
  joins: number[];
  colors: { text: string; accent: string; dark: string };
  /** Nama keluarga font yang SUDAH dimuat (pakai di fontFamily). montserrat: 500/800, inter: 500/900, jakarta: 500/800. */
  fonts: { jakarta: string; montserrat: string; inter: string };
  /** Fase 13: "motion" = motion graphics tanpa rekaman (kanvas kosong); "video" = lapisan di atas video bicara. */
  mode?: "video" | "motion";
  /** Bahan yang diunggah pengguna. `src` = URL saat render/pratinjau (pakai di <Img src>); `file` = salinan di folder kerja untuk DILIHAT. */
  assets?: CreativeAsset[];
  /** Data/angka dari pengguna untuk dianimasikan (grafik, counter). Baris pertama CSV = judul kolom. */
  table?: { columns: string[]; rows: Array<Array<string | number>> };
  /** Fase 19: project Opinion Motion. kredit = wajib menampilkan `prefix + asset.cue.source` pada tiap aset internet. */
  opini?: { kredit: boolean; prefix: string };
  /**
   * Fase 23: safe area platform dalam PIKSEL dari tiap tepi (9:16 = UI Reels/TikTok: atas, caption di bawah, tombol like di kanan).
   * Teks, wajah, logo, dan aset penting harus di dalam kotak ini; latar dan dekorasi boleh sampai tepi.
   */
  safeArea: SafeArea;
  /**
   * Fase 24: talent sudah dipisahkan dari latar (ada = `export function Behind` dan `export function faceBlur` aktif).
   * Posisi wajah terbesar dalam PIKSEL kanvas, satu sampel tiap ±0,2 dtk timeline hasil (perkiraan tanpa gerak kamera).
   */
  faces?: CreativeFace[];
};

/** Kotak wajah pada detik `t` timeline hasil, piksel kanvas. */
export type CreativeFace = { t: number; x: number; y: number; w: number; h: number };

export type SafeArea = { top: number; bottom: number; left: number; right: number };

/** Safe area rasio ini dalam piksel (dibulatkan). Dipakai semua tempat yang menyusun CreativeData. */
export function safeAreaPx(aspect: AspectId, width: number, height: number): SafeArea {
  const a = SAFE_AREA[aspect] ?? SAFE_AREA["16:9"];
  return { top: Math.round(a.top * height), bottom: Math.round(a.bottom * height), left: Math.round(a.left * width), right: Math.round(a.right * width) };
}

export type CreativeAsset = { id: string; name: string; type: "image" | "audio"; src: string; file?: string; width?: number; height?: number; durationS?: number;
  /** Fase 15: "logo" = tampilkan file ini apa adanya, jangan digambar ulang. */ role?: "logo" | "gambar";
  /** Fase 19: aset internet pilihan pengguna (Opinion Motion): tampil saat `start`–`end` (detik ucapan), `source` untuk kredit. */ cue?: AssetCue;
  /** Fase 25: karakter ber-rig: tampilkan dengan <Character asset={...} /> dari modul "character" agar bisa bergerak. */ rig?: CharacterRig };

/** Props satu-satunya komponen overlay: `export default function Overlay({ data }: CreativeProps)`. */
export type CreativeProps = { data: CreativeData };

/**
 * Kode kreatif (string TSX, masing-masing satu `export default`):
 * - overlay: komponen React `({ data }: { data: CreativeData }) => JSX`, layer layar-tetap di atas video.
 * - video: fungsi murni `(frame: number, data: CreativeData) => { transform?, filter?, opacity? }` untuk gerakan video.
 * - replacesCaptions: overlay menggambar teksnya sendiri, subtitle bawaan disembunyikan.
 */
export type CreativeCode = { overlay?: string; video?: string; replacesCaptions?: boolean; /** Fase 24: font tambahan versi ini (dimuat sebelum frame dirender). */ fonts?: CreativeFontFile[] };

/** Fase 24: satu file font tambahan. `src` diisi pemanggil (pratinjau: rute web; render: server lokal). */
export type CreativeFontFile = { id: string; family: string; weight: number; src: string };

/** Yang dikembalikan fungsi `video`. Selain kunci ini diabaikan. */
export type CreativeVideoStyle = { transform?: string; filter?: string; opacity?: number };
