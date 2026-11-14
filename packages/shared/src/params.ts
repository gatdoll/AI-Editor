// Registri parameter edit. SATU tempat yang mendefinisikan setiap pengaturan yang bisa diubah pengguna.
// Dari sini: prompt (AI diberi katalognya), panel pengaturan di editor, dan validasi nilai.
// Menambah kemampuan baru = menambah satu entri di sini lalu menghubungkannya di build-props.
// Murni, aman di browser dan Node.
import { CAMERA_PATTERNS, ENERGY, MOTION, SFX, SUBTITLE, STYLES, CAPTION_ANIMS, FONT, FONTS, FX, type StyleId } from "@app/config";

export type ParamValue = number | string | boolean;

export type ParamDef = {
  id: string;
  group: "Teks" | "Warna" | "Efek" | "Kamera" | "Bingkai" | "Motion" | "Video" | "Audio";
  label: string;
  /** Penjelasan singkat untuk pengguna DAN AI (Indonesia). */
  desc: string;
  kind: "number" | "boolean" | "color" | "enum";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: readonly string[];
  /** Nilai bawaan untuk gaya tertentu (undefined = ditentukan otomatis, mis. menurut rasio). */
  base: (styleId: StyleId) => ParamValue | undefined;
  /** Peringatan bila nilai melewati batas nyaman (tetap diizinkan). */
  caution?: (v: ParamValue) => string | null;
};

const ANIMS = Object.keys(CAPTION_ANIMS);
const ENERGIES = Object.keys(ENERGY);

export const PARAMS: ParamDef[] = [
  { id: "video.skala", group: "Video", label: "Skala video", desc: "Ukuran video sumber; tidak mengubah ukuran subtitle.", kind: "number", min: 0.1, max: 4, step: 0.01, unit: "x", base: () => 1 },
  { id: "video.x", group: "Video", label: "Posisi X", desc: "Geser video horizontal dalam persen lebar layar.", kind: "number", min: -100, max: 100, step: 1, unit: "%", base: () => 0 },
  { id: "video.y", group: "Video", label: "Posisi Y", desc: "Geser video vertikal dalam persen tinggi layar.", kind: "number", min: -100, max: 100, step: 1, unit: "%", base: () => 0 },
  { id: "video.rotasi", group: "Video", label: "Rotasi video", desc: "Putar video dalam derajat.", kind: "number", min: -180, max: 180, step: 1, unit: "°", base: () => 0 },
  { id: "video.opacity", group: "Video", label: "Opacity video", desc: "Transparansi video (0–1).", kind: "number", min: 0, max: 1, step: 0.01, base: () => 1 },
  { id: "video.flipX", group: "Video", label: "Balik horizontal", desc: "Cerminkan video kiri-kanan.", kind: "boolean", base: () => false },
  { id: "video.flipY", group: "Video", label: "Balik vertikal", desc: "Cerminkan video atas-bawah.", kind: "boolean", base: () => false },
  { id: "video.terang", group: "Video", label: "Kecerahan", desc: "Kecerahan gambar sumber; 1 = asli.", kind: "number", min: 0, max: 2, step: 0.01, base: () => 1 },
  { id: "video.kontras", group: "Video", label: "Kontras", desc: "Kontras gambar sumber; 1 = asli.", kind: "number", min: 0, max: 2, step: 0.01, base: () => 1 },
  { id: "video.saturasi", group: "Video", label: "Saturasi", desc: "Saturasi warna sumber; 0 = hitam-putih, 1 = asli.", kind: "number", min: 0, max: 2, step: 0.01, base: () => 1 },
  { id: "audio.volume", group: "Audio", label: "Volume sumber", desc: "Volume audio sumber; 1 = 100%, 0 = senyap.", kind: "number", min: 0, max: 2, step: 0.01, unit: "x", base: () => 1 },
  { id: "audio.kurangiNoise", group: "Audio", label: "Kurangi noise", desc: "Reduksi noise latar (kipas, AC, angin, ruangan) dengan noisereduce; 0 = mati, 0,5 = ringan, 0,75 = sedang, 1 = kuat. Diproses di worker sekali per kekuatan; suara bicara bisa terdengar sedikit tipis pada nilai tinggi.", kind: "number", min: 0, max: 1, step: 0.05, base: () => 0,
    caution: (v) => Number(v) > 0.9 ? "Kekuatan di atas 0,9 bisa membuat suara terdengar tipis atau bergema." : null },
  { id: "audio.sfx", group: "Audio", label: "Volume SFX", desc: "Volume semua efek suara (SFX) dari perintah AI dan timeline; 0 = SFX mati. Suara bicara tidak berubah.", kind: "number", min: 0, max: 1, step: 0.05, base: () => SFX.defaultMaster },
  { id: "audio.bisu", group: "Audio", label: "Bisu", desc: "Matikan audio sumber.", kind: "boolean", base: () => false },
  { id: "audio.fadeIn", group: "Audio", label: "Fade in audio", desc: "Audio perlahan masuk di awal hasil video, dalam detik.", kind: "number", min: 0, max: 10, step: 0.1, unit: "dtk", base: () => 0 },
  { id: "audio.fadeOut", group: "Audio", label: "Fade out audio", desc: "Audio perlahan hilang di akhir hasil video, dalam detik.", kind: "number", min: 0, max: 10, step: 0.1, unit: "dtk", base: () => 0 },
  { id: "motion.ruang", group: "Motion", label: "Gerakan ruang", desc: "Gaya framed shot: datar, orbit (perspektif 2.5D bergeser kiri-kanan), parallax (kamera melayang dengan lapisan latar). Aktifkan motion.bingkai untuk melihatnya.", kind: "enum", options: ["datar", "orbit", "parallax"], base: () => "datar" },
  { id: "motion.bingkai", group: "Motion", label: "Komposisi bergerak", desc: "Perpindahan mulus dari video penuh ke framed shot, mengikuti awal frasa. Tidak memotong atau mengubah durasi video.", kind: "boolean", base: (s) => s === "motion" },
  { id: "motion.kekuatan", group: "Motion", label: "Kekuatan motion", desc: "Besar perubahan framing (1 = standar).", kind: "number", min: 0.3, max: 1.3, step: 0.1, base: () => MOTION.strength },
  { id: "motion.jeda", group: "Motion", label: "Jeda antar aksen", desc: "Jeda minimum antar framed shot dalam detik. Hindari perubahan layout terlalu sering.", kind: "number", min: 3, max: 20, step: 1, unit: "dtk", base: () => MOTION.sceneGapSec },
  // ---------------------------------------------------------------- teks
  { id: "teks.animasi", group: "Teks", label: "Animasi teks", desc: `Cara subtitle muncul: ${ANIMS.join(", ")}. sorot=kata aktif berwarna; pop=kata muncul satu per satu; kotak=kata aktif dalam kotak berwarna; pendek=1-3 kata besar sekaligus; kinetik=reveal per kata dengan spring, rotasi halus dan garis aksen berjalan; blur-slide=kata naik dari blur ke tajam memakai satu kurva ease-out, mengikuti ucapan.`, kind: "enum", options: ANIMS, base: (s) => STYLES[s].captionAnim },
  { id: "teks.ukuran", group: "Teks", label: "Ukuran teks", desc: "Pengali ukuran teks subtitle (1 = normal, 1.5 = 50% lebih besar).", kind: "number", min: 0.5, max: 2.5, step: 0.05, unit: "x", base: () => 1 },
  { id: "teks.posisiBawah", group: "Teks", label: "Jarak dari bawah", desc: "Posisi subtitle dari tepi bawah sebagai pecahan tinggi layar (0.1 = dekat bawah, 0.5 = tengah). Otomatis menghindari area UI TikTok/Instagram bila tidak diubah.", kind: "number", min: 0.02, max: 0.7, step: 0.01, base: () => undefined },
  { id: "teks.hurufBesar", group: "Teks", label: "HURUF BESAR", desc: "Subtitle dalam huruf kapital semua.", kind: "boolean", base: (s) => STYLES[s].uppercase },
  { id: "teks.tebal", group: "Teks", label: "Huruf tebal", desc: "Tebal (true) atau reguler (false).", kind: "boolean", base: (s) => STYLES[s].fontWeight === FONT.weightBold },
  { id: "teks.garisTepi", group: "Teks", label: "Garis tepi", desc: "Tebal garis tepi huruf dalam piksel (0 = tanpa garis).", kind: "number", min: 0, max: 16, step: 1, unit: "px", base: (s) => STYLES[s].strokePx },
  { id: "teks.redup", group: "Teks", label: "Kata lain redup", desc: "Opacity kata yang tidak aktif (0 = hilang, 1 = terang penuh). Berlaku untuk animasi sorot, kotak, kinetik, dan blur-slide.", kind: "number", min: 0, max: 1, step: 0.05, base: (s) => STYLES[s].dimOpacity },
  { id: "teks.baris", group: "Teks", label: "Maks baris", desc: "Jumlah baris maksimum per subtitle (1-3).", kind: "number", min: 1, max: 3, step: 1, base: () => SUBTITLE.maxLines },
  { id: "teks.kataPerHalaman", group: "Teks", label: "Kata per subtitle", desc: "Batas jumlah kata yang tampil sekaligus (0 = otomatis). Mis. 2 untuk teks pendek-pendek.", kind: "number", min: 0, max: 10, step: 1, base: () => 0 },
  { id: "teks.font", group: "Teks", label: "Font", desc: `Keluarga huruf subtitle dan judul: ${Object.keys(FONTS).join(", ")}. montserrat = Montserrat ExtraBold, inter = Inter Black (paling tebal).`, kind: "enum", options: Object.keys(FONTS), base: () => "jakarta" },
  { id: "teks.popDari", group: "Teks", label: "Skala awal pop", desc: "Untuk animasi pop/pendek: skala kata saat mulai muncul (0.8 = dari 80% ke 100%, dengan spring sedikit memantul).", kind: "number", min: 0.3, max: 1, step: 0.05, base: () => SUBTITLE.popFromScale },
  { id: "teks.keluar", group: "Teks", label: "Teks keluar", desc: "Cara subtitle menghilang di akhir halaman: potong (langsung hilang), larut (dissolve cepat), geser (slide-out ke atas sambil memudar).", kind: "enum", options: ["potong", "larut", "geser"], base: () => "potong" },
  // --------------------------------------------------------------- warna
  { id: "warna.teks", group: "Warna", label: "Warna teks", desc: "Warna utama teks (hex seperti #FFFFFF, atau nama warna Indonesia).", kind: "color", base: (s) => STYLES[s].colors.text },
  { id: "warna.aksen", group: "Warna", label: "Warna aksen", desc: "Warna kata yang disorot / kotak / animasi.", kind: "color", base: (s) => STYLES[s].colors.accent },
  { id: "warna.gelap", group: "Warna", label: "Warna gelap", desc: "Warna gelap untuk bayangan, kotak, dan vinyet.", kind: "color", base: (s) => STYLES[s].colors.dark },
  // ---------------------------------------------------------------- efek
  { id: "efek.vinyet", group: "Efek", label: "Vinyet", desc: "Penggelapan tepi layar (0 = mati, 0.8 = sangat gelap).", kind: "number", min: 0, max: 0.8, step: 0.02, base: (s) => STYLES[s].vignette },
  { id: "efek.gradasi", group: "Efek", label: "Gradasi bawah/atas", desc: "Gradasi gelap tipis di bawah dan atas layar.", kind: "number", min: 0, max: 0.8, step: 0.02, base: (s) => STYLES[s].gradient },
  { id: "efek.grain", group: "Efek", label: "Grain film", desc: "Butiran film. PERHATIAN: makin tinggi makin besar ukuran file dan makin lama render.", kind: "number", min: 0, max: 0.1, step: 0.005, base: (s) => STYLES[s].grain, caution: (v) => (Number(v) > 0.04 ? "Grain tinggi membuat file jauh lebih besar dan render lebih lama." : null) },
  { id: "transisi.jenis", group: "Efek", label: "Transisi sambungan", desc: "Transisi di setiap sambungan cut yang disetujui: tidak, whip (whip pan cepat dengan motion blur), zoom (zoom-through dengan blur), glitch (jitter, warna pecah, garis glitch). Tidak mengubah durasi atau audio.", kind: "enum", options: [...FX.transition.kinds], base: () => "tidak" },
  { id: "transisi.durasi", group: "Efek", label: "Durasi transisi", desc: "Panjang transisi dalam frame (separuh sebelum, separuh sesudah sambungan).", kind: "number", min: 4, max: 16, step: 1, unit: "frame", base: () => FX.transition.frames },
  // -------------------------------------------------------------- kamera
  { id: "kamera.guncang", group: "Kamera", label: "Guncangan kamera", desc: "Camera shake 2–3 frame dengan peluruhan cepat pada momen penekanan: kata slam, awal judul hook, dan arahan zoom (emphasize/camera_at). 0 = mati, 1 = kuat. Tidak ada deteksi beat musik.", kind: "number", min: 0, max: 1, step: 0.05, base: () => 0 },
  { id: "kamera.miring", group: "Kamera", label: "Dutch tilt", desc: "Sesekali kamera miring sekian derajat lalu snap kembali lurus (diterapkan pada sebagian awal kalimat). 0 = mati; 3–5 = halus.", kind: "number", min: 0, max: 8, step: 0.5, unit: "°", base: () => 0 },
  { id: "kamera.pola", group: "Kamera", label: "Pola kamera", desc: "Urutan gerakan: otomatis; sinematik (mendekat, geser, menjauh, miring); kiri-kanan (zoom kiri, mundur, zoom kanan, geser); maju-mundur (push-in dan pull-back). Urutan diprioritaskan selama ruang zoom mencukupi; kamera tetap mulus dan dibatasi zoom maksimum.", kind: "enum", options: Object.keys(CAMERA_PATTERNS), base: () => "otomatis" },
  { id: "kamera.energi", group: "Kamera", label: "Energi kamera", desc: `Seberapa sering dan besar gerakan kamera: ${ENERGIES.join(", ")}. energik = gerakan pendek-pendek, zoom kiri/kanan bergantian ala video pendek.`, kind: "enum", options: ENERGIES, base: (s) => STYLES[s].energy },
  { id: "kamera.kekuatanZoom", group: "Kamera", label: "Kekuatan zoom", desc: "Pengali besar zoom/gerakan (1 = normal, 2 = dua kali lebih kuat). Tetap dibatasi 'zoom maksimum'.", kind: "number", min: 0.3, max: 2.5, step: 0.1, unit: "x", base: () => 1 },
  { id: "kamera.otomatis", group: "Kamera", label: "Gerakan otomatis", desc: "true = kamera bergerak otomatis (zoom, geser, miring) di sepanjang video. false = kamera diam, hanya gerakan yang diminta pengguna lewat perintah (mis. \"zoom saat aku bilang X\") yang tetap bergerak.", kind: "boolean", base: () => true },
  { id: "kamera.zoomMaks", group: "Kamera", label: "Zoom maksimum", desc: "Batas skala zoom (1.2 = 120%). Bawaan menyesuaikan resolusi video agar tidak pecah.", kind: "number", min: 1, max: 2, step: 0.05, unit: "x", base: () => undefined, caution: (v) => (Number(v) > 1.3 ? "Zoom di atas ~1.3x pada video 1080p akan terlihat pecah." : null) },
  { id: "kamera.gerakanMin", group: "Kamera", label: "Gerakan terpendek", desc: "Durasi gerakan kamera terpendek (detik).", kind: "number", min: 0.8, max: 10, step: 0.1, unit: "dtk", base: (s) => ENERGY[STYLES[s].energy].minMoveSec },
  { id: "kamera.gerakanMaks", group: "Kamera", label: "Gerakan terpanjang", desc: "Durasi gerakan kamera terpanjang (detik).", kind: "number", min: 1.5, max: 20, step: 0.5, unit: "dtk", base: (s) => ENERGY[STYLES[s].energy].maxMoveSec },
  // -------------------------------------------------------------- bingkai
  { id: "bingkai.fokusX", group: "Bingkai", label: "Posisi potong", desc: "Saat video dipotong ke rasio lebih sempit (mis. 9:16): 0 = kiri, 0.5 = tengah, 1 = kanan.", kind: "number", min: 0, max: 1, step: 0.01, base: () => 0.5 },
];

export const PARAM_BY_ID: Record<string, ParamDef> = Object.fromEntries(PARAMS.map((p) => [p.id, p]));

// ------------------------------------------------------------------ warna
const NAMED_COLORS: Record<string, string> = {
  putih: "#FFFFFF", hitam: "#000000", merah: "#FF3B30", biru: "#2F7BFF", kuning: "#FFD84D", hijau: "#34D399",
  oranye: "#FF9500", jingga: "#FF9500", ungu: "#A78BFA", pink: "#FF2D95", merahmuda: "#FF2D95", cyan: "#25F4EE",
  tosca: "#25F4EE", emas: "#FFC94D", abu: "#9CA3AF", coklat: "#A0643C", biruMuda: "#7DD3FC", birumuda: "#7DD3FC",
  white: "#FFFFFF", black: "#000000", red: "#FF3B30", blue: "#2F7BFF", yellow: "#FFD84D", green: "#34D399",
  orange: "#FF9500", purple: "#A78BFA", gold: "#FFC94D", gray: "#9CA3AF", grey: "#9CA3AF",
};

/** Hex 3/6 digit atau nama warna (Indonesia/Inggris) -> #RRGGBB. null bila tidak dikenali. */
export function parseColor(input: string): string | null {
  const t = input.trim().toLowerCase().replace(/\s+/g, "");
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return `#${h.toUpperCase()}`;
  }
  return NAMED_COLORS[t] ?? null;
}

export type Coerced = { ok: true; value: ParamValue; warning: string | null } | { ok: false; reason: string };

/** Ubah nilai mentah (string dari AI atau UI) menjadi nilai tervalidasi menurut definisi parameter. */
export function coerceParam(def: ParamDef, raw: unknown): Coerced {
  let value: ParamValue;
  switch (def.kind) {
    case "number": {
      const m = typeof raw === "number" ? null : /[+-]?\d+(?:[.,]\d+)?/.exec(String(raw));
      const n = typeof raw === "number" ? raw : m ? Number(m[0].replace(",", ".")) : NaN;
      if (!Number.isFinite(n)) return { ok: false, reason: `"${raw}" bukan angka untuk ${def.label}` };
      const lo = def.min ?? -Infinity, hi = def.max ?? Infinity;
      value = Math.min(hi, Math.max(lo, n));
      if (def.step && def.step >= 1) value = Math.round(value);
      break;
    }
    case "boolean": {
      if (typeof raw === "boolean") value = raw;
      else {
        const t = String(raw).trim().toLowerCase();
        if (["true", "ya", "nyala", "on", "1", "aktif"].includes(t)) value = true;
        else if (["false", "tidak", "mati", "off", "0", "nonaktif"].includes(t)) value = false;
        else return { ok: false, reason: `"${raw}" bukan ya/tidak untuk ${def.label}` };
      }
      break;
    }
    case "color": {
      const c = parseColor(String(raw));
      if (!c) return { ok: false, reason: `warna "${raw}" tidak dikenali (pakai hex seperti #FF0000 atau nama seperti merah)` };
      value = c;
      break;
    }
    case "enum": {
      const t = String(raw).trim().toLowerCase();
      if (!def.options?.includes(t)) return { ok: false, reason: `"${raw}" bukan pilihan ${def.label}. Pilihan: ${def.options?.join(", ")}` };
      value = t;
      break;
    }
  }
  return { ok: true, value, warning: def.caution?.(value) ?? null };
}

/** Bersihkan peta penimpaan: hanya id yang dikenal dan nilai valid. */
export function normalizeParams(raw: unknown): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = PARAM_BY_ID[id];
    if (!def) continue;
    const c = coerceParam(def, v);
    if (c.ok) out[id] = c.value;
  }
  return out;
}

/** Katalog teks untuk AI: id, makna, rentang/pilihan, dan nilai sekarang. */
export function paramCatalog(styleId: StyleId, current: Record<string, ParamValue>): string {
  return PARAMS.map((p) => {
    const range = p.kind === "number" ? ` rentang ${p.min}-${p.max}${p.unit ? " " + p.unit : ""}` : p.kind === "enum" ? ` pilihan: ${p.options!.join(" | ")}` : p.kind === "boolean" ? " true/false" : " warna";
    const base = p.base(styleId);
    const now = current[p.id];
    return `- ${p.id} (${p.label};${range}; bawaan ${base === undefined ? "otomatis" : String(base)}${now !== undefined ? `; SEKARANG ${String(now)}` : ""}): ${p.desc}`;
  }).join("\n");
}
