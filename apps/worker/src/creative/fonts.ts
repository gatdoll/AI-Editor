// Fase 24: font tambahan untuk Mode Kreatif. Katalog (pustaka Google Fonts + font unggahan pengguna) dan spesimennya disalin
// ke folder kerja; AI memilih lewat fonts.json; kode kita memvalidasi pilihan dan menyimpannya per versi.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FONT_LIBRARY } from "@app/config";
import { resolveMediaPath } from "@app/shared";
import { isFontFile, listFontLibrary, uploadedFamily, type FontRef } from "@app/shared/font-library";

/** Semua font yang boleh dipilih untuk project ini (pustaka + unggahan). */
export async function fontChoices(db: SupabaseClient, projectId: string): Promise<FontRef[]> {
  const lib: FontRef[] = listFontLibrary().filter((f) => existsSync(resolveMediaPath(f.rel))).map((f) => ({ id: f.id, family: f.family, weight: f.weight, file: f.rel, source: "pustaka" }));
  const { data: rows } = await db.from("assets").select("id,label,storage_path").eq("project_id", projectId).eq("kind", "material").order("created_at");
  const up: FontRef[] = (rows ?? []).filter((r) => isFontFile(String(r.storage_path)) && existsSync(resolveMediaPath(r.storage_path)))
    .map((r) => ({ id: `u-${r.id}`, family: uploadedFamily(String(r.label ?? r.storage_path)), weight: 400, file: String(r.storage_path), source: "unggahan" }));
  return [...up, ...lib];
}

/** Salin spesimen + tulis fonts/catalog.json di folder kerja. Mengembalikan jumlah keluarga. */
export async function writeFontCatalog(dir: string, choices: FontRef[]): Promise<number> {
  if (!choices.length) return 0;
  await mkdir(path.join(dir, "fonts"), { recursive: true });
  const lib = listFontLibrary();
  const families = new Map<string, { family: string; weights: number[]; source: string; specimen?: string }>();
  for (const f of choices) {
    const e = families.get(f.family) ?? { family: f.family, weights: [], source: f.source };
    if (!e.weights.includes(f.weight)) e.weights.push(f.weight);
    const spec = lib.find((x) => x.id === f.id)?.specimenRel;
    if (spec && !e.specimen && existsSync(resolveMediaPath(spec))) {
      e.specimen = `fonts/${path.basename(spec)}`;
      await copyFile(resolveMediaPath(spec), path.join(dir, e.specimen));
    }
    families.set(f.family, e);
  }
  await writeFile(path.join(dir, "fonts", "catalog.json"), JSON.stringify({ catatan: "Font tambahan yang bisa dimuat. Pilih lewat fonts.json di folder kerja.", fonts: [...families.values()] }, null, 2));
  return families.size;
}

/** fonts.json versi dasar (revisi): pilihan lama tetap dipakai kecuali AI mengubahnya. */
export async function writeBaseFonts(dir: string, fonts: FontRef[]): Promise<void> {
  if (fonts.length) await writeFile(path.join(dir, "fonts.json"), JSON.stringify(fonts.map((f) => ({ family: f.family, weight: f.weight })), null, 2));
}

/** Baca + validasi fonts.json tulisan AI. Tidak ada berkas = tanpa font tambahan. */
export async function readChosenFonts(dir: string, choices: FontRef[]): Promise<{ fonts: FontRef[]; errors: string[] }> {
  const file = path.join(dir, "fonts.json");
  if (!existsSync(file)) return { fonts: [], errors: [] };
  let raw: unknown;
  try { raw = JSON.parse(await readFile(file, "utf8")); } catch { return { fonts: [], errors: ["fonts.json bukan JSON yang sah. Format: [{ \"family\": \"Anton\", \"weight\": 400 }]"] }; }
  if (!Array.isArray(raw)) return { fonts: [], errors: ["fonts.json harus berupa array: [{ \"family\": \"Anton\", \"weight\": 400 }]"] };
  const errors: string[] = [];
  const fonts: FontRef[] = [];
  for (const x of raw) {
    const family = typeof x === "string" ? x : String((x as { family?: unknown })?.family ?? "");
    const weight = typeof x === "object" && x && Number((x as { weight?: unknown }).weight) ? Number((x as { weight: number }).weight) : null;
    const same = choices.filter((c) => c.family.toLowerCase() === family.trim().toLowerCase());
    if (!same.length) { errors.push(`Font "${family}" tidak ada di fonts/catalog.json. Pilih dari katalog atau pakai data.fonts.`); continue; }
    const pick = (weight !== null ? same.find((c) => c.weight === weight) : null) ?? same.find((c) => c.weight === 400) ?? same[0];
    if (weight !== null && pick.weight !== weight) errors.push(`Font "${family}" tidak punya ketebalan ${weight}; yang ada: ${same.map((c) => c.weight).join(", ")}.`);
    if (!fonts.some((f) => f.id === pick.id)) fonts.push(pick);
  }
  if (fonts.length > FONT_LIBRARY.maxPerVersion) errors.push(`Maksimal ${FONT_LIBRARY.maxPerVersion} font tambahan per versi (fonts.json berisi ${fonts.length}).`);
  return { fonts: fonts.slice(0, FONT_LIBRARY.maxPerVersion), errors };
}

/** Instruksi agen: kapan dan bagaimana memakai font tambahan. */
export function fontInstruction(o: { families: number; reference: boolean }): string {
  if (!o.families) return "";
  return [
    `FONT TAMBAHAN: selain data.fonts (Jakarta, Montserrat, Inter), ada ${o.families} keluarga font di fonts/catalog.json (pustaka Google Fonts + font unggahan pengguna), masing-masing dengan gambar contoh di fonts/*.png.`,
    o.reference
      ? "Ada video referensi: font teks di video ini HARUS meniru font referensi semirip mungkin. Bandingkan bentuk huruf di frame referensi (lebar, kontras tebal-tipis, serif/tanpa serif, huruf kapital, bentuk G/R/a/e) dengan gambar contoh di fonts/, pilih yang paling mirip beserta ketebalannya, dan tulis alasannya di reference.md. Font unggahan pengguna (source \"unggahan\") diutamakan bila cocok."
      : "Bila prompt meminta gaya huruf tertentu, pilih dari katalog (lihat gambar contohnya).",
    `Untuk memakainya: tulis fonts.json di folder kerja, mis. [{ "family": "Anton", "weight": 400 }] (maks ${FONT_LIBRARY.maxPerVersion}), lalu di kode pakai fontFamily: "Anton" dengan fontWeight yang sama. Sistem memuat font itu sebelum frame dirender. Nama/ketebalan yang tidak ada di katalog ditolak.`,
    "Bila tidak ada yang mirip, pakai yang paling dekat dan sebutkan di notes.md nama font asli yang kamu kenali agar pengguna bisa mengunggah filenya (TTF/OTF).",
  ].join(" ");
}
