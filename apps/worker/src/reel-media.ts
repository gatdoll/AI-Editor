// Fase 16: proses audio/video per file untuk project dengan banyak video. Hasilnya dalam waktu REEL (waktu lokal + offset),
// jadi transkrip, jeda, dan usulan cut tetap satu sumbu waktu. File mentah hanya dibaca (aturan 1).
import { loadTalent } from "./talent.ts";
import { loadGlossary } from "@app/shared/glossary";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { resolveMediaPath, type AssetRow, type Word } from "@app/shared";
import type { Interval } from "@app/shared/edl";
import type { Reel } from "@app/shared/reel-db";
import { reelEnd, type ReelClip } from "@app/shared/reel";
import { mapWordsFromConcat } from "@app/shared/transcript-segments";
import { ensureWav } from "./handlers.ts";
import { ensureDenoised } from "./derived.ts";
import { ANALYSIS } from "@app/config";
import { detectSilences, extractSegmentsWav, noiseFloorDb, silenceThresholdFor, type Silence } from "./media.ts";
import { assetDir } from "./storage.ts";
import { transcribeWav } from "./whisper.ts";

const assetOf = (reel: Reel, c: ReelClip): AssetRow => {
  const a = reel.assets.find((x) => x.id === c.id);
  if (!a) throw new Error(`Video ${c.label ?? c.id} tidak ditemukan`);
  return a;
};

/** Rentang reel -> rentang lokal per video (yang jatuh di lubang dibuang). Tanpa rentang = seluruh tiap video. */
export function localRanges(clips: ReelClip[], ranges: Interval[] | null): Array<{ clip: ReelClip; local: Interval[] }> {
  return clips.flatMap((clip) => {
    const want = ranges ?? [{ start: clip.offset, end: reelEnd(clip) }];
    const local = want.flatMap((r) => {
      const a = Math.max(r.start, clip.offset), b = Math.min(r.end, reelEnd(clip));
      return b - a > 0.05 ? [{ start: a - clip.offset, end: b - clip.offset }] : [];
    });
    return local.length ? [{ clip, local }] : [];
  });
}

/**
 * Transkrip rentang reel tertentu (atau seluruh video bila null): tiap video didengar Whisper sendiri, waktu kata
 * dipetakan kembali ke reel. Satu video + seluruh durasi = perilaku lama (file audio utuh).
 */
export async function transcribeReel(reel: Reel, ranges: Interval[] | null, jobId: string, onProgress: (f: number) => void): Promise<{ words: Word[]; language: string | null; model: string | null }> {
  const parts = localRanges(reel.clips, ranges);
  const words: Word[] = [];
  let language: string | null = null, model: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const { clip, local } = parts[i];
    const fullWav = await ensureWav(assetOf(reel, clip));
    const whole = ranges === null || (local.length === 1 && local[0].start <= 0.01 && local[0].end >= clip.duration - 0.01);
    let wav = fullWav;
    if (!whole) {
      wav = path.join(assetDir(clip.id), `kept-${jobId}.wav`);
      await extractSegmentsWav(fullWav, wav, local);
    }
    const r = await transcribeWav(wav, (f) => onProgress((i + f) / parts.length), undefined, loadGlossary());
    const mapped = whole ? r.words : mapWordsFromConcat(r.words, local);
    words.push(...mapped.map((w) => ({ ...w, start: w.start + clip.offset, end: w.end + clip.offset })));
    language ??= r.language;
    model ??= r.model;
  }
  return { words: words.sort((a, b) => a.start - b.start), language, model };
}

/**
 * Jeda diam di semua video, dalam waktu reel. Ambang per video mengikuti lantai noise rekamannya (`minDb` = paling ketat),
 * karena rekaman ponsel di ruangan sering tidak pernah turun ke -35 dB di sela kalimat.
 */
export async function reelSilences(reel: Reel, minDb: number, minSec: number): Promise<Silence[]> {
  const out: Silence[] = [];
  for (const clip of reel.clips) {
    const wav = await ensureWav(assetOf(reel, clip));
    const floor = await noiseFloorDb(wav, ANALYSIS.noiseFloorPercentile).catch(() => null);
    const db = silenceThresholdFor(floor, { minDb, marginDb: ANALYSIS.silenceFloorMarginDb, maxDb: ANALYSIS.silenceMaxThresholdDb });
    const found = await detectSilences(wav, db, minSec, clip.duration);
    console.log(`[silence] ${clip.label ?? clip.id}: lantai noise ${floor?.toFixed(1) ?? "?"} dB -> ambang ${db.toFixed(1)} dB, ${found.length} jeda`);
    for (const s of found) out.push({ ...s, start: s.start + clip.offset, end: s.end + clip.offset });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** File tiap video untuk render + audio hasil reduksi noise per video (dibuat bila belum ada; gagal = render gagal). */
export async function reelRenderSources(reel: Reel, denoiseStrength: unknown): Promise<Array<{ id: string; file: string; audioFile: string | null; talentFile: string | null }>> {
  const out: Array<{ id: string; file: string; audioFile: string | null; talentFile: string | null }> = [];
  for (const clip of reel.clips) {
    const asset = assetOf(reel, clip);
    const file = resolveMediaPath(asset.storage_path);
    if (!existsSync(file)) throw new Error(`File mentah tidak ada di disk: ${asset.storage_path}`);
    // Fase 24: video talent transparan (bila sudah disiapkan) untuk teks di belakang talent
    out.push({ id: clip.id, file, audioFile: await ensureDenoised(asset, denoiseStrength), talentFile: loadTalent(asset.project_id, asset.id)?.file ?? null });
  }
  return out;
}

/** Hapus cache audio sementara semua video project. */
export async function cleanupReelCache(reel: Reel): Promise<void> {
  for (const a of reel.assets) await rm(assetDir(a.id), { recursive: true, force: true });
}
