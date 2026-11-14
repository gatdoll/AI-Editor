// Perakit props komposisi dari EDL + transkrip + pilihan gaya. Fungsi murni: dipakai worker (render)
// dan browser (pratinjau) sehingga keduanya menghasilkan rencana kamera dan subtitle yang identik.
import { ALL_PRESETS, ASPECTS, CAMERA, CREATIVE, ENERGY, SFX, FONT, FONTS, FX, MOTION, MOTION_GFX, STYLES, SUBTITLE, TALENT, type AspectId, type FontId, type TransitionKind, type CameraPattern, type CaptionAnim, type Energy, type StyleDef, type StyleId } from "@app/config";
import { normalizeTitles, type MotionTitle } from "./title-plan.ts";
import { normalizeParams, type ParamValue } from "../../shared/src/params.ts";
import type { EditedProps } from "./edited-props.ts";
import type { CreativeAsset, CreativeCode, CreativeFace, CreativeWord } from "./creative/contract.ts";
import { coverBox, faceAt, type FaceSample } from "../../shared/src/talent.ts";
import { maxScaleFor, muteCameraMoves, planCamera, validatePlan, type CameraOverride } from "./camera-plan.ts";
import { buildPages, joinTimes, mapWordsToTimeline, sentenceEndsOf, type CaptionPage, type PageOptions, type SrcWord } from "./captions.ts";
import { clipPages, freezeSubtitleClips, mapSpanToOutput } from "./subtitle-clips.ts";
import { motionSubtitleOn, normalizeEndClip, normalizeMotion, type EndClip, type MotionCaptions, type MotionSettings } from "./motion-props.ts";
import { normalizeStyleSfx, type SfxCue, type StyleSfx } from "../../shared/src/sfx.ts";
import { buildSfxProps } from "./sfx-props.ts";
import { normalizeSubtitles, type SubtitleClip, type Subtitles } from "../../shared/src/subtitles.ts";
import { toFrameSegments, totalFrames, type TimeSegment } from "./frames.ts";
import { planMotion } from "./motion-plan.ts";
import { applyHighlights, normalizeHighlights, planFx, type HighlightRequest } from "./fx-plan.ts";
import { mapRangeToOutput } from "./timeline.ts";
import { normalizeManual, subtractRange, transformFromParams, unionRanges, type ManualEdit } from "../../shared/src/manual.ts";
import type { Interval } from "../../shared/src/edl.ts";
import { normalizeFocusBy, normalizeIdList, type ReelClip } from "../../shared/src/reel.ts";

/** Rentang sah (angka terbatas, akhir > awal), digabung dan dibatasi jumlahnya. */
function normalizeRanges(raw: unknown[], max: number): Interval[] {
  const ok = raw.filter((x): x is Interval => !!x && typeof x === "object" && Number.isFinite((x as Interval).start) && Number.isFinite((x as Interval).end) && (x as Interval).start >= 0 && (x as Interval).end > (x as Interval).start);
  return unionRanges(ok.map((x) => ({ start: x.start, end: x.end }))).slice(0, max);
}

/** Permintaan kamera dari pengguna, dalam detik video MENTAH (stabil walau potongan berubah). */
export const PRESET_REQUESTS = ALL_PRESETS;
export type CameraRequest = { startS: number; endS: number; preset: (typeof PRESET_REQUESTS)[number] };

/** Semua pengaturan yang benar-benar dipakai: bawaan gaya, ditimpa pengaturan pengguna (`params`). */
export type ResolvedStyle = {
  def: StyleDef;
  energy: Energy;
  captionAnim: CaptionAnim;
  textScale: number;
  /** Jarak subtitle dari bawah (pecahan tinggi). null = zona aman otomatis. */
  textBottom: number | null;
  maxLines: number;
  wordsPerPage: number;
  tuning: { strength: number; minMoveSec?: number; maxMoveSec?: number };
  zoomMax: number | null;
  text: TextFx;
};

/** Pilihan teks tambahan yang dipakai subtitle dan judul. */
export type TextFx = { font: FontId; popFrom: number; exit: "potong" | "larut" | "geser" };

export function resolveStyle(style: StyleChoice): ResolvedStyle {
  const base = STYLES[style.styleId];
  const p = style.params;
  const num = (id: string) => (typeof p[id] === "number" ? (p[id] as number) : undefined);
  const bool = (id: string) => (typeof p[id] === "boolean" ? (p[id] as boolean) : undefined);
  const str = (id: string) => (typeof p[id] === "string" ? (p[id] as string) : undefined);
  const bold = bool("teks.tebal");
  const def: StyleDef = {
    ...base,
    colors: { text: str("warna.teks") ?? base.colors.text, accent: str("warna.aksen") ?? base.colors.accent, dark: str("warna.gelap") ?? base.colors.dark },
    dimOpacity: num("teks.redup") ?? base.dimOpacity,
    uppercase: bool("teks.hurufBesar") ?? base.uppercase,
    fontWeight: bold === undefined ? base.fontWeight : bold ? FONT.weightBold : FONT.weightRegular,
    strokePx: num("teks.garisTepi") ?? base.strokePx,
    vignette: num("efek.vinyet") ?? base.vignette,
    gradient: num("efek.gradasi") ?? base.gradient,
    grain: num("efek.grain") ?? base.grain,
  };
  const energy = (str("kamera.energi") as Energy | undefined) ?? base.energy;
  return {
    def,
    energy: energy in ENERGY ? energy : base.energy,
    captionAnim: (str("teks.animasi") as CaptionAnim | undefined) ?? base.captionAnim,
    textScale: num("teks.ukuran") ?? 1,
    textBottom: num("teks.posisiBawah") ?? null,
    maxLines: num("teks.baris") ?? SUBTITLE.maxLines,
    wordsPerPage: num("teks.kataPerHalaman") ?? 0,
    tuning: { strength: num("kamera.kekuatanZoom") ?? 1, minMoveSec: num("kamera.gerakanMin"), maxMoveSec: num("kamera.gerakanMaks") },
    zoomMax: num("kamera.zoomMaks") ?? null,
    text: {
      font: (str("teks.font") && str("teks.font")! in FONTS ? str("teks.font") : "jakarta") as FontId,
      popFrom: num("teks.popDari") ?? SUBTITLE.popFromScale,
      exit: (["potong", "larut", "geser"].includes(str("teks.keluar") ?? "") ? str("teks.keluar") : "potong") as TextFx["exit"],
    },
  };
}

export type StyleChoice = {
  /** Versi Mode Kreatif yang aktif (creative_versions.id). Tidak ada = Mode Kreatif mati. */
  creativeId?: string;
  /** Fase 14: isyarat SFX dari Mode Cepat/timeline (waktu mentah) dan apakah SFX versi kreatif ikut. */
  sfx?: StyleSfx;
  /** Fase 13: pengaturan project motion graphics (durasi, musik, data). Hanya untuk project jenis 'motion'. */
  motion?: MotionSettings;
  /** Fase 18: klip motion penutup (CTA) sesudah video. Tidak ada = video berakhir seperti biasa. */
  endClip?: EndClip;
  /** Rentang (detik mentah) tempat gerakan kamera otomatis dihapus pengguna: kamera diam di sana. */
  cameraMuted?: Interval[];
  /** Rentang (detik mentah) tempat lapisan kreatif tampil. Tidak ada = seluruh video; [] = tidak tampil di mana pun. */
  creativeRanges?: Interval[];
  manual?: ManualEdit;
  /** Subtitle yang sudah dibekukan menjadi klip (diedit pengguna). Tidak ada = subtitle otomatis dari transkrip. */
  subtitles?: Subtitles;
  titles?: MotionTitle[];
  /** Kata kunci yang disorot (aksen) atau dibanting (slam), dalam detik mentah. */
  highlights?: HighlightRequest[];
  /** Penimpaan pengaturan (id dari registri parameter). Yang tidak ada = bawaan gaya. */
  params: Record<string, ParamValue>;
  /** Gerakan kamera yang diminta ("zoom saat aku bilang X"). */
  cameraOverrides: CameraRequest[];
  aspect: AspectId;
  styleId: StyleId;
  camera: boolean;
  captions: boolean;
  effects: boolean;
  /** Titik fokus horizontal saat dipotong ke rasio lebih sempit (0..1). */
  focusX: number;
  /** Titik fokus vertikal (0..1). Tidak ada = tengah (0,5). Diatur dengan menggeser video di canvas. */
  focusY?: number;
  /** Fase 16: urutan tampil video (id aset). Tidak ada = urutan unggah. */
  reelOrder?: string[];
  /** Fase 16: video yang tidak ditampilkan (dihapus dari timeline, file tetap ada). */
  reelHidden?: string[];
  /** Fase 16: titik fokus per video (menimpa focusX). */
  focusBy?: Record<string, number>;
};

export const DEFAULT_STYLE: StyleChoice = {
  params: {},
  cameraOverrides: [],
  aspect: "16:9",
  styleId: "bersih",
  camera: true,
  captions: true,
  effects: true,
  focusX: 0.5,
};

export type SourceInfo = { width: number; height: number; fps: number; durationS: number };

/** Hash string sederhana -> seed bilangan bulat, agar rencana kamera deterministik per EDL. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeStyle(raw: Partial<StyleChoice> | null | undefined): StyleChoice {
  const r = raw ?? {};
  const reqs = Array.isArray(r.cameraOverrides) ? r.cameraOverrides : [];
  const cameraOverrides: CameraRequest[] = reqs
    .filter((q): q is CameraRequest => !!q && Number.isFinite(q.startS) && Number.isFinite(q.endS) && q.endS > q.startS && q.startS >= 0 && (PRESET_REQUESTS as readonly string[]).includes(q.preset))
    .slice(0, CAMERA.overrideMax)
    .map((q) => ({ startS: q.startS, endS: q.endS, preset: q.preset }));
  return {
    // Hanya uuid yang diterima; kunci dihilangkan (bukan undefined) agar project lama tidak berubah saat dibandingkan
    ...(typeof r.creativeId === "string" && UUID_RE.test(r.creativeId) ? { creativeId: r.creativeId.toLowerCase() } : {}),
    ...(() => { const m = normalizeMotion(r.motion); return m ? { motion: m } : {}; })(),
    ...(() => { const e = normalizeEndClip(r.endClip); return e ? { endClip: e } : {}; })(),
    ...(() => { const x = normalizeStyleSfx(r.sfx); return x ? { sfx: x } : {}; })(),
    ...(Array.isArray(r.creativeRanges) ? { creativeRanges: normalizeRanges(r.creativeRanges, CREATIVE.maxRanges) } : {}),
    ...(Array.isArray(r.cameraMuted) && r.cameraMuted.length ? { cameraMuted: normalizeRanges(r.cameraMuted, CAMERA.maxMuted) } : {}),
    manual: normalizeManual(r.manual),
    // Sama seperti creativeId: kunci dihilangkan bila tidak ada, agar project lama tidak berubah saat dibandingkan
    ...(() => { const s = normalizeSubtitles(r.subtitles); return s ? { subtitles: s } : {}; })(),
    titles: normalizeTitles(r.titles),
    highlights: normalizeHighlights(r.highlights),
    params: normalizeParams(r.params),
    cameraOverrides,
    aspect: r.aspect && r.aspect in ASPECTS ? r.aspect : DEFAULT_STYLE.aspect,
    styleId: r.styleId && r.styleId in STYLES ? r.styleId : DEFAULT_STYLE.styleId,
    camera: r.camera ?? DEFAULT_STYLE.camera,
    captions: r.captions ?? DEFAULT_STYLE.captions,
    effects: r.effects ?? DEFAULT_STYLE.effects,
    focusX: typeof r.focusX === "number" ? Math.min(1, Math.max(0, r.focusX)) : DEFAULT_STYLE.focusX,
    // Kunci dihilangkan bila tidak ada, agar project lama tidak berubah saat dibandingkan
    ...(typeof r.focusY === "number" && Number.isFinite(r.focusY) ? { focusY: Math.min(1, Math.max(0, r.focusY)) } : {}),
    // Fase 16: kunci dihilangkan bila kosong, agar project lama tidak berubah saat dibandingkan
    ...(() => { const x = normalizeIdList(r.reelOrder); return x ? { reelOrder: x } : {}; })(),
    ...(() => { const x = normalizeIdList(r.reelHidden); return x ? { reelHidden: x } : {}; })(),
    ...(() => { const x = normalizeFocusBy(r.focusBy); return x ? { focusBy: x } : {}; })(),
  };
}

export type BuiltProps = {
  props: Omit<EditedProps, "src">;
  durationInFrames: number;
  /** Pelanggaran aturan kamera (seharusnya kosong). */
  cameraErrors: string[];
};

/**
 * Kata dan sambungan pada timeline HASIL untuk Mode Kreatif. Pemetaan yang sama dengan subtitle:
 * kata yang terpotong hilang, sorotan pengguna (detik mentah) ikut dipetakan menjadi `hl`.
 */
export function buildCreativeTimeline(args: { segments: TimeSegment[]; source: SourceInfo; words: SrcWord[]; style: StyleChoice }): { words: CreativeWord[]; joins: number[]; durationInFrames: number } {
  const { segments, source, words, style } = args;
  const fps = source.fps;
  const frameSegs = toFrameSegments(segments, fps, source.durationS);
  const hl = normalizeHighlights(style.highlights).flatMap((h) => {
    const m = mapRangeToOutput(frameSegs, fps, h.startS, h.endS);
    return m ? [{ ...m, effect: h.effect }] : [];
  });
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    words: mapWordsToTimeline(words, segments, fps, source.durationS).map((w) => {
      const mid = (w.start + w.end) / 2;
      const h = hl.find((r) => mid >= r.start && mid < r.end);
      return { text: w.text, start: round(w.start), end: round(w.end), ...(h ? { hl: h.effect } : {}) };
    }),
    joins: joinTimes(segments, fps, source.durationS).map(round),
    durationInFrames: Math.max(1, totalFrames(frameSegs)),
  };
}

/**
 * Fase 21: isyarat aset sendiri (detik video MENTAH) -> timeline hasil, dengan pemetaan yang sama dengan sorotan kata.
 * Kalimatnya terpotong = isyarat dibuang (aset tidak dipaksa tampil di tempat lain, aturan 7). Dihitung ulang tiap kali
 * props dibangun, jadi aset ikut bergeser bila cut berubah tanpa membuat ulang kode kreatif.
 */
export function mapAssetCues(assets: CreativeAsset[], frameSegs: ReturnType<typeof toFrameSegments>, fps: number): CreativeAsset[] {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return assets.map((a) => {
    if (!a.cue) return a;
    const m = mapRangeToOutput(frameSegs, fps, a.cue.start, a.cue.end);
    if (!m) { const { cue: _cue, ...rest } = a; return rest; }
    return { ...a, cue: { ...a.cue, start: round(m.start), end: round(m.end) } };
  });
}

/** Klip akhir tidak punya transkrip: isyarat waktu aset tidak berlaku di sana. */
const withoutCues = (assets: CreativeAsset[]): CreativeAsset[] => assets.map((a) => { if (!a.cue) return a; const { cue: _cue, ...rest } = a; return rest; });

/** Sama dengan mapAssetCues, untuk pemanggil yang memegang segmen detik (brief Mode Kreatif). */
export function assetsOnTimeline(assets: CreativeAsset[], segments: TimeSegment[], source: SourceInfo): CreativeAsset[] {
  return mapAssetCues(assets, toFrameSegments(segments, source.fps, source.durationS), source.fps);
}

/** Fase 24: data wajah per video sumber (id = id video mentah, waktu file). */
export type TalentFacesById = Record<string, { width: number; height: number; samples: FaceSample[] }>;

/**
 * Fase 24: posisi wajah untuk kode AI (`data.faces`): satu sampel tiap TALENT.faceSampleSec timeline hasil, piksel kanvas.
 * Waktu hasil -> waktu reel lewat segmen EDL -> video yang memuatnya -> kotak wajah -> objectFit cover + fokus.
 * Gerak kamera tidak dihitung (perkiraan untuk menaruh teks); blur wajah dihitung tepat di komposisi.
 */
export function creativeFaces(args: { segments: TimeSegment[]; source: SourceInfo; clips?: ReelClip[]; talent?: TalentFacesById; style: StyleChoice; out: { width: number; height: number } }): CreativeFace[] {
  const { talent, source, style } = args;
  if (!talent || !Object.keys(talent).length) return [];
  const fps = source.fps;
  const frameSegs = toFrameSegments(args.segments, fps, source.durationS);
  const total = totalFrames(frameSegs) / fps;
  const clips = args.clips?.length ? args.clips : null;
  const round = (n: number) => Math.round(n * 10) / 10;
  const out: CreativeFace[] = [];
  for (let t = 0; t < total; t += TALENT.faceSampleSec) {
    const f = Math.round(t * fps);
    const seg = frameSegs.find((g) => f >= g.at && f < g.at + g.length);
    if (!seg) continue;
    const reel = (seg.srcFrom + (f - seg.at)) / fps;
    const clip = clips ? clips.find((c) => reel >= c.offset && reel < c.offset + c.duration) : null;
    const id = clip?.id ?? Object.keys(talent)[0];
    const faces = talent[id];
    if (!faces) continue;
    const box = faceAt(faces.samples, reel - (clip?.offset ?? 0));
    if (!box) continue;
    const focusX = clip && style.focusBy?.[clip.id] !== undefined ? style.focusBy[clip.id] : style.focusX;
    const b = coverBox(box, faces, args.out, focusX, style.focusY ?? 0.5);
    out.push({ t: Math.round(t * 1000) / 1000, x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) });
  }
  return out;
}

/** Halaman subtitle di luar rentang (dipangkas). Sisa yang terlalu pendek untuk dibaca dibuang. */
function pagesOutside(pages: CaptionPage[], ranges: Interval[]): CaptionPage[] {
  if (!ranges.length) return pages;
  return pages.flatMap((p) => {
    let rest: Interval[] = [{ start: p.start, end: p.end }];
    for (const r of ranges) rest = subtractRange(rest, r);
    return rest.filter((x) => x.end - x.start >= 0.1).map((x) => ({ ...p, start: x.start, end: x.end }));
  });
}

/** Aturan pemecahan halaman subtitle dari gaya. Satu sumber untuk subtitle otomatis, klip subtitle, dan pembekuan. */
export function captionPageOptions(style: StyleChoice): PageOptions {
  const rs = resolveStyle(style);
  const chunk = rs.captionAnim === "pendek";
  const kinetic = rs.captionAnim === "kinetik" || rs.captionAnim === "blur-slide";
  return {
    aspect: style.aspect,
    uppercase: rs.def.uppercase || chunk,
    maxWords: rs.wordsPerPage > 0 ? rs.wordsPerPage : chunk ? SUBTITLE.chunkWords : kinetic ? MOTION.maxWords : undefined,
    maxLines: rs.maxLines,
    fontScale: (chunk ? SUBTITLE.chunkFontScale : kinetic ? MOTION.captionScale : 1) * rs.textScale,
  };
}

/** Project motion/animasi: subtitle otomatis dari waktu kata voice over (detik = waktu video, tanpa cut). */
export function motionCaptions(style: StyleChoice, words: SrcWord[] | undefined | null): MotionCaptions | undefined {
  if (!words?.length || !motionSubtitleOn(style.motion)) return undefined;
  const rs = resolveStyle(style);
  return { pages: buildPages(words, captionPageOptions(style)), style: rs.def, anim: rs.captionAnim, textScale: rs.textScale, textBottom: rs.textBottom, textFx: rs.text };
}

/** Subtitle otomatis yang sedang tampil, dibekukan menjadi klip (edit subtitle pertama di timeline). */
export function autoSubtitleClips(args: { segments: TimeSegment[]; source: SourceInfo; words: SrcWord[]; style: StyleChoice }): SubtitleClip[] {
  return freezeSubtitleClips({ words: args.words, segments: args.segments, fps: args.source.fps, sourceSeconds: args.source.durationS, options: captionPageOptions(args.style) });
}

export function buildEditedProps(args: {
  segments: TimeSegment[];
  source: SourceInfo;
  words: SrcWord[];
  style: StyleChoice;
  seed: number;
  /** Kode Mode Kreatif versi aktif (dimuat lewat loadCreativeCode). Tidak ada = tanpa layer kreatif. */
  creative?: CreativeCode | null;
  /** Fase 14: isyarat SFX versi kreatif aktif (waktu HASIL versi itu). */
  creativeSfx?: SfxCue[] | null;
  /** URL file SFX; bawaan = rute web (pratinjau). Render mengganti dengan server lokal. */
  sfxSrc?: (id: string) => string;
  /** Durasi suara SFX (detik) dari pustaka; tanpa ini dipakai SFX.fallbackLenS. */
  sfxLength?: (id: string) => number | undefined;
  /** Fase 15: gambar/logo pengguna untuk kode kreatif (lihat materialAssets). */
  creativeAssets?: CreativeAsset[];
  /** Fase 16: video project pada sumbu reel. Ada = tiap segmen memutar file videonya sendiri (`props.sources`, src diisi pemanggil). */
  clips?: ReelClip[];
  /** Fase 24: data wajah per video (talent sudah disiapkan). `sources[].talentSrc` diisi pemanggil. */
  talent?: TalentFacesById;
  /** Fase 18: kode versi klip akhir (`style.endClip.versionId`). Tidak ada = tanpa klip akhir. */
  endClip?: (CreativeCode & { sfx?: SfxCue[] }) | null;
}): BuiltProps {
  const { segments: inputSegments, source, words, style, seed } = args;
  // Splits are editing boundaries only: do not reset titles, camera or audio fades.
  const segments: TimeSegment[] = [];
  for (const seg of inputSegments) {
    const prev = segments[segments.length - 1];
    if (prev && Math.abs(prev.end - seg.start) < 1e-7) prev.end = seg.end;
    else segments.push({ ...seg });
  }
  const fps = source.fps;
  const out = ASPECTS[style.aspect];
  const frameSegs = toFrameSegments(segments, fps, source.durationS);
  const durationInFrames = Math.max(1, totalFrames(frameSegs));
  const durationS = durationInFrames / fps;

  const tw = mapWordsToTimeline(words, segments, fps, source.durationS);
  const rs = resolveStyle(style);
  const { energy, captionAnim } = rs;
  const motionEnabled = typeof style.params["motion.bingkai"] === "boolean" ? style.params["motion.bingkai"] === true : style.styleId === "motion";
  const pageOpts = captionPageOptions(style);
  const plannedPages = !(style.captions || motionEnabled) ? []
    : style.subtitles ? clipPages({ clips: style.subtitles.clips, segments, fps, sourceSeconds: source.durationS, options: pageOpts })
    : buildPages(tw, pageOpts);

  // Sorotan kata kunci: detik mentah -> timeline hasil; yang terpotong ikut hilang
  const hlRanges = normalizeHighlights(style.highlights).flatMap((h) => {
    const m = mapRangeToOutput(frameSegs, fps, h.startS, h.endS);
    return m ? [{ ...m, effect: h.effect }] : [];
  });
  // Selama judul hook tampil, subtitle yang mengucapkan kata yang sama disembunyikan agar tidak dobel
  const hookWindows = normalizeTitles(style.titles).filter((t) => t.animation === "hook").flatMap((t) => { const m = mapRangeToOutput(frameSegs, fps, t.startS, t.endS); return m ? [m] : []; });
  const pages = applyHighlights(plannedPages, hlRanges).filter((p) => !hookWindows.some((w) => p.start < w.end && p.end > w.start + 0.05));

  const joins = joinTimes(segments, fps, source.durationS);
  let camera: EditedProps["camera"] = [];
  let cameraErrors: string[] = [];
  if (style.camera) {
    // Permintaan pengguna (detik mentah) -> timeline hasil. Yang titik tengahnya terpotong dibuang.
    const overrides: CameraOverride[] = [];
    for (const q of style.cameraOverrides ?? []) {
      const m = mapRangeToOutput(frameSegs, fps, q.startS, q.endS);
      if (m) overrides.push({ start: m.start, end: m.end, preset: q.preset });
    }
    const input = {
      pattern: (style.params["kamera.pola"] ?? "otomatis") as CameraPattern,
      energy,
      tuning: rs.tuning,
      overrides,
      durationS,
      joins,
      sentenceEnds: sentenceEndsOf(tw),
      width: out.width,
      height: out.height,
      maxScale: rs.zoomMax ?? maxScaleFor(source.height, source.width, out.width, out.height),
      seed,
    };
    camera = planCamera(input);
    cameraErrors = validatePlan(camera, input);
    // Gerakan yang dihapus pengguna -> kamera diam (sesudah validasi: hanya mengurangi gerakan)
    camera = muteCameraMoves(camera, {
      muted: (style.cameraMuted ?? []).flatMap((r) => { const m = mapSpanToOutput(segments, fps, source.durationS, r.start, r.end); return m ? [m] : []; }),
      autoOff: style.params["kamera.otomatis"] === false,
      overrides, durationS, joins, width: out.width, height: out.height,
    });
  }

  // Lapisan kreatif tampil hanya di rentangnya (timeline hasil). Subtitle bawaan yang digantikan kreatif kembali di luar rentang itu.
  const creativeCode = args.creative && (args.creative.overlay || args.creative.video) ? args.creative : null;
  const creativeRanges = !creativeCode ? [] : style.creativeRanges
    ? style.creativeRanges.flatMap((r) => { const m = mapSpanToOutput(segments, fps, source.durationS, r.start, r.end); return m ? [m] : []; })
    : [{ start: 0, end: durationS }];
  const captionPages = creativeCode?.overlay && creativeCode.replacesCaptions ? pagesOutside(pages, creativeRanges) : pages;

  // Klip akhir ada di luar video: semua perhitungan di atas (subtitle, kamera, judul) tetap memakai durasi video saja
  const endOverlay = style.endClip ? args.endClip?.overlay : undefined;
  const endFrames = endOverlay ? Math.max(1, Math.round(style.endClip!.seconds * fps)) : 0;
  // SFX versi klip akhir memakai waktu klip; digeser ke ujung video. Isyarat edit tidak ikut (sudah dihitung di bawah).
  const endSfx = endOverlay
    ? buildSfxProps({ style: { params: style.params, sfx: { cues: [], useCreative: true } }, creativeSfx: args.endClip?.sfx ?? null, frameSegs: null, fps, durationS: endFrames / fps, srcFor: args.sfxSrc, lengthFor: args.sfxLength }).map((c) => ({ ...c, from: c.from + durationInFrames }))
    : [];

  const titleList = normalizeTitles(style.titles);
  const fx = planFx({
    kind: (style.params["transisi.jenis"] ?? "tidak") as TransitionKind,
    frames: Number(style.params["transisi.durasi"] ?? FX.transition.frames),
    joins,
    shake: style.camera ? Number(style.params["kamera.guncang"] ?? 0) : 0,
    shakeAt: [
      ...(style.cameraOverrides ?? []).flatMap((q) => { const m = mapRangeToOutput(frameSegs, fps, q.startS, q.endS); return m ? [m.start + CAMERA.overrideLeadSec] : []; }),
      ...titleList.filter((t) => t.animation === "hook").flatMap((t) => { const m = mapRangeToOutput(frameSegs, fps, t.startS, Math.min(t.endS, t.startS + 1)); return m ? [m.start + FX.hook.wordSec] : []; }),
    ],
    slamAt: pages.flatMap((p) => p.tokens.filter((tok) => tok.hl === "slam").map((tok) => tok.startMs / 1000)),
    tiltDeg: style.camera ? Number(style.params["kamera.miring"] ?? 0) : 0,
    pageStarts: plannedPages.map((p) => p.start),
    durationS,
  });

  return {
    props: {
      fx,
      textFx: rs.text,
      videoEdit: { transform: transformFromParams(style.params), keyframes: normalizeManual(style.manual).keyframes, flipX: style.params["video.flipX"] === true, flipY: style.params["video.flipY"] === true, brightness: Number(style.params["video.terang"] ?? 1), contrast: Number(style.params["video.kontras"] ?? 1), saturation: Number(style.params["video.saturasi"] ?? 1), volume: Number(style.params["audio.volume"] ?? 1), muted: style.params["audio.bisu"] === true, fadeIn: Number(style.params["audio.fadeIn"] ?? 0), fadeOut: Number(style.params["audio.fadeOut"] ?? 0) },
      titles: titleList.flatMap((title) => {
        // A title spanning a removed interval stays visible on both retained sides.
        const pieces = frameSegs.flatMap((seg) => {
          const a = Math.max(title.startS, seg.srcFrom / fps), b = Math.min(title.endS, seg.srcTo / fps);
          return b > a ? [{ start: seg.at / fps + a - seg.srcFrom / fps, end: seg.at / fps + b - seg.srcFrom / fps }] : [];
        });
        return pieces.length ? [{ ...title, startS: pieces[0].start, endS: pieces[pieces.length - 1].end }] : [];
      }),
      segments,
      sourceSeconds: source.durationS,
      fadeFrames: 2,
      width: out.width,
      height: out.height,
      fps,
      focusX: style.focusX,
      ...(style.focusY !== undefined ? { focusY: style.focusY } : {}),
      ...(args.clips?.length ? { sources: args.clips.map((c) => ({ id: c.id, src: "", offset: c.offset, duration: c.duration, ...(style.focusBy?.[c.id] !== undefined ? { focusX: style.focusBy[c.id] } : {}) })) } : {}),
      ...(args.talent && Object.keys(args.talent).length ? { talent: args.talent } : {}),
      aspect: style.aspect,
      styleId: style.styleId,
      style: rs.def,
      captionAnim,
      textScale: rs.textScale,
      textBottom: rs.textBottom,
      camera,
      pages: style.captions ? captionPages : [],
      motion: { enabled: motionEnabled, spatial: (style.params["motion.ruang"] ?? "datar") as "datar" | "orbit" | "parallax", strength: Number(style.params["motion.kekuatan"] ?? MOTION.strength), scenes: motionEnabled ? planMotion(plannedPages, durationS, Number(style.params["motion.jeda"] ?? MOTION.sceneGapSec)) : [] },
      showCamera: style.camera,
      showCaptions: style.captions,
      showEffects: style.effects,
      ...(() => { const sfx = [...buildSfxProps({ style, creativeSfx: creativeCode ? (args.creativeSfx ?? (creativeCode as { sfx?: SfxCue[] }).sfx ?? null) : null, frameSegs, fps, durationS, srcFor: args.sfxSrc, lengthFor: args.sfxLength }), ...endSfx]; return sfx.length ? { sfx } : {}; })(),
      ...(endOverlay ? { endClip: { frames: endFrames, overlay: endOverlay, background: MOTION_GFX.background, ...(args.endClip?.fonts?.length ? { fonts: args.endClip.fonts } : {}), ...(args.creativeAssets?.length ? { assets: withoutCues(args.creativeAssets) } : {}) } } : {}),
      // Kata pada timeline hasil dihitung di sini (bukan di komposisi) agar pratinjau dan render memakai data yang sama
      ...(creativeCode
        ? { creative: { overlay: creativeCode.overlay, video: creativeCode.video, replacesCaptions: creativeCode.replacesCaptions === true, ...(creativeCode.fonts?.length ? { fonts: creativeCode.fonts } : {}), words: buildCreativeTimeline({ segments, source, words, style }).words, ranges: creativeRanges, ...(args.creativeAssets?.length ? { assets: mapAssetCues(args.creativeAssets, frameSegs, fps) } : {}), ...(args.talent ? { faces: creativeFaces({ segments, source, clips: args.clips, talent: args.talent, style, out: { width: out.width, height: out.height } }) } : {}) } }
        : {}),
    },
    durationInFrames: durationInFrames + endFrames,
    cameraErrors,
  };
}

