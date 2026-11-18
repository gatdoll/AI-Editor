// Fase 13: motion graphics berdiri sendiri (tanpa rekaman). Props komposisi `Motion` dari gaya project + bahan unggahan.
// Murni, dipakai pratinjau (browser), still dan render (worker), dan brief untuk AI: satu sumber.
import { ASPECTS, END_CLIP, FONTS, MOTION_GFX, OPINION, VIDEO, type AspectId } from "@app/config";
import { safeAreaPx, type CreativeAsset, type CreativeData, type CreativeFontFile } from "./creative/contract.ts";
import { buildSfxProps, type SfxProp } from "./sfx-props.ts";
import type { SfxCue } from "../../shared/src/sfx.ts";
import type { CaptionAnim, StyleDef } from "@app/config";
import type { CaptionPage } from "./captions.ts";
import type { TextFx } from "./build-props.ts";
import { speechSpans, type VoiceoverWord } from "../../shared/src/voiceover.ts";
import type { AssetCue } from "../../shared/src/opinion.ts";
import type { CharacterRig } from "../../shared/src/rig.ts";

export type MotionSettings = {
  /** Durasi video (detik). Diabaikan bila `fitMusic` dan ada musik. */
  durationS: number;
  /** Bahan audio yang diputar sebagai musik/voice over. */
  musicId?: string;
  /** Durasi mengikuti panjang musik. */
  fitMusic?: boolean;
  /** Data/angka sebagai CSV (baris pertama = judul kolom). */
  table?: string;
  /** Project "Animasi": motion bercerita/berkarakter (skill animate-story). Tetap project motion di database. */
  animasi?: true;
  /** Fase 19: project "Opinion Motion": motion + aset internet (foto tokoh, screenshot berita) yang dipilih pengguna. */
  opini?: true;
  /** Opinion Motion: kredit sumber kecil pada tiap aset internet. Tidak diisi = menyala. */
  kredit?: boolean;
  /** Subtitle otomatis dari waktu kata voice over. Tidak diisi = bawaan (`motionSubtitleOn`). */
  subtitle?: boolean;
  /** Volume voice over dan musik (pengali, `MOTION_GFX.audioVolume`). Tidak diisi = bawaan config. */
  voVolume?: number;
  musicVolume?: number;
};

/** Volume yang sah (dijepit ke rentang slider); bukan angka = undefined (pakai bawaan). */
const motionVolume = (raw: unknown): number | undefined => {
  const n = typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n)) return undefined;
  const { min, max } = MOTION_GFX.audioVolume;
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
};

/** Subtitle otomatis aktif? Bawaan: nyala untuk project Animasi dan Opinion Motion, mati untuk motion (motion lama tidak berubah). */
export const motionSubtitleOn = (s: MotionSettings | undefined) => s?.subtitle ?? (s?.animasi === true || s?.opini === true);

export function normalizeMotion(raw: unknown): MotionSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const d = Number(r.durationS);
  const { min, max } = MOTION_GFX.durationS;
  return {
    durationS: Number.isFinite(d) ? Math.min(max, Math.max(min, d)) : MOTION_GFX.durationS.default,
    ...(typeof r.musicId === "string" && /^[0-9a-f-]{36}$/i.test(r.musicId) ? { musicId: r.musicId.toLowerCase() } : {}),
    ...(r.fitMusic === true ? { fitMusic: true } : {}),
    ...(r.animasi === true ? { animasi: true as const } : {}),
    ...(r.opini === true ? { opini: true as const } : {}),
    ...(typeof r.kredit === "boolean" ? { kredit: r.kredit } : {}),
    ...(typeof r.subtitle === "boolean" ? { subtitle: r.subtitle } : {}),
    ...(motionVolume(r.voVolume) !== undefined ? { voVolume: motionVolume(r.voVolume) } : {}),
    ...(motionVolume(r.musicVolume) !== undefined ? { musicVolume: motionVolume(r.musicVolume) } : {}),
    ...(typeof r.table === "string" && r.table.trim() ? { table: r.table.slice(0, MOTION_GFX.table.maxChars) } : {}),
  };
}

/** Fase 18: klip motion penutup sesudah video bicara. `versionId` = versi Mode Kreatif yang ditampilkan. */
export type EndClip = { seconds: number; versionId: string };

/** Detik klip akhir yang sah (dijepit ke rentang, dibulatkan ke langkah). null = bukan angka. */
export function clampEndClipSeconds(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  const { min, max, step } = END_CLIP.seconds;
  return Math.min(max, Math.max(min, Math.round(n / step) * step));
}

export function normalizeEndClip(raw: unknown): EndClip | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const seconds = clampEndClipSeconds(r.seconds);
  if (seconds === null || typeof r.versionId !== "string" || !/^[0-9a-f-]{36}$/i.test(r.versionId)) return undefined;
  return { seconds, versionId: r.versionId.toLowerCase() };
}

/** CSV kecil -> tabel. Angka dikenali (koma/titik ribuan sederhana), sisanya teks. Pemisah: koma, titik koma, atau tab. */
export function parseTable(csv: string | undefined): CreativeData["table"] {
  if (!csv?.trim()) return undefined;
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, MOTION_GFX.table.maxRows + 1);
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const cells = lines.map((l) => l.split(sep).map((c) => c.trim()).slice(0, MOTION_GFX.table.maxCols));
  const num = (c: string) => {
    const n = Number(c.replace(/%$/, "").replace(/\s/g, ""));
    return c !== "" && Number.isFinite(n) ? n : c;
  };
  return { columns: cells[0], rows: cells.slice(1).map((r) => r.map(num)) };
}

/** Penanda audio voice over untuk `srcFor` (bukan id aset). */
export const VOICEOVER_ID = "voiceover";

/** Volume musik pada detik `t`: turun ke `base * level` selama bicara, dengan transisi `rampS` di tepi tiap rentang. */
export function duckedVolume(t: number, base: number, duck: { spans: Array<{ start: number; end: number }>; level: number; rampS: number }): number {
  let amount = 0;
  for (const sp of duck.spans) {
    const distance = t < sp.start ? sp.start - t : t > sp.end ? t - sp.end : 0;
    amount = Math.max(amount, 1 - distance / Math.max(1e-3, duck.rampS));
  }
  return base * (1 - (1 - duck.level) * Math.max(0, amount));
}

/** Bahan unggahan seperti tercatat di tabel aset (kind 'material'). */
export type MaterialInfo = { id: string; label: string; mime: string; width?: number | null; height?: number | null; duration_s?: number | null; /** Fase 15 (gambar saja); "design" = PDF design system, tidak dipakai komposisi. */ role?: "logo" | "gambar" | "design";
  /** Fase 25: rig karakter (gambar saja). */ rig?: CharacterRig;
  /** Fase 19: aset internet pilihan pengguna di Opinion Motion: kapan disebut + sumber. Dipasang web dan worker dari sumber yang sama. */ cue?: AssetCue };

export type MotionProps = {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  aspect: AspectId;
  background: string;
  colors: CreativeData["colors"];
  assets: CreativeAsset[];
  table?: CreativeData["table"];
  /** Musik/voice over diputar komposisi, bukan kode AI. `duck` = volume turun selama voice over berbicara. */
  music?: { src: string; volume: number; duck?: { spans: Array<{ start: number; end: number }>; level: number; rampS: number } };
  /** Fase 17: voice over hasil naskah. `words` = waktu tiap kata (detik) untuk kode AI. */
  voiceover?: { src: string; volume: number; words: VoiceoverWord[] };
  /** Kode versi Mode Kreatif yang ditampilkan. Tidak ada = kanvas kosong (belum ada versi). */
  overlay?: string;
  /** Fase 14: efek suara (frame). */
  sfx?: SfxProp[];
  /** Subtitle otomatis dari voice over (dibangun `motionCaptions` di build-props). Layer di atas kode AI. */
  captions?: MotionCaptions;
  /** Fase 19: Opinion Motion (kredit sumber menyala atau tidak). */
  opini?: CreativeData["opini"];
  /** Fase 24: font tambahan versi aktif (src dari `srcFor("font:<id>")`). */
  fonts?: CreativeFontFile[];
  /** false = pengguna tidak mengikuti safe area platform (param bingkai.safeArea). Tidak ada = ikuti. */
  safeArea?: boolean;
  /** Fase 27: Prof. AI (gambar + rig) untuk <ProfAI>. */
  profAi?: CreativeData["profAi"];
};

export type MotionCaptions = { pages: CaptionPage[]; style: StyleDef; anim: CaptionAnim; textScale: number; textBottom: number | null; textFx: TextFx; safeArea?: boolean };

const isImage = (m: MaterialInfo) => m.mime.startsWith("image/");
const isAudio = (m: MaterialInfo) => m.mime.startsWith("audio/");

/**
 * Props komposisi Motion. `srcFor` = URL bahan untuk lingkungan pemanggil (pratinjau: rute aset web; render: server lokal).
 * `fileFor` (worker) = path salinan bahan di folder kerja AI, agar AI bisa melihat gambarnya.
 */
export function buildMotionProps(a: { aspect: AspectId; settings: MotionSettings | undefined; colors: CreativeData["colors"]; materials: MaterialInfo[]; srcFor: (id: string) => string; fileFor?: (m: MaterialInfo) => string; overlay?: string; fps?: number;
  /** Fase 14: gaya (isyarat SFX + volume master) dan isyarat versi aktif. Waktu motion = waktu hasil (tanpa cut). */
  sfx?: { style: Parameters<typeof buildSfxProps>[0]["style"]; creativeSfx?: SfxCue[] | null; srcFor?: (id: string) => string; lengthFor?: (id: string) => number | undefined };
  /** Fase 17: voice over aktif; `srcFor(VOICEOVER_ID)` = URL audionya. Durasi video mengikuti suara. */
  voiceover?: { durationS: number; words: VoiceoverWord[] } | null;
  /** Subtitle otomatis; hanya dipakai bila ada voice over. */
  captions?: MotionCaptions;
  /** Fase 24: font tambahan versi aktif. URL = srcFor(`font:${id}`). */
  fonts?: Array<{ id: string; family: string; weight: number }>;
  /** false = tidak mengikuti safe area (resolveStyle(style).safeArea). */
  safeArea?: boolean }): MotionProps {
  const s = a.settings ?? { durationS: MOTION_GFX.durationS.default };
  const fps = a.fps ?? VIDEO.fps;
  const out = ASPECTS[a.aspect];
  const music = s.musicId ? a.materials.find((m) => m.id === s.musicId && isAudio(m)) : undefined;
  const { min, max } = MOTION_GFX.durationS;
  const VO = MOTION_GFX.voiceover;
  const durationS0 = a.voiceover
    ? Math.min(VO.maxDurationS, Math.max(min, a.voiceover.durationS + VO.tailS))
    : s.fitMusic && music?.duration_s ? Math.min(max, Math.max(min, Number(music.duration_s))) : s.durationS;
  return {
    width: out.width,
    height: out.height,
    fps,
    durationInFrames: Math.max(1, Math.round(durationS0 * fps)),
    aspect: a.aspect,
    background: MOTION_GFX.background,
    colors: a.colors,
    assets: materialAssets(a.materials, a.srcFor, a.fileFor),
    ...(() => { const t = parseTable(s.table); return t ? { table: t } : {}; })(),
    ...(music ? { music: { src: a.srcFor(music.id), volume: s.musicVolume ?? MOTION_GFX.musicVolume, ...(a.voiceover ? { duck: { spans: speechSpans(a.voiceover.words), level: VO.musicDuck, rampS: VO.duckRampS } } : {}) } } : {}),
    ...(a.voiceover ? { voiceover: { src: a.srcFor(VOICEOVER_ID), volume: s.voVolume ?? VO.volume, words: a.voiceover.words } } : {}),
    ...(a.overlay ? { overlay: a.overlay } : {}),
    ...(s.opini ? { opini: { kredit: s.kredit !== false, prefix: OPINION.credit.prefix } } : {}),
    ...(a.voiceover && a.captions?.pages.length ? { captions: a.captions } : {}),
    ...(a.safeArea === false ? { safeArea: false } : {}),
    ...(a.fonts?.length ? { fonts: a.fonts.map((f) => ({ id: f.id, family: f.family, weight: f.weight, src: a.srcFor(`font:${f.id}`) })) } : {}),
    ...(() => {
      if (!a.sfx) return {};
      const durationS = Math.max(1, Math.round(durationS0 * fps)) / fps;
      const sfx = buildSfxProps({ style: a.sfx.style, creativeSfx: a.sfx.creativeSfx, frameSegs: null, fps, durationS, srcFor: a.sfx.srcFor, lengthFor: a.sfx.lengthFor });
      return sfx.length ? { sfx } : {};
    })(),
  };
}

/**
 * Bahan -> `data.assets` kode AI. Dipakai motion (gambar + audio) dan video bicara (Fase 15, `imagesOnly`).
 * `srcFor` = URL untuk lingkungan pemanggil; `fileFor` (worker) = salinan di folder kerja agar AI bisa melihat gambarnya.
 */
export function materialAssets(materials: MaterialInfo[], srcFor: (id: string) => string, fileFor?: (m: MaterialInfo) => string, opt: { imagesOnly?: boolean } = {}): CreativeAsset[] {
  return materials.filter((m) => isImage(m) || (!opt.imagesOnly && isAudio(m))).map((m) => ({
    id: m.id,
    name: m.label,
    type: isImage(m) ? "image" : "audio",
    src: srcFor(m.id),
    ...(fileFor ? { file: fileFor(m) } : {}),
    ...(m.width ? { width: m.width } : {}),
    ...(m.height ? { height: m.height } : {}),
    ...(m.duration_s ? { durationS: Number(m.duration_s) } : {}),
    ...(isImage(m) && (m.role === "logo" || m.role === "gambar") ? { role: m.role } : {}),
    ...(isImage(m) && m.cue ? { cue: m.cue } : {}),
    ...(isImage(m) && m.rig && m.role !== "logo" ? { rig: m.rig } : {}),
  }));
}

/** Data untuk kode AI (dan brief.json): sama dengan yang diterima komponen saat render. */
export function motionCreativeData(p: MotionProps): CreativeData {
  return {
    width: p.width, height: p.height, fps: p.fps, durationInFrames: p.durationInFrames, aspect: p.aspect,
    words: p.voiceover?.words ?? [], joins: [], colors: p.colors,
    fonts: { jakarta: FONTS.jakarta.label, montserrat: FONTS.montserrat.label, inter: FONTS.inter.label },
    safeArea: safeAreaPx(p.aspect, p.width, p.height, p.safeArea !== false), mode: "motion", assets: p.assets, ...(p.table ? { table: p.table } : {}), ...(p.opini ? { opini: p.opini } : {}),
  };
}
