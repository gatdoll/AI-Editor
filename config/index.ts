// SATU-SATUNYA tempat konstanta gaya (aturan 8). Jangan hardcode di komponen.

export const FONT = {
  // Satu keluarga sans-serif modern, maksimal 2 weight.
  family: "Plus Jakarta Sans",
  weightRegular: 500,
  weightBold: 800,
} as const;

// Latar di belakang video (terlihat hanya bila sumber tidak memenuhi frame)
export const FRAME = { background: "#000000" } as const;

// Posisi gradient dan vignette (persen), dipakai komponen Effects
export const EFFECTS = {
  gradientClearFromPct: 38,
  gradientClearToPct: 70,
  gradientTopFactor: 0.5,
  vignetteClearToPct: 58,
} as const;

export const VIDEO = {
  fps: 30,
  // Padding di tiap sambungan cut (aturan 5)
  cutPaddingSec: 0.1,
  // Kualitas H.264 (CRF: makin besar makin kecil file). Grain acak membuat file jauh lebih besar pada CRF rendah.
  crf: 23,
  /** Cache frame OffthreadVideo saat render: terlalu kecil = "No frame found at position" ketika RAM bebas sedikit. */
  renderCache: { freeShare: 0.5, minBytes: 2 * 1024 ** 3, maxBytes: 6 * 1024 ** 3 },
  /** Batas tab render pada percobaan ulang: lebih sedikit frame diminta bersamaan, cache lebih longgar. */
  retryConcurrency: 2,
  /** Fase 16: jarak antar video pada sumbu waktu reel (detik). Lubang ini tidak pernah tampil di hasil. */
  reelGapSec: 1,
  /** Fase 16: batas jumlah video per project. */
  maxVideos: 50,
} as const;

// ------------------------------------------------------- gelombang audio di timeline
// Puncak per jendela waktu (mono), disimpan sebagai byte 0..255. 100/dtk cukup untuk melihat jeda dan kata
// pada zoom maksimum timeline (400 px/dtk), dan hanya ~60 KB untuk video 10 menit.
export const WAVEFORM = { perSecond: 100, sampleRate: 16000 } as const;

// ------------------------------------------------------------------ SFX (Fase 14)
// Pustaka: bawaan (Kenney CC0 + buatan sendiri, npm run setup:sfx) + unggahan pengguna, di MEDIA_DIR/sfx.
// AI dan pengguna menaruh "isyarat" (suara + waktu + volume); komposisi yang memutar.
export const SFX = {
  /** Panjang tiap SFX di komposisi = durasi suaranya; tanpa durasi = fallbackLenS. Dibatasi maxLenS. */
  fallbackLenS: 3, maxLenS: 8,
  /** Slot <audio> bersama Player Remotion (bawaan 5). SFX yang tumpang tindih + audio video/musik perlu lebih. */
  playerAudioTags: 16,
  maxCues: 40,
  /** Jarak minimum antar isyarat (detik): SFX yang menumpuk terdengar berantakan. */
  minGapS: 0.2,
  /** Volume master bawaan (pengaturan audio.sfx); suara bicara tetap dominan. */
  defaultMaster: 0.6,
  /** Mode Cepat: isyarat per frasa paling banyak di sekian kemunculan pertama. */
  maxPerPhrase: 5,
  upload: { maxBytes: 10 * 1024 * 1024, max: 200, mimes: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/webm"] },
} as const;

// ------------------------------------------------------- salinan pratinjau (Fase 11)
// Browser hanya diandalkan untuk H.264/VP8/VP9/AV1 8-bit 4:2:0. Selain itu (mis. HEVC dari iPhone, ProRes, 10-bit)
// worker membuat salinan H.264 untuk pratinjau. Render tetap dari file mentah.
export const PREVIEW = {
  playableCodecs: ["h264", "vp8", "vp9", "av1"],
  playablePixFmts: ["yuv420p", "yuvj420p"],
  // Sisi terpendek dibatasi agar cepat dibuat dan ringan diputar; pratinjau tidak perlu 4K
  maxShortSide: 1080,
  crf: 23,
  preset: "veryfast",
  audioBitrate: "160k",
} as const;

// -------------------------------------------------------------- reduksi noise (Fase 11)
// Library noisereduce (github.com/timsainb/noisereduce) lewat Python di worker. Hasilnya file audio turunan per
// kekuatan; video mentah tidak diubah.
/**
 * Fase 24: analisis talent video bicara (CPU). RobustVideoMatting memisahkan orang dari latar (video transparan VP9+alpha,
 * untuk teks DI BELAKANG talent) dan YuNet mendeteksi wajah (blur wajah, teks di depan wajah). File mentah hanya dibaca.
 * `npm run setup:talent` membuat venv + mengunduh model (sha256 dicek).
 */
/**
 * Fase 25: gerak karakter ber-rig (komponen Character di kode kreatif). Satuan jarak = fraksi tinggi karakter;
 * sudut = derajat; waktu = detik. Rig dibuat apps/worker/py/rig.py dengan venv talent.
 */
export const CHARACTER = {
  breathe: 0.012,
  breathePeriodS: 3.2,
  headSway: 1.6,
  headSwayPeriodS: 4.4,
  blinkEveryS: 3.4,
  blinkS: 0.16,
  /** Pergantian bentuk mulut per detik saat bicara. */
  mouthRate: 9,
  stepsPerS: 2.2,
  walkBob: 0.025,
  legLift: 0.035,
  jumpS: 0.75,
  jumpHeight: 0.22,
} as const;

export const TALENT = {
  venvDir: ".cache/py-talent",
  modelDir: ".cache/talent-models",
  pythonPackages: ["onnxruntime==1.23.2", "opencv-python-headless==4.12.0.88", "imageio-ffmpeg==0.6.0"],
  models: [
    { file: "rvm_mobilenetv3_fp32.onnx", url: "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx", sha256: "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828" },
    { file: "face_detection_yunet_2023mar.onnx", url: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx", sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4" },
  ],
  /** Lebar frame untuk model matting (alpha di-upscale ke resolusi asli). Lebih besar = tepi lebih rapi, lebih lambat. */
  inferWidth: 384,
  /** Kualitas VP9 (lebih kecil = lebih bagus, file lebih besar). */
  crf: 34,
  /** Batas waktu per detik video (CPU ±3x durasi; diberi cadangan). */
  timeoutPerSecondMs: 20_000,
  /** Sampel wajah untuk kode AI (data.faces): satu tiap sekian detik timeline hasil. */
  faceSampleSec: 0.2,
} as const;

/**
 * Fase 24: pustaka font Google Fonts (lisensi OFL, bebas dipakai di video) untuk Mode Kreatif. `npm run setup:fonts` mengunduh
 * TTF ke MEDIA_DIR/fonts/library + catalog.json + gambar contoh huruf (spesimen) agar AI bisa membandingkan dengan referensi.
 * Pengguna juga bisa mengunggah font sendiri (TTF/OTF/WOFF/WOFF2) sebagai bahan project.
 */
export const FONT_LIBRARY = {
  dir: "fonts/library",
  weights: [400, 700, 900],
  /** Maks font tambahan per versi kreatif (dimuat sebelum frame dirender). */
  maxPerVersion: 4,
  mimes: { ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2" },
  maxUploadBytes: 8 * 1024 * 1024,
  families: [
    // tegas / kondensed (judul, kinetik)
    "Anton", "Bebas Neue", "Oswald", "Archivo Black", "Archivo Narrow", "Barlow Condensed", "Roboto Condensed", "Teko", "Fjalla One",
    "League Spartan", "Big Shoulders Display", "Staatliches", "Russo One", "Black Ops One", "Alfa Slab One", "Rubik Mono One", "Kanit",
    // sans modern
    "Poppins", "Lexend", "DM Sans", "Space Grotesk", "Sora", "Outfit", "Manrope", "Rubik", "Nunito", "Raleway", "Syne", "Unbounded",
    "Bricolage Grotesque", "Work Sans", "Figtree", "Urbanist", "Prompt",
    // serif / editorial
    "Playfair Display", "DM Serif Display", "Abril Fatface", "Bodoni Moda", "Instrument Serif", "Lora", "Fraunces", "Cormorant Garamond",
    // tulisan tangan / karakter
    "Permanent Marker", "Bangers", "Luckiest Guy", "Titan One", "Righteous", "Caveat", "Kalam", "Pacifico", "Lobster", "Dancing Script",
  ],
} as const;

/**
 * Koreksi transkrip oleh AI sesudah Whisper (Nov 2026): kata salah dengar diperbaiki dari konteks. AI tidak mendengar audio;
 * hanya teks. Gagal/CLI tidak siap = transkrip Whisper apa adanya (dicatat di job), tidak menggagalkan transkripsi.
 */
export const TRANSCRIPT_FIX = {
  enabled: true,
  provider: "claude" as "claude" | "codex",
  model: "claude-opus-5-5",
  /** Kata per panggilan AI (transkrip panjang dibagi). */
  chunkWords: 900,
  /** Maks kata yang diganti dalam satu koreksi. */
  maxSpan: 6,
  timeoutMs: 6 * 60 * 1000,
} as const;

export const DENOISE = {
  pythonPackage: "noisereduce==3.0.3",
  /** venv Python di dalam .cache (dibuat `npm run setup:denoise`); env DENOISE_PYTHON menimpa. */
  venvDir: ".cache/py-denoise",
  sampleRate: 48000,
  audioBitrate: "192k",
  /** Kekuatan dibulatkan ke langkah ini: satu file per langkah, jadi geser slider tidak membuat ratusan file. */
  step: 0.05,
  /** Non-stasioner: cocok untuk noise yang berubah (kipas, lalu lintas, ruangan). Stasioner untuk dengung tetap. */
  stationary: false,
  /** Potongan audio per proses agar memori tetap kecil untuk video panjang (sampel). */
  chunkSize: 600000,
  timeoutMs: 20 * 60 * 1000,
} as const;

// ------------------------------------------------------------------ rasio
export const ASPECTS = {
  "16:9": { width: 1920, height: 1080, label: "16:9 (YouTube)" },
  "9:16": { width: 1080, height: 1920, label: "9:16 (Reels / TikTok / Shorts)" },
  "4:5": { width: 1080, height: 1350, label: "4:5 (Feed Instagram / Facebook)" },
} as const;
export type AspectId = keyof typeof ASPECTS;
/** Satu-satunya daftar rasio: validasi operasi, prompt AI, kontrak kreatif, dan UI diturunkan dari sini. */
export const ASPECT_IDS = Object.keys(ASPECTS) as [AspectId, ...AspectId[]];

/**
 * Safe area platform (pecahan lebar/tinggi frame): bagian yang tertutup antarmuka aplikasi saat video diunggah.
 * 9:16 Reels/TikTok/Shorts: atas = nama akun/tab "Reels" dan tombol kamera; bawah = caption, nama akun, audio, tombol follow;
 * kanan = kolom like/komentar/share/simpan/audio; kiri = tepi layar. 4:5 feed: tombol suara + crop grid profil.
 * 16:9: title-safe biasa. SATU sumber untuk subtitle, judul, kode AI (data.safeArea), dan garis bantu pratinjau.
 */
export const SAFE_AREA = {
  "16:9": { top: 0.06, bottom: 0.08, left: 0.06, right: 0.06 },
  "9:16": { top: 0.12, bottom: 0.24, left: 0.06, right: 0.14 },
  "4:5": { top: 0.06, bottom: 0.13, left: 0.07, right: 0.07 },
} as const satisfies Record<AspectId, { top: number; bottom: number; left: number; right: number }>;

// ----------------------------------------------------------------- kamera
export const CAMERA = {
  // Skala minimum: sedikit di atas 1 supaya drift tidak memperlihatkan tepi hitam
  baseScale: 1.01,
  // Rentang gerakan otomatis yang dihapus pengguna di timeline (Fase 11)
  maxMuted: 300,
  // Batas zoom (sebagai kelipatan ukuran frame). Di atas ~1,2x pada sumber 1080p mulai pecah.
  maxScale1080: 1.2,
  maxScale4k: 1.6,
  // Sumber 16:9 yang dipotong jadi 9:16 (~1,8x) atau 4:5 (~1,25x) sudah diperbesar, jadi zoom tambahan dibatasi lebih ketat
  maxScaleCrop: 1.08,
  // Drift handheld sangat kecil (piksel pada frame output)
  driftPx: 2,
  driftHz: 0.35,
  // Panjang satu gerakan (detik pada timeline hasil)
  minMoveSec: 2.5,
  maxMoveSec: 8,
  // Segmen yang lebih pendek dari ini ditahan diam: gerakan secepat itu terlihat seperti sentakan
  holdBelowSec: 0.6,
  // Besar gerakan tiap preset
  pushInDelta: 0.1,
  pullBackDelta: 0.12,
  panAmount: 0.03, // pecahan lebar frame
  panScale: 1.07,
  tiltDeg: 0.7,
  zoomPointDelta: 0.14,
  // Permintaan pengguna ("zoom saat aku bilang X"): rentang minimum, dan jeda sebelum/sesudah frasa (detik)
  overrideMinSec: 1.5,
  overrideLeadSec: 0.5,
  overrideTailSec: 1.0,
  // Jumlah override maksimum per video
  overrideMax: 60,
  // Titik untuk zoom-point (pecahan frame). Tanpa face tracking: posisi tetap, kira-kira wajah talking head
  zoomPoint: { x: 0.5, y: 0.38 },
  // Preset bawaan (energi tenang/sedang). Zoom kiri/kanan hanya dipakai pada energi "energik" atau bila diminta.
  presets: ["push-in", "pull-back", "pan", "tilt", "zoom-point"] as readonly CameraPreset[],
  // Titik fokus zoom kiri dan kanan (pecahan frame), dipakai bergantian ala video pendek
  zoomLeft: { x: 0.3, y: 0.4 },
  zoomRight: { x: 0.7, y: 0.4 },
} as const;

export const ALL_PRESETS = ["push-in", "pull-back", "pan", "tilt", "zoom-point", "zoom-left", "zoom-right"] as const;
export type CameraPreset = (typeof ALL_PRESETS)[number];

export const CAMERA_PATTERNS = {
  otomatis: { label: "Otomatis", presets: ALL_PRESETS },
  sinematik: { label: "Sinematik", presets: ["push-in", "pan", "pull-back", "tilt"] },
  "kiri-kanan": { label: "Kiri–kanan", presets: ["zoom-left", "pull-back", "zoom-right", "pan"] },
  "maju-mundur": { label: "Maju–mundur", presets: ["push-in", "pull-back"] },
} as const satisfies Record<string, { label: string; presets: readonly CameraPreset[] }>;
export type CameraPattern = keyof typeof CAMERA_PATTERNS;

// Tingkat energi kamera: seberapa sering dan seberapa besar gerakan.
export type Energy = "tenang" | "sedang" | "energik";
export const ENERGY = {
  tenang: { label: "Tenang", minMoveSec: 3.5, maxMoveSec: 10, deltaMul: 0.6, extraPresets: false },
  sedang: { label: "Sedang", minMoveSec: 2.5, maxMoveSec: 8, deltaMul: 1, extraPresets: false },
  energik: { label: "Energik", minMoveSec: 1.5, maxMoveSec: 4, deltaMul: 1.5, extraPresets: true },
} as const;

// Grain digeser tiap sekian frame (makin jarang makin kecil file)
export const GRAIN_EVERY_FRAMES = 4;

export const EASING = {
  // Tidak ada gerakan linear. Kurva bezier ease-in-out untuk gerakan kamera.
  camera: [0.45, 0, 0.2, 1] as [number, number, number, number],
  // Spring untuk "pop" kata subtitle
  spring: { damping: 14, stiffness: 180, mass: 0.6 },
  // "Pop" kata: hampir tanpa overshoot agar tidak menimpa kata di sebelahnya
  pop: { damping: 22, stiffness: 260, mass: 0.5 },
} as const;

// --------------------------------------------------------------- subtitle
// Animasi teks per kata: sorot = kata aktif berwarna; pop = kata muncul satu per satu dengan "pop";
// kotak = kata aktif diberi kotak warna; pendek = 1-3 kata besar sekaligus (ala video pendek).
export type CaptionAnim = "sorot" | "pop" | "kotak" | "pendek" | "kinetik" | "blur-slide";
export const CAPTION_ANIMS = {
  "blur-slide": { label: "Blur slide" },
  kinetik: { label: "Kinetik editorial" },
  sorot: { label: "Sorot" },
  pop: { label: "Pop" },
  kotak: { label: "Kotak" },
  pendek: { label: "Pendek besar" },
} as const;

export const SUBTITLE = {
  // Animasi "pendek": jumlah kata per halaman dan pembesaran font
  chunkWords: 3,
  chunkFontScale: 1.35,
  // Animasi "kotak": kotak di belakang kata aktif (em)
  boxPadXEm: 0.18,
  boxPadYEm: 0.04,
  boxRadiusEm: 0.22,
  // Animasi "pop": skala awal kata sebelum membesar ke 1
  popFromScale: 0.55,
  maxLines: 2,
  // Karakter maksimum per baris
  // 4:5 selebar 9:16 tapi lebih pendek dan dilihat lebih kecil di feed: font sedikit lebih kecil, baris sedikit lebih panjang
  maxCharsPerLine: { "16:9": 34, "9:16": 20, "4:5": 22 },
  fontSizePx: { "16:9": 64, "9:16": 76, "4:5": 70 },
  lineHeight: 1.18,
  // Halaman baru bila jeda antar kata melebihi ini (detik)
  maxPauseSec: 0.7,
  // Satu halaman tampil paling lama (detik)
  maxPageSec: 5,
  // Subtitle muncul sedikit sebelum kata pertama, bertahan sedikit sesudah kata terakhir
  leadSec: 0.05,
  lingerSec: 0.25,
  // Zona aman (pecahan tinggi/lebar), diturunkan dari SAFE_AREA. 9:16 menghindari UI Instagram/TikTok di bawah, kiri,
  // dan kolom tombol di kanan (right lebih besar dari side: subtitle bergeser sedikit ke kiri, tidak tertimpa tombol like).
  safeZone: {
    "16:9": { bottom: SAFE_AREA["16:9"].bottom, side: 0.08, right: 0.08 },
    "9:16": { bottom: SAFE_AREA["9:16"].bottom, side: 0.07, right: SAFE_AREA["9:16"].right },
    // Feed tidak menutupi bagian bawah video setebal Reels; tetap beri ruang untuk crop grid profil dan tombol suara
    "4:5": { bottom: SAFE_AREA["4:5"].bottom, side: 0.07, right: 0.07 },
  },
  // Kata aktif sedikit terangkat (em). Tidak membesar: pembesaran menimpa spasi di samping kata.
  activeLiftEm: 0.07,
  // Ukuran font dan garis tepi dirancang untuk tinggi frame ini, lalu diskalakan ke tinggi output
  referenceHeight: { "16:9": 1080, "9:16": 1920, "4:5": 1350 },
  // Bayangan teks (em dari ukuran font)
  shadowOffsetEm: 0.05,
  shadowBlurEm: 0.12,
} as const;

// ------------------------------------------------------------------- gaya
// Maksimal 3 warna utama: teks, aksen, dan warna gelap untuk bayangan/overlay.
export type StyleDef = {
  label: string;
  colors: { text: string; accent: string; dark: string };
  // Opasitas kata yang belum/sudah selesai diucapkan
  dimOpacity: number;
  fontWeight: number;
  uppercase: boolean;
  strokePx: number;
  // Bawaan gaya ini; pengguna boleh menimpa lewat pilihan "Energi kamera" dan "Animasi teks".
  captionAnim: CaptionAnim;
  energy: Energy;
  // Efek film tipis. Grain berganti-ganti sehingga tidak bisa dikompres: tiap kenaikan membengkakkan ukuran file.
  vignette: number;
  gradient: number;
  grain: number;
};

export const STYLES = {
  motion: {
    label: "Motion",
    colors: { text: "#F3F1E9", accent: "#BEF264", dark: "#101512" },
    dimOpacity: 0.65,
    fontWeight: FONT.weightBold,
    uppercase: true,
    strokePx: 0,
    captionAnim: "kinetik",
    energy: "energik",
    vignette: 0.12,
    gradient: 0.18,
    grain: 0.012,
  },
  bersih: {
    label: "Bersih",
    colors: { text: "#FFFFFF", accent: "#FFD84D", dark: "#0B0B0F" },
    dimOpacity: 0.5,
    fontWeight: FONT.weightBold,
    uppercase: false,
    strokePx: 6,
    captionAnim: "sorot",
    energy: "sedang",
    vignette: 0.22,
    gradient: 0.18,
    grain: 0.025,
  },
  tebal: {
    label: "Tebal",
    colors: { text: "#FFFFFF", accent: "#3DDC97", dark: "#050507" },
    dimOpacity: 0.42,
    fontWeight: FONT.weightBold,
    uppercase: true,
    strokePx: 8,
    captionAnim: "sorot",
    energy: "sedang",
    vignette: 0.3,
    gradient: 0.22,
    grain: 0.03,
  },
  lembut: {
    label: "Lembut",
    colors: { text: "#F4F1EA", accent: "#FF8A5B", dark: "#14100E" },
    dimOpacity: 0.55,
    fontWeight: FONT.weightRegular,
    uppercase: false,
    strokePx: 5,
    captionAnim: "sorot",
    energy: "sedang",
    vignette: 0.16,
    gradient: 0.12,
    grain: 0.02,
  },
  modern: {
    label: "Modern",
    colors: { text: "#FFFFFF", accent: "#25F4EE", dark: "#08080C" },
    dimOpacity: 0.0,
    fontWeight: FONT.weightBold,
    uppercase: true,
    strokePx: 0,
    captionAnim: "pop",
    energy: "energik",
    vignette: 0.1,
    gradient: 0.14,
    grain: 0.015,
  },
} as const satisfies Record<string, StyleDef>;
export type StyleId = keyof typeof STYLES;

// Motion system: seconds and relative dimensions, shared by preview and renderer.
export const MOTION = {
  title: { maxCount: 12, maxChars: 120, maxDurationSec: 20, wordStaggerSec: 0.12, scale: 1.8, maxHeight: 0.24, topBottom: 0.72, centerBottom: 0.42 },
  // Adapted from Shotcraft BlurSlide and PageCam; see docs/motion-sources.md.
  blurSlide: { durationSec: 22 / 30, travelEm: 64 / 170, blurEm: 18 / 170, outPower: 5 },
  spatial: { perspective: 1.6, tiltX: 7, tiltY: 9, roll: 1.2, parallaxX: 0.025, periodSec: 6 },
  entranceSec: 0.48,
  exitSec: 0.32,
  wordRevealSec: 0.28,
  wordTravelEm: 0.65,
  wordRotationDeg: 5,
  wordSpring: { damping: 24, stiffness: 240, mass: 0.75 },
  pageExitEm: 0.28,
  maxWords: 4,
  captionScale: 1.28,
  captionGapEm: 0.22,
  captionLineHeight: 1.12,
  captionMaxWidth: 0.84,
  underlineHeightEm: 0.055,
  underlineOffsetEm: 0.07,
  frameScale: 0.82,
  frameLift: 0.055,
  frameRadius: 0.022,
  frameShadow: 0.07,
  sceneMinSec: 2.4,
  sceneMaxSec: 4.2,
  sceneGapSec: 7,
  sceneLeadSec: 0.15,
  sceneStartSec: 0.65,
  ringSize: 0.48,
  ringStroke: 0.001,
  orbitSec: 16,
  lineWidth: 0.2,
  lineThickness: 0.002,
  detailOpacity: 0.16,
  strength: 1,
  showcase: {
    durationSec: 18, sceneSec: 6, staggerSec: 0.16,
    inset: 0.075, titleSize: 0.145, labelSize: 0.017,
    tracking: -0.055, titleLineHeight: 0.98,
    cardRadius: 0.025, cardPortraitTop: 0.59,
    lineDelaySec: 0.8, ringDrawSec: 1.4, ringDegreesPerSec: -18, squareDegreesPerSec: 45,
    cardDelaySec: 0.3, cardFloatPeriodSec: 6, cardFloatPhaseSec: 1,
    barRadiansPerSec: 2.4, barPhaseRadians: 0.7,
    captionScale: 2.2, captionBottom: 0.43,
    captionPages: [
      { start: 12.5, end: 13.75, words: ["SETIAP", "KATA"] },
      { start: 13.8, end: 15.05, words: ["PUNYA", "RITME."] },
      { start: 15.1, end: 16.4, words: ["PUNYA", "KARAKTER."] },
      { start: 16.5, end: 18, words: ["BUAT", "VERSIMU."] },
    ],
    titles: [["BUAT IDE", "TERASA", "HIDUP."], ["RITME.", "FOKUS.", "KARAKTER."], ["SETIAP KATA", "PUNYA", "GERAK."]],
    labels: ["01 / REVEAL & ANTICIPATION", "02 / COMPOSITION & RHYTHM", "03 / KINETIC TYPOGRAPHY"],
  },
} as const;

// Komposisi contoh (demo Fase 1)
export const COLORS = {
  background: "#0B0B0F",
  text: "#FFFFFF",
  accent: "#FFD84D",
} as const;
export const DEMO = { fontSizePx: 120 } as const;

// ------------------------------------------------------------------ efek editing
// Diadaptasi dari resep Shotcraft (crash-zoom-punch, slam-entrance-moves, marker-underline-title, glitch-cycle)
// dan transisi DigitalSamba toolkit (zoom-blur, glitch). Semua berbasis frame, dipakai pratinjau dan render.
export const FONTS = {
  jakarta: { label: "Plus Jakarta Sans" },
  montserrat: { label: "Montserrat (ExtraBold)" },
  inter: { label: "Inter (Black)" },
} as const;
export type FontId = keyof typeof FONTS;

export const FX = {
  transition: {
    kinds: ["tidak", "whip", "zoom", "glitch"] as const,
    // Total frame (separuh sebelum sambungan, separuh sesudah)
    frames: 8,
    whipTravel: 0.45, // pecahan lebar layar
    whipBlurPx: 48, // pada tinggi 1080
    zoomScale: 1.55,
    zoomBlurPx: 22,
    glitchJitter: 0.04, // pecahan lebar layar
    glitchBars: 7,
    // Garis glitch: warna aksen gaya + dua warna pecahan RGB
    glitchColors: ["#FF2D95", "#25F4EE"] as const,
    glitchBarOpacity: 0.35,
  },
  // Guncangan: amplitudo (px pada tinggi 1080) dengan peluruhan eksponensial; crash-zoom-punch: 14px·e^(−t/1.8f), habis 6f
  shake: { ampPx: 16, tauFrames: 1.8, frames: 7, minGapSec: 0.5 },
  // Dutch tilt sesekali: masuk cepat, tahan, lalu snap kembali
  tilt: { inFrames: 4, holdSec: 0.55, outFrames: 3, everyNthPage: 4, minGapSec: 5 },
  // Kata kunci (aksen): ukuran 1.3x, kotak menyapu kiri ke kanan (marker-underline: 8–12f)
  keyword: { scale: 1.3, sweepFrames: 8, padXEm: 0.14, padYEm: 0.02, radiusEm: 0.12 },
  // Slam: dari 3x ke 1x dalam 6f ease-in (score-slam), lalu spring; guncangan di frame mendarat
  slam: { fromScale: 3, frames: 6, scale: 1.3 },
  highlightMax: 40,
  // Teks keluar halus
  exitSec: 0.12,
  exitTravelEm: 0.25,
  // Judul hook: tiap kata masuk dari arah berbeda lalu menyatu
  hook: { wordSec: 0.22, travel: 0.6, maxWords: 8 },
  // Lower third: garis tipis tumbuh, teks geser masuk
  lowerThird: { lineFrames: 10, textDelayFrames: 5, textFrames: 12, exitFrames: 10, left: 0.07, bottom: { "16:9": 0.22, "9:16": 0.36, "4:5": 0.26 }, fontScale: 0.62, subScale: 0.42, lineEm: 0.06 },
} as const;
export type TransitionKind = (typeof FX.transition.kinds)[number];

// Kata kunci otomatis dari transkrip (kode, bukan AI): skor kata bermakna, jarak minimum antar sorotan.
export const AUTO_KEYWORDS = {
  // Jarak minimum antar kata aksen (detik hasil bicara) menurut kepadatan
  gapSec: { jarang: 6, sedang: 3.5, sering: 2 },
  slamGapSec: 8,
  slamMax: 3,
  // Satu kata yang sama paling banyak disorot sekian kali; slam selalu kata berbeda
  maxRepeats: 2,
  // Kata dengan keyakinan Whisper di bawah ini tidak dipilih (aturan 7: jangan menyorot kata yang mungkin salah dengar)
  minConfidence: 0.5,
  minLetters: 4,
  numberWords: ["satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas", "puluh", "ratus", "ribu", "juta", "miliar", "triliun", "persen", "pertama", "kedua", "ketiga"],
  // Kata fungsi bahasa Indonesia sehari-hari (+ beberapa Inggris) yang tidak pernah jadi kata kunci
  stopwords: [
    "yang", "dan", "atau", "tapi", "tetapi", "karena", "kalau", "jika", "maka", "jadi", "juga", "lagi", "sudah", "udah", "belum", "akan", "bisa", "mau", "ingin", "harus", "boleh",
    "ini", "itu", "sini", "situ", "sana", "saya", "aku", "gue", "gua", "kamu", "kalian", "kita", "kami", "mereka", "dia", "beliau", "anda", "lu", "lo",
    "ada", "adalah", "untuk", "buat", "dengan", "dari", "pada", "kepada", "dalam", "oleh", "tentang", "seperti", "kayak", "sama", "bagi", "antara",
    "tidak", "gak", "nggak", "enggak", "ngga", "bukan", "jangan", "iya", "yaa", "kan", "sih", "deh", "dong", "nih", "tuh", "aja", "saja", "banget", "sangat", "cuma", "hanya",
    "terus", "lalu", "kemudian", "nanti", "tadi", "sekarang", "masih", "pernah", "sedang", "lagi", "gitu", "gini", "begitu", "begini", "punya", "semua", "setiap", "banyak", "sedikit",
    "kenapa", "bagaimana", "gimana", "apa", "siapa", "kapan", "dimana", "mana", "berapa", "biar", "supaya", "agar", "kok", "loh", "lho", "eh", "oke", "okay",
    "the", "and", "that", "this", "with", "have", "your", "what", "just", "like",
  ],
} as const;
// Animasi judul: hook = kata masuk bergantian dari atas/kiri/kanan lalu menyatu; lower-third = garis tipis + label kiri bawah.
export const TITLE_ANIMS = ["kinetik", "blur-slide", "hook", "lower-third"] as const;

// ------------------------------------------------------------ mode kreatif
// Kode Remotion buatan AI (Fase 9): batas ukuran dan cache compile per string kode.
// ------------------------------------------------- klip motion penutup / CTA (Fase 18)
/** Rentang mengikuti MOTION_GFX.durationS (batas yang dipakai saat AI membuat motion). */
export const END_CLIP = { seconds: { min: 3, max: 60, step: 0.5, default: 5 } } as const;

// ------------------------------------------------- Opinion Motion: motion + aset internet (Fase 19)
/**
 * Riset aset: AI (CLI dengan pencarian web) menandai sebutan tokoh/berita/brand/tempat di naskah, kode kita mengunduh gambar
 * dan mengambil screenshot artikel. Tidak ada aset yang dipakai sebelum pengguna memilihnya.
 */
export const OPINION = {
  /** Jenis sebutan yang dicari asetnya. */
  types: ["tokoh", "berita", "brand", "tempat"] as const,
  /**
   * Kepadatan aset: target ±1 aset internet tiap `secondsPerAsset` detik voice over, agar seimbang dengan adegan motion murni
   * (2 menit = ±15 aset, bukan segelintir). `maxGapS` = jeda terpanjang yang diusahakan tanpa aset. AI tidak boleh mengisi
   * kekurangan dengan aset yang meragukan (aturan 7): kurang dari target = dijelaskan di catatan.
   */
  density: { secondsPerAsset: 8, min: 4, maxGapS: 20 },
  /** Batas keras jumlah sebutan per riset (skema + validasi). */
  maxMentions: 40,
  /** Kandidat gambar per sebutan (tokoh/brand/tempat) yang diminta dari AI dan yang disimpan. */
  maxCandidates: 4,
  /** Batas waktu satu riset (AI + unduhan + screenshot). Pencarian web bisa lama. */
  researchTimeoutMs: 25 * 60 * 1000,
  /** Model bawaan per provider (id dari AI_MODELS). Riset tidak butuh model terbesar. */
  defaultModel: { claude: "claude-sonnet-5-5", codex: "" },
  image: {
    maxBytes: 25 * 1024 * 1024,
    /** Gambar di bawah ini (sisi terpendek) dianggap terlalu kecil untuk video. */
    minShortSide: 200,
    /** Hasil encode ulang: sisi terpanjang maksimal, kualitas JPEG ffmpeg (2 = terbaik, 31 = terburuk). */
    maxLongSide: 2000,
    jpegQ: 3,
    /** Berkas asli Wikimedia Commons bisa puluhan MB: minta thumbnail resmi selebar ini (salah satu lebar standar Wikimedia). */
    wikimediaThumbWidth: 1920,
    timeoutMs: 20000,
    maxRedirects: 3,
  },
  screenshot: {
    /** Viewport per bentuk video: vertikal memakai tampilan ponsel agar teks besar dan terbaca. */
    viewport: { portrait: { width: 430, height: 932, scale: 2 }, landscape: { width: 1280, height: 800, scale: 1.5 } },
    navTimeoutMs: 25000,
    /** Tunggu sesudah halaman dimuat (gambar malas, banner). */
    settleMs: 2000,
    /** Tinggi maksimal potongan (px CSS) dan jarak tepi di sekitar elemen fokus. */
    maxClipHeight: 1400,
    padding: 24,
    /** Tinggi potongan "judul": judul + byline/tanggal + awal foto utama. */
    headlineExtra: 420,
    /** Sorotan kutipan (seperti stabilo). */
    highlight: { background: "#FFE45C", color: "#111111" },
    /** Halaman dengan teks lebih sedikit dari ini dianggap terblokir/paywall. */
    minTextChars: 400,
  },
  /** Label kredit sumber di layar (Fase 19: bawaan menyala, bisa dimatikan per project). */
  credit: { prefix: "Sumber: " },
} as const;

// ------------------------------------------------- Aset sendiri di video bicara (Fase 21)
/**
 * Gambar milik pengguna + keterangan. AI (tanpa internet, tanpa melihat gambar) mencocokkan keterangan dengan transkrip dan
 * MENGUSULKAN waktu munculnya; pengguna yang memutuskan. Waktu disimpan dalam detik video mentah (ikut bergeser bila cut berubah).
 */
export const OWN_ASSETS = {
  /** Panjang keterangan per aset. */
  noteMaxChars: 400,
  /** Rentang kata satu penempatan (indeks inklusif) dan jumlah alternatif selain usulan utama. */
  maxSpanWords: 40,
  maxAlternatives: 2,
  /** "Pakai di posisi playhead": rentang kata yang diambil mulai dari kata di playhead. */
  hereWords: 6,
  timeoutMs: 10 * 60 * 1000,
  /** Model bawaan per provider (id dari AI_MODELS). Mencocokkan teks tidak butuh model terbesar. */
  defaultModel: { claude: "claude-sonnet-5-5", codex: "" },
} as const;

// ------------------------------------------------- motion graphics berdiri sendiri (Fase 13)
export const MOTION_GFX = {
  durationS: { min: 3, max: 60, default: 8 },
  /** Latar kanvas bila kode AI tidak menggambar latar sendiri. */
  background: "#0B0D0F",
  materials: { max: 12, maxBytes: 80 * 1024 * 1024, image: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"], audio: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/aac", "audio/ogg"] },
  /**
   * Knowledge (PDF, teks, link) yang dianalisis AI sebelum membuat motion, agar pesannya tepat sasaran.
   * Link diambil server kita (agen AI tidak punya jaringan), dijadikan teks, dan disimpan sebagai dokumen.
   */
  knowledge: {
    mimes: ["application/pdf", "text/plain", "text/markdown"],
    maxPdfBytes: 30 * 1024 * 1024,
    /** Teks per dokumen (link/TXT/MD) yang disimpan untuk AI. */
    maxTextChars: 60000,
    link: { timeoutMs: 15000, maxBytes: 3 * 1024 * 1024, maxRedirects: 3 },
  },
  /** Data/angka (CSV kecil) yang dianimasikan menjadi grafik. */
  table: { maxRows: 50, maxCols: 8, maxChars: 4000 },
  musicVolume: 1,
  /**
   * Voice over dari naskah pengguna dengan suara rekamannya sendiri (Fase 17): Codex CLI menyiapkan naskah baca, VoxCPM2 (lokal)
   * meniru suara rekaman, Whisper mencatat waktu tiap kata untuk sinkronisasi animasi.
   */
  voiceover: {
    engine: "voxcpm2",
    pythonPackage: "voxcpm==2.0.3",
    modelRepo: "openbmb/VoxCPM2",
    /** Sumber PyTorch saat setup; env VOICEOVER_TORCH_INDEX menimpa (mis. build CUDA di mesin ber-GPU). */
    torchIndex: "https://download.pytorch.org/whl/cpu",
    /** venv Python di dalam .cache (dibuat `npm run setup:voiceover`); env VOICEOVER_PYTHON menimpa. */
    venvDir: ".cache/py-voxcpm",
    modelDir: ".cache/voxcpm2",
    language: "id",
    /** Teks yang dibacakan pengguna saat merekam, sekaligus transkrip rekaman untuk model. */
    recording: {
      text: "Selamat datang. Hari ini saya ingin berbagi sesuatu yang sederhana, tetapi bisa mengubah cara kita bekerja. Pernahkah Anda merasa waktu habis untuk pekerjaan yang sama setiap hari? Mari kita lihat bersama, langkah demi langkah, bagaimana semua itu bisa menjadi jauh lebih mudah.",
      minS: 8,
      maxS: 40,
      maxBytes: 20 * 1024 * 1024,
      /** Di bawah ini rekaman diperingatkan terlalu pelan. */
      minRms: 0.008,
    },
    /** Voice over yang sudah jadi, diunggah pengguna: tanpa arahan dan mesin suara, hanya waktu kata Whisper. */
    upload: {
      engine: "unggahan",
      maxBytes: 100 * 1024 * 1024,
      exts: [".mp3", ".m4a", ".wav", ".aac", ".ogg"],
    },
    seed: 42,
    maxScriptChars: 5000,
    maxDurationS: 300,
    /** Teks dipecah per kalimat agar mutu terjaga dan kemajuan terlihat; jeda antarpotongan. */
    maxChunkChars: 220,
    chunkGapS: 0.25,
    /** Jeda setelah kata terakhir sebelum video selesai. */
    tailS: 0.6,
    volume: 1,
    /** Volume musik (pengali) selama suara bicara, lama transisinya, dan jeda antarkata yang tetap dihitung bicara. */
    musicDuck: 0.25,
    duckRampS: 0.25,
    duckGapS: 0.6,
    audioBitrate: "160k",
    /** Batas waktu arahan Codex; lewat batas = naskah dibaca apa adanya dan dicatat. */
    codexTimeoutMs: 3 * 60 * 1000,
    /** Pengaman untuk proses yang macet. Terukur di CPU i5-10400: 3 menit suara butuh sekitar 2 jam, jadi 5 menit sekitar 3 jam. */
    ttsTimeoutMs: 6 * 60 * 60 * 1000,
    /** Perkiraan untuk UI, dari uji 3 Nov 2026 di CPU i5-10400 (RTF 34,7; muat model 480 dtk). */
    estimatedRtf: 35,
    loadS: 480,
    charsPerSecond: 15,
    /** Pengaman naskah baca: panjang relatif terhadap naskah, dan porsi kata naskah yang harus tetap ada. */
    reading: { minLengthRatio: 0.6, maxLengthRatio: 2.5, minWordsKept: 0.6 },
    /**
     * Arahan suara dari Codex: himpunan TERTUTUP, kalimat kontrol VoxCPM2 disusun kode kita dari tabel ini (bukan ditulis AI).
     * `hint` masuk ke prompt Codex, `label` tampil di UI, `control` dikirim ke mesin suara.
     */
    direction: {
      emotions: {
        netral: { label: "Netral", hint: "informasi biasa", control: "natural conversational tone" },
        hangat: { label: "Hangat", hint: "menyapa, mengajak, akrab", control: "warm and friendly tone, gently smiling" },
        antusias: { label: "Antusias", hint: "kabar baik, hasil, manfaat, ajakan bertindak", control: "energetic and excited tone" },
        serius: { label: "Serius", hint: "masalah, risiko, fakta penting", control: "serious and focused tone" },
        tegas: { label: "Tegas", hint: "pernyataan kunci, kesimpulan", control: "confident and firm tone" },
        lembut: { label: "Lembut", hint: "empati, menenangkan", control: "soft and gentle tone" },
        penasaran: { label: "Penasaran", hint: "pertanyaan, memancing rasa ingin tahu", control: "curious and intriguing tone" },
      },
      intonations: {
        wajar: { label: "Wajar", hint: "naik turun biasa", control: "natural intonation" },
        ekspresif: { label: "Ekspresif", hint: "naik turun lebar, untuk bagian yang perlu hidup", control: "expressive intonation with lively pitch variation" },
        naik: { label: "Naik di akhir", hint: "bertanya, menggantung", control: "rising intonation at the end" },
        turun: { label: "Turun di akhir", hint: "menutup dengan mantap", control: "falling intonation at the end" },
      },
      paces: {
        pelan: { label: "Pelan", hint: "bagian yang perlu dicerna", control: "slower pace" },
        sedang: { label: "Sedang", hint: "bawaan", control: "moderate pace" },
        cepat: { label: "Cepat", hint: "daftar, semangat", control: "slightly faster pace" },
      },
      /** Jeda setelah tiap segmen dijepit ke rentang ini. */
      minPauseS: 0.1,
      maxPauseS: 1.5,
      defaultPauseS: 0.3,
      maxSegments: 135,
    },
  },
} as const;

export const CREATIVE = {
  // Sama dengan batas octet_length di tabel creative_versions (migrasi 20261030120000). 60 KB terlalu kecil untuk revisi bertumpuk.
  maxCodeBytes: 200_000,
  cacheSize: 40,
  // Batas aman nilai yang dikembalikan fungsi gerak video
  maxStyleChars: 400,
  // Job 'creative' (Fase 9.2)
  defaultModel: "claude-opus-5-5",
  // Brief yang sangat terbuka ("sekreatif mungkin") bisa membuat Opus menulis lebih dari 10 menit (uji 29 Okt 2026).
  // Atas permintaan pengguna praktis tanpa batas: 3 jam hanya pengaman untuk proses yang macet; tombol Batalkan tetap ada.
  timeoutMs: 3 * 60 * 60_000,
  // Waktu yang selalu disisakan untuk validasi, still, dan perbaikan: AI berhenti menulis lebih awal, dan kode yang
  // sudah ditulis tetap diuji (bukan dibuang karena batas waktu total)
  agentReserveMs: 4 * 60_000,
  // Putaran perbaikan setelah validasi gagal (di luar percobaan pertama)
  repairRounds: 2,
  maxTurns: 60,
  maxPromptChars: 8000,
  // Screenshot masalah yang dilampirkan ke satu perintah: hanya dilihat AI, tidak pernah masuk video
  screenshots: { max: 4, maxBytes: 10 * 1024 * 1024, ext: { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" } },
  // Interval memeriksa apakah job dibatalkan pengguna
  cancelPollMs: 2000,
  // Still pratinjau: skala render dan jarak dari sambungan cut (frame) agar transisi tertangkap
  stillScale: 0.5,
  stillJoinOffsetFrames: 3,
  // Batas baca keluaran AI (notes.md)
  maxNotesChars: 8000,
  // Rentang (detik mentah) tempat lapisan kreatif tampil, diatur di timeline (Fase 10)
  maxRanges: 200,
  // Sumber skill, dipin ke commit yang sudah diperiksa (docs/motion-sources.md).
  // Pin shotcraft/toolkit harus sama dengan scripts/studio-reference.mjs (dijaga tes).
  skills: {
    remotion: { repo: "https://github.com/remotion-dev/skills", sha: "30d4553ecd46fbc5212fd0ff006ae43af522158b" },
    shotcraft: { repo: "https://github.com/Vincentwei1021/video-shotcraft.git", sha: "43bd349a136651865ecfa6ea1cf012f6e957d304", dir: "shotcraft-source", sparse: ["references", "assets/lib", "demos/typography/blur-slide", "demos/_fixtures"] },
    toolkit: { repo: "https://github.com/digitalsamba/claude-code-video-toolkit.git", sha: "da3f474c1230d161be1384ef97aec27f73b11636", dir: "toolkit-source", sparse: ["lib", ".claude/skills/remotion", "examples/hello-world"] },
    // Cerita dan karakter (canvas procedural, MIT). Dipakai sebagai bacaan lewat adaptor apps/worker/src/creative/skills/animate-story.md
    animate: { repo: "https://github.com/cth9191/animate.git", sha: "7e5eb56feb2dd573f890e1b7b34748af43d58263", dir: "animate-source", sparse: ["plugins/animate/skills/animate"] },
  },
} as const;

// ------------------------------------------------------------------ batas
export const LIMITS = {
  // One editorial prompt can configure every registered parameter plus scene accents.
  promptOperations: 64,
  // Ruang disk yang disisakan untuk hasil render dan cache saat menerima unggahan
  diskReserveBytes: 1024 * 1024 * 1024,
} as const;

export const REFERENCE = {
  maxBytes: 150 * 1024 * 1024,
  sampleSeconds: 30,
  frameCount: 16,
  frameMaxSize: 640,
  timeoutMs: 180_000,
  maxStartS: 6 * 60 * 60,
} as const;

export const MANUAL = {
  scrubIntervalMs: 100,
  maxCuts: 500,
  maxSplits: 500,
  // Bagian terpotong yang dipulihkan pengguna (tarik tepi klip ke luar)
  maxKeeps: 500,
  // Subtitle sebagai klip mandiri (Fase 10): batas jumlah klip, kata per klip, panjang teks, durasi minimum
  subtitles: { maxClips: 3000, maxWords: 40, maxChars: 240, minSec: 0.1 },
  maxKeyframes: 200,
  historySize: 80,
  snapSeconds: 0.12,
  titleSeconds: 3,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  // Geser video langsung di canvas (seperti Canva): roda mouse = zoom video.skala, rentang zoom lewat roda
  pan: { wheelZoomRate: 0.0015, zoomMin: 1, zoomMax: 4 },
} as const;

// ----------------------------------------------------------------- analisis
export const ANALYSIS = {
  // Jeda minimal (detik) dianggap usulan cut
  minPauseSec: 0.7,
  // Ambang diam paling ketat. Ambang sebenarnya per video: lantai noise + margin (rekaman ponsel di ruangan sering
  // berdesis di atas -35 dB sehingga jeda tidak pernah terdeteksi; uji 31 Okt 2026: lantai -39,5 dB -> ambang -27,5 dB).
  silenceThresholdDb: -35,
  // Lantai noise = persentil ke-10 level RMS jendela 50 ms; ambang = lantai + margin, dibatasi maksimal.
  noiseFloorPercentile: 0.1,
  silenceFloorMarginDb: 12,
  silenceMaxThresholdDb: -20,
  // Dari jeda yang dipotong, sisakan sebanyak ini agar napas alami tetap ada (dibagi dua sisi)
  keepPauseSec: 0.3,
  // Filler satu kata, dicocokkan setelah huruf kecil dan tanda baca dibuang.
  // Frasa ("ya kan", "jadi gini") sengaja tidak otomatis: terlalu sering kata sah.
  fillers: ["eh", "ehm", "em", "emm", "hmm", "hm", "uh", "uhm", "um", "umm", "anu"],
  // Pembagian transkrip panjang ke potongan untuk CLI
  chunkWords: 350,
  chunkOverlapWords: 50,
  // Kata dengan confidence di bawah ini dianggap "tidak yakin" (aturan 7)
  unclearConfidence: 0.4,
  unclearMinRun: 3,
  // Batas waktu satu panggilan CLI
  cliTimeoutMs: 5 * 60 * 1000,
  // Model awal Auto cut per provider (id dari AI_MODELS; "" = bawaan akun CLI). Opus paling teliti memilih retake/salah ucap.
  defaultModel: { claude: "claude-opus-5-5", codex: "" },
} as const;

// ----------------------------------------------------------------- model AI
// Pilihan model per provider untuk prompt editing. id "" = model bawaan akun CLI.
// Hanya id di daftar ini yang boleh diteruskan ke CLI (mencegah argumen sembarang dari browser).
export const AI_MODELS = {
  claude: [
    { id: "", label: "Bawaan akun" },
    { id: "claude-opus-5-5", label: "Opus 5.5 (paling teliti)" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5 (cepat)" },
  ],
  codex: [{ id: "", label: "Bawaan akun" }],
} as const;

export function isAllowedModel(provider: keyof typeof AI_MODELS, model: string): boolean {
  return AI_MODELS[provider].some((m) => m.id === model);
}
