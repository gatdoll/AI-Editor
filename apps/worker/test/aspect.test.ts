// Fase 10.0: rasio 4:5. Daftar rasio satu sumber (config), semua konstanta per rasio lengkap, dan jalur props/subtitle/AI menerimanya.
import assert from "node:assert/strict";
import { ASPECTS, ASPECT_IDS, CAMERA, FX, SUBTITLE } from "../../../config/index.ts";
import { OpSchema } from "../../../packages/shared/src/ops.ts";
import { buildEditedProps, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { buildPages } from "../../../packages/remotion/src/captions.ts";
import { maxScaleFor } from "../../../packages/remotion/src/camera-plan.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { buildOpsPrompt } from "../src/prompt/translate.ts";

assert.deepEqual(ASPECT_IDS, ["16:9", "9:16", "4:5"]);
assert.deepEqual([ASPECTS["4:5"].width, ASPECTS["4:5"].height], [1080, 1350]);

// Rasio baru wajib punya nilai di setiap konstanta per rasio (kalau tidak, subtitle/lower third jatuh ke undefined)
const perAspect = { maxCharsPerLine: SUBTITLE.maxCharsPerLine, fontSizePx: SUBTITLE.fontSizePx, safeZone: SUBTITLE.safeZone, referenceHeight: SUBTITLE.referenceHeight, lowerThird: FX.lowerThird.bottom };
for (const [name, map] of Object.entries(perAspect)) for (const a of ASPECT_IDS) assert.ok((map as Record<string, unknown>)[a] !== undefined, `${name}[${a}]`);

// Mode cepat: operasi menerima 4:5, prompt AI menyebutnya
assert.ok(OpSchema.safeParse({ type: "set_style", aspect: "4:5" }).success);
assert.ok(!OpSchema.safeParse({ type: "set_style", aspect: "1:1" }).success, "rasio yang tidak ada tetap ditolak");
const prompt = buildOpsPrompt("ubah ke 4:5", { durationS: 10, wordCount: 5, style: { styleId: "modern", aspect: "9:16", camera: true, captions: true, effects: true, cameraOverrides: 0, params: {} }, pending: 0, approved: 0 });
assert.match(prompt, /"16:9" \| "9:16" \| "4:5"/);

// Gaya tersimpan dengan 4:5 tidak dikembalikan ke bawaan
assert.equal(normalizeStyle({ aspect: "4:5" }).aspect, "4:5");
assert.equal(normalizeStyle({ aspect: "1:1" as never }).aspect, "16:9");

// Props: ukuran output 1080x1350, subtitle dibangun dengan batas baris 4:5
const words = "Halo semua selamat datang di channel saya hari ini kita akan membahas cara mengedit video".split(" ").map((x, i) => ({ text: x, start: i * 0.35, end: i * 0.35 + 0.3 }));
const built = buildEditedProps({ segments: [{ start: 0, end: 6 }], source: { width: 1920, height: 1080, fps: 30, durationS: 6 }, words, style: normalizeStyle({ aspect: "4:5" }), seed: 1 });
assert.deepEqual([built.props.width, built.props.height, built.props.aspect], [1080, 1350, "4:5"]);
assert.ok(built.props.pages.length > 0);
const pages = buildPages(words, { aspect: "4:5", uppercase: false });
assert.equal(pages.flatMap((p) => p.tokens.map((k) => k.text.trim())).join(" "), words.map((w) => w.text).join(" "), "semua kata sekali");
assert.ok(pages.every((p) => p.lineStarts.length <= SUBTITLE.maxLines));

// Sumber 16:9 yang dipotong ke 4:5 sudah diperbesar: zoom tambahan dibatasi seperti 9:16
assert.equal(maxScaleFor(1080, 1920, 1080, 1350), CAMERA.maxScaleCrop);

// Kontrak Mode Kreatif menyebut rasio dari daftar yang sama
assert.match(buildContract(), /aspect: "16:9" \| "9:16" \| "4:5"/);

console.log("aspect.test: rasio 4:5 di config/ops/prompt/props/subtitle/kamera/kontrak, konstanta per rasio lengkap passed");

// Geser video di canvas: fokus vertikal tersimpan dan dijepit; geser hanya pada sumbu yang punya sisa
{
  const { panFocus } = await import("../../../packages/shared/src/manual.ts");
  assert.equal(normalizeStyle({ focusY: 3 } as never).focusY, 1);
  assert.equal("focusY" in normalizeStyle({}), false, "project lama tanpa focusY tidak berubah");
  const dims = { compW: 1080, compH: 1350, srcW: 1920, srcH: 1080, scale: 1 };
  // 16:9 ke 4:5: lebar tampil 2400, sisa 1320 px horizontal, tidak ada sisa vertikal
  const f = panFocus({ x: 0.5, y: 0.5 }, 660, 200, dims);
  assert.equal(f.x, 0); assert.equal(f.y, 0.5);
  assert.equal(panFocus({ x: 0.5, y: 0.5 }, -5000, 0, dims).x, 1);
  // Diperbesar 2x: sumbu vertikal ikut bisa digeser
  assert.ok(panFocus({ x: 0.5, y: 0.5 }, 0, -100, { ...dims, scale: 2 }).y > 0.5);
  console.log("ok geser canvas (focusY, panFocus)");
}
