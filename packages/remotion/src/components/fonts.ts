import { loadFont as loadJakarta } from "@remotion/google-fonts/PlusJakartaSans";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { FONT, type FontId } from "@app/config";

// Montserrat ExtraBold = 800, Inter Black = 900 (sesuai permintaan gaya video pendek)
const jakarta = loadJakarta("normal", { weights: [String(FONT.weightRegular), String(FONT.weightBold)] as never, subsets: ["latin"] });
const montserrat = loadMontserrat("normal", { weights: [String(FONT.weightRegular), "800"] as never, subsets: ["latin"] });
const inter = loadInter("normal", { weights: [String(FONT.weightRegular), "900"] as never, subsets: ["latin"] });

const FAMILIES: Record<FontId, { family: string; bold: number }> = {
  jakarta: { family: jakarta.fontFamily, bold: FONT.weightBold },
  montserrat: { family: montserrat.fontFamily, bold: 800 },
  inter: { family: inter.fontFamily, bold: 900 },
};

/** Nama keluarga font yang sudah dimuat, untuk kode Mode Kreatif. */
export const FONT_FAMILIES: Record<FontId, string> = { jakarta: FAMILIES.jakarta.family, montserrat: FAMILIES.montserrat.family, inter: FAMILIES.inter.family };

/** Keluarga huruf (dengan cadangan) dan bobot sebenarnya untuk pilihan font + tebal/reguler gaya. */
export function fontFor(id: FontId | undefined, weight: number): { fontFamily: string; fontWeight: number } {
  const f = FAMILIES[id ?? "jakarta"] ?? FAMILIES.jakarta;
  return { fontFamily: `${f.family}, ${FONT.family}, sans-serif`, fontWeight: weight >= FONT.weightBold ? f.bold : FONT.weightRegular };
}
