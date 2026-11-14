// Rencana kamera: logika murni (tanpa React/Remotion) agar bisa diuji dan dipakai di browser,
// server, dan renderer dengan rumus yang sama. Semua angka dari @app/config (aturan 8).
import { ALL_PRESETS, CAMERA, CAMERA_PATTERNS, EASING, ENERGY, type CameraPattern, type CameraPreset, type Energy } from "@app/config";

/** x,y = pecahan lebar/tinggi frame; rot = derajat; scale >= 1. */
export type CamState = { scale: number; x: number; y: number; rot: number };

export type CamMove = {
  /** Detik pada timeline HASIL. Gerakan saling menyambung tanpa celah. */
  start: number;
  end: number;
  preset: CameraPreset;
  from: CamState;
  to: CamState;
  /** true = state awal sama dengan state akhir gerakan sebelumnya (tidak ada lompatan). */
  continuous: boolean;
};

/** Gerakan yang diminta pengguna (detik pada timeline HASIL). */
export type CameraOverride = { start: number; end: number; preset: CameraPreset };

export type PlanInput = {
  pattern?: CameraPattern;
  /** Energi kamera: seberapa sering dan seberapa besar gerakan. Bawaan "sedang" (perilaku sebelumnya). */
  energy?: Energy;
  /** Penimpaan halus dari pengguna di atas energi: kekuatan zoom dan panjang gerakan (detik). */
  tuning?: { strength?: number; minMoveSec?: number; maxMoveSec?: number };
  /** Gerakan yang diminta eksplisit. Tidak boleh melintasi sambungan cut; dibersihkan oleh normalizeOverrides. */
  overrides?: CameraOverride[];
  durationS: number;
  /** Waktu (timeline hasil) tempat sambungan cut berada: kamera boleh "reset" di sini. */
  joins: number[];
  /** Waktu akhir kalimat/jeda: tempat alami untuk berganti gerakan di tengah segmen. */
  sentenceEnds: number[];
  width: number;
  height: number;
  maxScale: number;
  seed: number;
};

/** Parameter gerakan menurut tingkat energi. */
export function tuneFor(energy: Energy | undefined, tuning?: PlanInput["tuning"]) {
  const e = ENERGY[energy ?? "sedang"];
  const minMoveSec = tuning?.minMoveSec ?? e.minMoveSec;
  const maxMoveSec = Math.max(minMoveSec + 0.5, tuning?.maxMoveSec ?? e.maxMoveSec);
  return { ...e, minMoveSec, maxMoveSec, deltaMul: e.deltaMul * (tuning?.strength ?? 1) };
}

// ----------------------------------------------------------------- utilitas
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpState = (a: CamState, b: CamState, t: number): CamState => ({
  scale: lerp(a.scale, b.scale, t),
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  rot: lerp(a.rot, b.rot, t),
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kurva cubic-bezier ease-in-out (bukan linear). Newton + bisection, sama dengan CSS. */
export function easeCamera(x: number): number {
  const [x1, y1, x2, y2] = EASING.camera;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  let t = x;
  for (let i = 0; i < 6; i++) {
    const err = sampleX(t) - x;
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(err) < 1e-6 || Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0, hi = 1;
  t = clamp(t, 0, 1);
  for (let i = 0; i < 20 && Math.abs(sampleX(t) - x) > 1e-6; i++) {
    if (sampleX(t) < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

/** Skala maksimum yang aman untuk resolusi sumber dan cara pemotongan ke rasio target. */
export function maxScaleFor(sourceHeight: number, sourceWidth: number, outW: number, outH: number): number {
  const srcAspect = sourceWidth / sourceHeight;
  const outAspect = outW / outH;
  // Sumber lebih lebar dari target (mis. 16:9 -> 9:16) = dipotong dan sudah diperbesar
  const cropped = srcAspect > outAspect * 1.05;
  if (cropped && sourceHeight < 2160) return CAMERA.maxScaleCrop;
  return sourceHeight >= 2160 ? CAMERA.maxScale4k : CAMERA.maxScale1080;
}

// --------------------------------------------------------------- cakupan frame
/**
 * Apakah frame output tertutup penuh oleh video setelah transformasi (tanpa tepi hitam),
 * termasuk simpangan drift terburuk? Transformasi CSS: translate(t) rotate(th) scale(s).
 */
export function isCovered(s: CamState, W: number, H: number, driftPx: number = CAMERA.driftPx): boolean {
  const th = (s.rot * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const tx = s.x * W, ty = s.y * H;
  const eps = 1e-6;
  for (const cx of [-W / 2, W / 2]) {
    for (const cy of [-H / 2, H / 2]) {
      for (const dx of [-driftPx, driftPx]) {
        for (const dy of [-driftPx, driftPx]) {
          const px = cx - (tx + dx), py = cy - (ty + dy);
          // q = R(-th) p / s
          const qx = (cos * px + sin * py) / s.scale;
          const qy = (-sin * px + cos * py) / s.scale;
          if (Math.abs(qx) > W / 2 + eps || Math.abs(qy) > H / 2 + eps) return false;
        }
      }
    }
  }
  return true;
}

/** Naikkan skala (sampai batas) atau kecilkan translasi/rotasi sampai tidak ada tepi hitam. */
function ensureCovered(s: CamState, W: number, H: number, maxScale: number): CamState {
  let st = { ...s, scale: Math.max(s.scale, CAMERA.baseScale) };
  for (let i = 0; i < 400 && !isCovered(st, W, H); i++) {
    if (st.scale + 0.003 <= maxScale) st = { ...st, scale: st.scale + 0.003 };
    else st = { ...st, x: st.x * 0.9, y: st.y * 0.9, rot: st.rot * 0.9, scale: Math.min(maxScale, st.scale) };
  }
  return st;
}

// ------------------------------------------------------------------- drift
/** Getaran handheld sangat kecil, deterministik. Hasil dalam piksel frame output. */
export function driftAt(t: number): { dx: number; dy: number } {
  const w = 2 * Math.PI * CAMERA.driftHz;
  const a = CAMERA.driftPx;
  return {
    dx: a * (0.6 * Math.sin(w * t + 0.7) + 0.4 * Math.sin(w * 2.3 * t + 2.1)),
    dy: a * (0.6 * Math.sin(w * 0.8 * t + 4.0) + 0.4 * Math.sin(w * 1.9 * t + 5.3)),
  };
}

// --------------------------------------------------------- evaluasi di waktu t
export function cameraStateAt(moves: CamMove[], t: number): CamState {
  if (moves.length === 0) return { scale: CAMERA.baseScale, x: 0, y: 0, rot: 0 };
  let m = moves[moves.length - 1];
  for (let i = 0; i < moves.length; i++) {
    if (t < moves[i].end) {
      m = moves[i];
      break;
    }
  }
  const len = Math.max(1e-6, m.end - m.start);
  const p = easeCamera(clamp((t - m.start) / len, 0, 1));
  return lerpState(m.from, m.to, p);
}

// ------------------------------------------------------------------ preset
type Ctx = { W: number; H: number; maxScale: number; rng: () => number; mul: number };

/** Gerakan kandidat untuk satu preset. `from` null = awal bebas (di sambungan cut atau awal video). */
function candidate(preset: CameraPreset, from: CamState | null, c: Ctx, fullPull = false): { from: CamState; to: CamState } {
  const base = CAMERA.baseScale;
  const zp = preset === "zoom-left" ? CAMERA.zoomLeft : preset === "zoom-right" ? CAMERA.zoomRight : CAMERA.zoomPoint;
  const sc = (s: number) => Math.min(c.maxScale, s);
  const zoomXY = (s: number) => ({ x: (1 - s) * (zp.x - 0.5), y: (1 - s) * (zp.y - 0.5) });
  const m = c.mul;
  let f: CamState;
  let t: CamState;

  switch (preset) {
    case "push-in": {
      f = from ?? { scale: base, x: 0, y: 0, rot: 0 };
      t = { scale: sc(f.scale + CAMERA.pushInDelta * m), x: f.x * 0.5, y: f.y * 0.5, rot: f.rot * 0.5 };
      break;
    }
    case "pull-back": {
      f = from ?? { scale: sc(base + CAMERA.pullBackDelta * m), x: 0, y: 0, rot: 0 };
      // fullPull: turun sampai skala dasar (memberi ruang bagi zoom yang diminta pengguna pada gerakan berikutnya)
      t = { scale: fullPull ? base : Math.max(base, f.scale - CAMERA.pullBackDelta * m), x: 0, y: 0, rot: 0 };
      break;
    }
    case "pan": {
      const dir = from ? (from.x > 0.002 ? -1 : from.x < -0.002 ? 1 : c.rng() < 0.5 ? -1 : 1) : c.rng() < 0.5 ? -1 : 1;
      const s = sc(Math.max(from?.scale ?? base, CAMERA.panScale));
      const a = CAMERA.panAmount * Math.max(1, m);
      f = from ?? { scale: s, x: (-dir * a) / 2, y: 0, rot: 0 };
      t = { scale: s, x: from ? f.x + dir * a : (dir * a) / 2, y: f.y * 0.5, rot: 0 };
      break;
    }
    case "tilt": {
      const dir = from ? (from.rot > 0.05 ? -1 : from.rot < -0.05 ? 1 : c.rng() < 0.5 ? -1 : 1) : c.rng() < 0.5 ? -1 : 1;
      const r = (CAMERA.tiltDeg * Math.min(1.3, Math.max(1, m))) / 2;
      f = from ?? { scale: base, x: 0, y: 0, rot: -dir * r };
      t = { scale: f.scale, x: f.x * 0.5, y: f.y * 0.5, rot: from ? f.rot + dir * r * 2 : dir * r };
      break;
    }
    case "zoom-point":
    case "zoom-left":
    case "zoom-right": {
      f = from ?? { scale: base, x: 0, y: 0, rot: 0 };
      const s = sc(f.scale + CAMERA.zoomPointDelta * m);
      t = { scale: s, ...zoomXY(s), rot: 0 };
      break;
    }
  }
  // Awal bebas juga harus bebas tepi hitam (mis. tilt butuh skala > baseScale di kedua ujung)
  return { from: from ? f : ensureCovered(f, c.W, c.H, c.maxScale), to: ensureCovered(t, c.W, c.H, c.maxScale) };
}

/** Ukuran perubahan "bermakna" untuk preset (dibandingkan ambang di MEANINGFUL). */
function magnitude(preset: CameraPreset, from: CamState, to: CamState): number {
  switch (preset) {
    case "push-in":
    case "zoom-point":
    case "zoom-left":
    case "zoom-right":
      return Math.abs(to.scale - from.scale);
    case "pull-back":
      return Math.abs(from.scale - to.scale);
    case "pan":
      return Math.abs(to.x - from.x);
    case "tilt":
      return Math.abs(to.rot - from.rot);
  }
}
export const MEANINGFUL: Record<CameraPreset, number> = {
  "push-in": 0.04,
  "pull-back": 0.04,
  "zoom-point": 0.05,
  "zoom-left": 0.05,
  "zoom-right": 0.05,
  pan: 0.012,
  tilt: 0.3,
};

/**
 * Ambang "gerakan bermakna" dibatasi separuh rentang zoom yang tersedia: pada mode 9:16 potong-tengah
 * (maks 1,08x) ambang 0,04-0,05 hampir tak mungkin dicapai.
 */
export function meaningfulThreshold(preset: CameraPreset, maxScale: number): number {
  return Math.min(MEANINGFUL[preset], (maxScale - CAMERA.baseScale) * 0.5);
}

// ----------------------------------------------------------------- perencana
function breakMoves(inp: PlanInput): Span[] {
  const tune = tuneFor(inp.energy, inp.tuning);
  const D = inp.durationS;
  const joins = [...inp.joins].filter((j) => j > 0.05 && j < D - 0.05).sort((a, b) => a - b);
  const sentences = [...inp.sentenceEnds].sort((a, b) => a - b);
  const out: Span[] = [];
  let cur = 0;
  let hard = true;
  while (cur < D - 1e-6) {
    const hardNext = joins.find((j) => j > cur + 0.05) ?? D;
    let end: number;
    if (hardNext - cur <= tune.maxMoveSec * 1.25) {
      end = hardNext;
    } else {
      const lo = cur + tune.minMoveSec;
      const hi = Math.min(hardNext, cur + tune.maxMoveSec);
      const soft = [...sentences].reverse().find((s) => s >= lo && s <= hi);
      end = soft ?? hi;
      // jangan sisakan potongan pendek sebelum sambungan berikutnya
      if (hardNext - end < tune.minMoveSec * 0.6) end = hardNext;
    }
    out.push({ start: cur, end, hardStart: hard });
    hard = joins.some((j) => Math.abs(j - end) < 0.06) || end >= D - 1e-6;
    cur = end;
  }
  return out;
}

/**
 * Bersihkan override: jepit ke durasi, perpanjang sampai panjang minimum, buat tidak melintasi sambungan cut
 * (dijepit ke segmen yang memuat titik tengahnya), gabungkan yang tumpang tindih, dan batasi jumlahnya.
 */
export function normalizeOverrides(overrides: CameraOverride[], durationS: number, joins: number[]): CameraOverride[] {
  const js = [0, ...joins.filter((j) => j > 0.05 && j < durationS - 0.05).sort((a, b) => a - b), durationS];
  const cleaned: CameraOverride[] = [];
  for (const o of overrides) {
    let start = clamp(o.start, 0, durationS);
    let end = clamp(o.end, 0, durationS);
    if (!(end > start)) continue;
    const mid = (start + end) / 2;
    // segmen (di antara dua sambungan) yang memuat titik tengah
    let lo = 0, hi = durationS;
    for (let i = 0; i < js.length - 1; i++) if (mid >= js[i] && mid < js[i + 1]) { lo = js[i]; hi = js[i + 1]; break; }
    start = Math.max(start, lo);
    end = Math.min(end, hi);
    if (end - start < CAMERA.overrideMinSec) {
      // perpanjang ke kanan, atau ke kiri bila mentok, tetap di dalam segmen
      end = Math.min(hi, start + CAMERA.overrideMinSec);
      start = Math.max(lo, end - CAMERA.overrideMinSec);
    }
    if (end - start < 0.5) continue; // segmen terlalu pendek untuk gerakan apa pun
    cleaned.push({ start, end, preset: o.preset });
  }
  cleaned.sort((a, b) => a.start - b.start);
  const out: CameraOverride[] = [];
  for (const o of cleaned) {
    const last = out[out.length - 1];
    if (last && o.start < last.end + 1e-9) {
      if (o.preset === last.preset) last.end = Math.max(last.end, o.end); // sama: gabungkan
      else if (o.end - last.end >= 0.5) out.push({ start: last.end, end: o.end, preset: o.preset }); // beda: potong awalnya
    } else if (last && last.preset === o.preset && o.start - last.end < 0.05) {
      last.end = o.end; // bersebelahan, preset sama: satu span (tidak boleh preset sama dua kali berturut-turut)
    } else out.push({ ...o });
  }
  return out.slice(0, CAMERA.overrideMax);
}

type Span = { start: number; end: number; hardStart: boolean; forced?: CameraPreset };

/** Sisipkan override ke dalam span dasar: potong span yang tumpang tindih, lalu tempatkan span paksa. */
function applyOverrides(base: Span[], overrides: CameraOverride[]): Span[] {
  let spans = base.map((s) => ({ ...s }));
  for (const o of overrides) {
    const next: Span[] = [];
    let placed = false;
    for (const s of spans) {
      if (s.end <= o.start + 1e-9 || s.start >= o.end - 1e-9) {
        if (!placed && s.start >= o.end - 1e-9) {
          next.push({ start: o.start, end: o.end, hardStart: false, forced: o.preset });
          placed = true;
        }
        next.push(s);
        continue;
      }
      // tumpang tindih: sisa kiri dan kanan
      if (s.start < o.start - 1e-9) next.push({ start: s.start, end: o.start, hardStart: s.hardStart });
      if (!placed) {
        // awal override jatuh persis di awal span yang berawal di sambungan => awal bebas
        const atHard = s.hardStart && Math.abs(s.start - o.start) < 1e-9;
        next.push({ start: o.start, end: o.end, hardStart: atHard, forced: o.preset });
        placed = true;
      }
      if (s.end > o.end + 1e-9) next.push({ start: o.end, end: s.end, hardStart: false });
    }
    if (!placed) next.push({ start: o.start, end: o.end, hardStart: false, forced: o.preset });
    spans = next.sort((a, b) => a.start - b.start);
  }
  return spans;
}

/**
 * Susun rencana kamera. Aturan: preset tidak sama dua kali berturut-turut; tanpa lompatan di tengah
 * segmen (state awal = state akhir sebelumnya); lompatan hanya di sambungan cut; tidak ada tepi hitam.
 */
export function planCamera(inp: PlanInput): CamMove[] {
  const tune = tuneFor(inp.energy, inp.tuning);
  // Zoom kiri/kanan hanya masuk pilihan otomatis pada energi "energik" (bila tidak, hanya bila diminta lewat override)
  const cycle = inp.pattern && inp.pattern !== "otomatis" ? CAMERA_PATTERNS[inp.pattern].presets : null;
  const PRESETS: readonly CameraPreset[] = cycle ?? (tune.extraPresets ? ALL_PRESETS : CAMERA.presets);
  const c: Ctx = { W: inp.width, H: inp.height, maxScale: inp.maxScale, rng: mulberry32(inp.seed), mul: tune.deltaMul };
  const overrides = normalizeOverrides(inp.overrides ?? [], inp.durationS, inp.joins);
  const spans = overrides.length ? applyOverrides(breakMoves(inp), overrides) : breakMoves(inp);
  const moves: CamMove[] = [];
  let prev: CamMove | null = null;

  for (let si = 0; si < spans.length; si++) {
    const sp = spans[si];
    const nextForced = spans[si + 1]?.forced;
    const dur = sp.end - sp.start;
    const continuous = !sp.hardStart && prev !== null;
    const from = continuous ? prev!.to : null;

    // Span paksa: hanya preset yang diminta. Span biasa: hindari preset yang dipaksakan pada span berikutnya
    // (agar tidak berulang) dan, bila berikutnya zoom, sisakan ruang zoom.
    const allowed = sp.forced
      ? ALL_PRESETS.filter((p) => p === sp.forced && p !== prev?.preset)
      : PRESETS.filter((p) => p !== prev?.preset && p !== nextForced);
    let options = allowed.map((p) => {
      const cand = candidate(p, from, c);
      return { preset: p, ...cand };
    });
    if (!sp.forced && (nextForced === "zoom-point" || nextForced === "zoom-left" || nextForced === "zoom-right" || nextForced === "push-in")) {
      // ruang yang dibutuhkan zoom berikutnya, dibatasi oleh rentang zoom yang ada (9:16 potong-tengah hanya 0,07)
      const need = Math.min(0.8 * CAMERA.zoomPointDelta * c.mul, (c.maxScale - CAMERA.baseScale) * 0.6);
      const room = (o: { to: CamState }) => o.to.scale + need <= c.maxScale;
      let roomy = options.filter(room);
      if (roomy.length === 0 && prev?.preset !== "pull-back") {
        // tidak ada pilihan yang menyisakan ruang: tarik kamera mundur penuh agar zoom berikutnya terlihat
        const pb = { preset: "pull-back" as CameraPreset, ...candidate("pull-back", from, c, true) };
        if (room(pb)) roomy = [pb];
      }
      if (roomy.length) options = roomy;
    }
    if (options.length === 0) {
      // span paksa yang preset-nya sama dengan sebelumnya (tidak boleh berulang): pakai pilihan lain
      options = PRESETS.filter((p) => p !== prev?.preset).map((p) => ({ preset: p, ...candidate(p, from, c) }));
    }
    // Gerakan harus bermakna; gerakan pendek diperkecil sehingga ambangnya ikut diperkecil
    const k = dur < tune.minMoveSec ? Math.max(0.4, dur / tune.minMoveSec) : 1;
    let meaningful = options.filter((o) => magnitude(o.preset, o.from, o.to) >= meaningfulThreshold(o.preset, c.maxScale) * k);
    if (meaningful.length === 0) meaningful = options; // tidak ada pilihan: ambil yang ada (jarang)
    options = meaningful;
    const preferred = cycle?.[si % cycle.length];
    const pick = (!sp.forced && preferred ? options.find((o) => o.preset === preferred) : undefined) ?? options[Math.floor(c.rng() * options.length)];

    let to = pick.to;
    if (k < 1) to = ensureCovered(lerpState(pick.from, pick.to, k), c.W, c.H, c.maxScale);
    // Terlalu pendek untuk bergerak tanpa terlihat menyentak: tahan diam (label preset tetap untuk aturan "tidak berulang")
    if (dur < CAMERA.holdBelowSec) to = { ...pick.from };
    const move: CamMove = {
      start: sp.start,
      end: sp.end,
      preset: pick.preset,
      from: pick.from,
      to,
      continuous,
    };
    moves.push(move);
    prev = move;
  }
  return moves;
}

// ----------------------------------------------------------------- validasi
export function validatePlan(moves: CamMove[], inp: PlanInput): string[] {
  const errs: string[] = [];
  const forcedRanges = normalizeOverrides(inp.overrides ?? [], inp.durationS, inp.joins);
  const tune = tuneFor(inp.energy, inp.tuning);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const prev = moves[i - 1];
    if (!(m.end > m.start)) errs.push(`gerakan ${i}: durasi tidak positif`);
    if (prev) {
      if (!near(prev.end, m.start)) errs.push(`gerakan ${i}: celah/tumpang tindih dengan sebelumnya`);
      if (prev.preset === m.preset) errs.push(`gerakan ${i}: preset "${m.preset}" sama dua kali berturut-turut`);
      if (m.continuous) {
        const a = prev.to, b = m.from;
        if (!(near(a.scale, b.scale) && near(a.x, b.x) && near(a.y, b.y) && near(a.rot, b.rot))) {
          errs.push(`gerakan ${i}: lompatan di tengah segmen (continuous tapi state beda)`);
        }
      }
    }
    for (const s of [m.from, m.to]) if (s.scale > inp.maxScale + 1e-9) errs.push(`gerakan ${i}: scale ${s.scale.toFixed(3)} melewati batas ${inp.maxScale}`);
    // uji cakupan sepanjang gerakan
    for (let k = 0; k <= 24; k++) {
      const st = lerpState(m.from, m.to, easeCamera(k / 24));
      if (!isCovered(st, inp.width, inp.height)) {
        errs.push(`gerakan ${i}: tepi hitam terlihat pada p=${(k / 24).toFixed(2)}`);
        break;
      }
    }
    // bermakna (hanya gerakan otomatis sepanjang minimal). Gerakan yang diminta pengguna dikecualikan:
    // bila beberapa permintaan berdekatan, kamera tidak sempat turun dan batas zoom membatasi besarnya.
    const requested = forcedRanges.some((o) => m.start < o.end - 1e-9 && m.end > o.start + 1e-9);
    // gerakan tepat sebelum zoom yang diminta berfungsi memberi ruang (menurunkan skala), bukan gerakan mandiri
    const makesRoom = forcedRanges.some((o) => Math.abs(m.end - o.start) < 1e-9);
    if (!requested && !makesRoom && m.end - m.start >= tune.minMoveSec && magnitude(m.preset, m.from, m.to) < meaningfulThreshold(m.preset, inp.maxScale) * 0.999) {
      errs.push(`gerakan ${i} (${m.preset}): terlalu kecil untuk dianggap gerakan bermakna`);
    }
  }
  if (moves.length > 0) {
    if (!near(moves[0].start, 0)) errs.push("gerakan pertama tidak mulai di 0");
    if (Math.abs(moves[moves.length - 1].end - inp.durationS) > 1e-6) errs.push("gerakan terakhir tidak berakhir di durasi");
  }
  return errs;
}

// ------------------------------------------------- gerakan yang dihapus pengguna (Fase 11)
/**
 * Ganti gerakan otomatis dengan kamera DIAM di rentang yang dihapus pengguna (timeline hasil), atau di semua tempat bila
 * `autoOff`. Gerakan yang diminta pengguna (override) tidak tersentuh: menghapusnya = membuang permintaannya.
 * Diam di tengah segmen menahan posisi terakhir (tanpa lompatan); diam di awal segmen memakai posisi netral.
 * Gerakan sesudahnya dimulai dari posisi diam itu; bila jalurnya jadi memperlihatkan tepi hitam, ikut ditahan.
 * Dipanggil SETELAH validatePlan: hasilnya hanya mengurangi gerakan, jadi aturan tepi hitam dicek ulang di sini.
 */
export function muteCameraMoves(moves: CamMove[], a: { muted: Array<{ start: number; end: number }>; autoOff: boolean; overrides: CameraOverride[]; durationS: number; joins: number[]; width: number; height: number }): CamMove[] {
  if (!a.autoOff && !a.muted.length) return moves;
  const forced = normalizeOverrides(a.overrides, a.durationS, a.joins);
  const isForced = (m: CamMove) => forced.some((o) => Math.abs(o.start - m.start) < 1e-6 && Math.abs(o.end - m.end) < 1e-6);
  const isMuted = (m: CamMove) => { const mid = (m.start + m.end) / 2; return a.autoOff || a.muted.some((r) => mid >= r.start && mid < r.end); };
  const neutral: CamState = { scale: CAMERA.baseScale, x: 0, y: 0, rot: 0 };
  const covered = (from: CamState, to: CamState) => {
    for (let k = 0; k <= 24; k++) if (!isCovered(lerpState(from, to, easeCamera(k / 24)), a.width, a.height)) return false;
    return true;
  };
  const held = moves.map((m) => !isForced(m) && isMuted(m));
  const out: CamMove[] = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const prev = out[out.length - 1];
    const start = m.continuous && prev ? prev.to : m.from;
    if (held[i]) {
      // Satu posisi untuk seluruh deretan diam di segmen ini: lanjutan posisi sebelumnya; atau, bila deretan berawal di
      // awal segmen dan diikuti gerakan yang diminta, posisi awal yang dibutuhkan gerakan itu (mis. pull-back perlu
      // mulai dari zoom). Selain itu netral.
      let j = i;
      while (j + 1 < moves.length && held[j + 1] && moves[j + 1].continuous) j++;
      const next = moves[j + 1];
      const hold = m.continuous && prev ? prev.to : next && next.continuous && !held[j + 1] && isForced(next) ? next.from : neutral;
      out.push({ ...m, from: hold, to: hold });
    } else {
      out.push(covered(start, m.to) ? { ...m, from: start } : { ...m, from: start, to: start });
    }
  }
  return out;
}
