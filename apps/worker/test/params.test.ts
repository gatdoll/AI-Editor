// Tes registri parameter: validasi nilai, penerapan lewat set_param/reset_param, dan efeknya pada props render.
import { STYLES } from "@app/config";
import { coerceParam, normalizeParams, PARAM_BY_ID, PARAMS, paramCatalog, parseColor } from "@app/shared/params";
import { normalizeOps } from "@app/shared/ops";
import { buildEditedProps, DEFAULT_STYLE, normalizeStyle, resolveStyle } from "../../../packages/remotion/src/build-props.ts";
import { planEffects } from "../src/prompt/effects.ts";

let ok = 0, bad = 0;
const t = (name: string, cond: boolean, extra = "") => {
  if (cond) ok++; else { bad++; console.log(`GAGAL: ${name} ${extra}`); }
};

// ---- registri
t("id parameter unik", new Set(PARAMS.map((p) => p.id)).size === PARAMS.length);
t("tiap parameter punya deskripsi", PARAMS.every((p) => p.desc.length > 10 && p.label));
t("rentang masuk akal (min < max)", PARAMS.filter((p) => p.kind === "number").every((p) => p.min! < p.max!));
t("katalog memuat semua id", PARAMS.every((p) => paramCatalog("modern", {}).includes(p.id)));

// ---- warna
t("hex 3 digit", parseColor("#f00") === "#FF0000");
t("nama Indonesia", parseColor("Merah") === "#FF3B30" && parseColor("biru") === "#2F7BFF");
t("warna ngawur ditolak", parseColor("kehijauan-malam") === null);

// ---- coerce
const size = PARAM_BY_ID["teks.ukuran"];
const c1 = coerceParam(size, "99");
t("angka dibatasi ke max", c1.ok && c1.value === 2.5);
const c2 = coerceParam(size, "1,5x");
t("koma desimal dan satuan dibersihkan", c2.ok && c2.value === 1.5);
t("bukan angka ditolak", !coerceParam(size, "besar sekali").ok);
t("boolean 'nyala'", (() => { const r = coerceParam(PARAM_BY_ID["teks.hurufBesar"], "nyala"); return r.ok && r.value === true; })());
t("enum salah ditolak", !coerceParam(PARAM_BY_ID["teks.animasi"], "berputar").ok);
t("enum huruf besar diterima", (() => { const r = coerceParam(PARAM_BY_ID["teks.animasi"], "POP"); return r.ok && r.value === "pop"; })());
const g = coerceParam(PARAM_BY_ID["efek.grain"], "0.09");
t("grain tinggi diberi peringatan", g.ok && !!g.warning);
const z = coerceParam(PARAM_BY_ID["kamera.zoomMaks"], "1.6");
t("zoom besar diberi peringatan", z.ok && !!z.warning);

// ---- normalisasi: id tak dikenal / nilai buruk dibuang
const n = normalizeParams({ "teks.ukuran": 1.4, "id.palsu": 5, "warna.aksen": "bukanwarna", "kamera.energi": "energik" });
t("normalizeParams hanya menyisakan yang valid", Object.keys(n).sort().join() === "kamera.energi,teks.ukuran");

// ---- ops: set_param/reset_param lolos skema, op ngawur ditolak
const nm = normalizeOps([
  { type: "set_param", paramId: "teks.ukuran", value: "1.5" },
  { type: "reset_param", paramId: "semua" },
  { type: "set_param", paramId: "teks.ukuran" }, // tanpa value
  { type: "set_style", styleId: "modern" },
  { type: "emphasize_phrase", phrase: "halo", preset: "zoom-left" },
]);
t("4 op valid, 1 ditolak", nm.ops.length === 4 && nm.rejected.length === 1);

// ---- planEffects
const words = Array.from({ length: 30 }, (_, i) => ({ text: i % 5 === 0 ? "halo" : "kata", start: i * 0.5, end: i * 0.5 + 0.4, confidence: 0.9 }));
const ctx = { words, durationS: 16, style: DEFAULT_STYLE, existing: [], getSilences: async () => [] };
const f1 = await planEffects(normalizeOps([{ type: "set_param", paramId: "teks.ukuran", value: "1.5" }, { type: "set_param", paramId: "warna.aksen", value: "merah" }]).ops, ctx);
t("set_param mengubah style.params", f1.style?.params["teks.ukuran"] === 1.5 && f1.style?.params["warna.aksen"] === "#FF3B30");
t("set_param menulis pesan hasil nyata", f1.messages.length === 2 && f1.messages[0].includes("1.5"));

const f2 = await planEffects(normalizeOps([{ type: "set_param", paramId: "nggak.ada", value: "1" }]).ops, ctx);
t("id tak dikenal: tidak ada perubahan + pesan jujur", f2.style === null && f2.messages[0].includes("tidak ada"));

const f3 = await planEffects(normalizeOps([{ type: "set_param", paramId: "teks.ukuran", value: "abc" }]).ops, ctx);
t("nilai buruk: tidak ada perubahan", f3.style === null);

const withP = normalizeStyle({ params: { "teks.ukuran": 1.5, "warna.aksen": "#FF0000" } });
const f4 = await planEffects(normalizeOps([{ type: "reset_param", paramId: "teks.ukuran" }]).ops, { ...ctx, style: withP });
t("reset satu parameter", f4.style !== null && f4.style.params["teks.ukuran"] === undefined && f4.style.params["warna.aksen"] === "#FF0000");
const f5 = await planEffects(normalizeOps([{ type: "reset_param", paramId: "semua" }]).ops, { ...ctx, style: withP });
t("reset semua", f5.style !== null && Object.keys(f5.style.params).length === 0);
const f6 = await planEffects(normalizeOps([{ type: "reset_param", paramId: "semua" }]).ops, ctx);
t("reset saat tidak ada yang diubah: tidak ada perubahan", f6.style === null);

const f7 = await planEffects(normalizeOps([{ type: "set_style", styleId: "modern" }, { type: "emphasize_phrase", phrase: "halo", preset: "zoom-right" }]).ops, ctx);
t("gaya modern + zoom kanan tersimpan", f7.style?.styleId === "modern" && f7.style.cameraOverrides.every((o) => o.preset === "zoom-right") && f7.style.cameraOverrides.length > 0);

// ---- resolveStyle & buildEditedProps benar-benar memakai params
const base = resolveStyle(DEFAULT_STYLE);
t("tanpa params = bawaan gaya", base.def.colors.accent === STYLES.bersih.colors.accent && base.textScale === 1 && base.energy === "sedang");
const custom = resolveStyle(normalizeStyle({ params: { "warna.aksen": "#112233", "teks.tebal": false, "kamera.energi": "energik", "teks.posisiBawah": 0.4 } }));
t("params menimpa warna, bobot, energi, posisi", custom.def.colors.accent === "#112233" && custom.def.fontWeight === 500 && custom.energy === "energik" && custom.textBottom === 0.4);

const src = { width: 1920, height: 1080, fps: 30, durationS: 60 };
const segs = [{ start: 0, end: 60 }];
const ws = Array.from({ length: 120 }, (_, i) => ({ text: `kata${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
const mk = (params: Record<string, unknown>) => buildEditedProps({ segments: segs, source: src, words: ws, style: normalizeStyle({ params: params as never }), seed: 7 });
const a = mk({});
const b = mk({ "teks.ukuran": 1.8, "teks.kataPerHalaman": 2, "warna.aksen": "#FF0000", "kamera.energi": "energik" });
t("props membawa gaya final", b.props.style.colors.accent === "#FF0000" && b.props.textScale === 1.8);
t("kata per halaman <= 2", b.props.pages.every((p) => p.tokens.length <= 2));
t("energik = lebih banyak gerakan kamera", b.props.camera.length > a.props.camera.length);
t("rencana kamera tetap lolos validasi", a.cameraErrors.length === 0 && b.cameraErrors.length === 0, b.cameraErrors.join("; "));
const c = mk({ "kamera.kekuatanZoom": 2.5, "kamera.zoomMaks": 1.5, "kamera.gerakanMin": 1, "kamera.gerakanMaks": 3 });
t("kekuatan/zoom maks/durasi gerakan ekstrem tetap valid", c.cameraErrors.length === 0, c.cameraErrors.join("; "));
t("zoom tidak melewati zoom maksimum pengguna", c.props.camera.every((m) => m.from.scale <= 1.5 + 1e-9 && m.to.scale <= 1.5 + 1e-9));

console.log(`\n${ok} lolos, ${bad} gagal`);
process.exit(bad ? 1 : 0);
