import os from "node:os";
import path from "node:path";
import { cpSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe,
} from "@remotion/install-whisper-cpp";
import type { WhisperModel } from "@remotion/install-whisper-cpp";
import type { Word } from "@app/shared";
import { CACHE_DIR } from "./storage.ts";

// Akurasi transkrip (Nov 2026): model `small` + bahasa "auto" sering salah dengar kata Indonesia (KPNS/CPNS, infos/invoice).
// Bawaan sekarang large-v3-turbo + bahasa Indonesia (video selalu bahasa Indonesia dengan istilah Inggris). Turbo butuh
// whisper.cpp >= 1.7 (1.5.5 tidak mengenal preset DTW-nya). Di Linux dibangun dengan make (butuh build-essential).
const WHISPER_VERSION = process.env.WHISPER_CPP_VERSION ?? "1.7.6";
export const WHISPER_MODEL = (process.env.WHISPER_MODEL ?? "large-v3-turbo") as WhisperModel;
const WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE ?? "id";
const WHISPER_THREADS = Number(process.env.WHISPER_THREADS) || Math.max(2, Math.min(10, os.cpus().length - 2));

// Folder per versi (1.5.5 tetap di folder lama): ganti versi tidak menimpa instalasi yang sudah jalan
const whisperDir = path.join(CACHE_DIR, WHISPER_VERSION === "1.5.5" ? "whisper" : `whisper-${WHISPER_VERSION}`);
const newLayout = (() => { const [a, b, c] = WHISPER_VERSION.split(".").map(Number); return a > 1 || (a === 1 && (b > 7 || (b === 7 && c >= 4))); })();
// Sama dengan getWhisperExecutablePath paket (tidak diekspor): >= 1.7.4 = build/bin/whisper-cli
const whisperExecutable = () => newLayout
  ? path.join(whisperDir, "build", "bin", `whisper-cli${process.platform === "win32" ? ".exe" : ""}`)
  : path.join(whisperDir, `main${process.platform === "win32" ? ".exe" : ""}`);

/** Zip Windows >= 1.7 berisi folder Release/, sedangkan paket mencari build/bin/: salin bila perlu (sekali). */
function fixWindowsLayout(): void {
  const release = path.join(whisperDir, "Release");
  if (!newLayout || process.platform !== "win32" || existsSync(whisperExecutable()) || !existsSync(path.join(release, "whisper-cli.exe"))) return;
  cpSync(release, path.join(whisperDir, "build", "bin"), { recursive: true });
}
const modelDir = path.join(CACHE_DIR, "whisper-models");

let ready: Promise<void> | null = null;

function ensureWhisper(): Promise<void> {
  ready ??= (async () => {
    // Jangan membuat whisperDir sendiri: folder kosong dianggap "sudah terpasang" oleh paket
    // dan instalasi dilewati diam-diam.
    await mkdir(modelDir, { recursive: true });
    console.log(`[whisper] memastikan whisper.cpp ${WHISPER_VERSION} dan model ${WHISPER_MODEL}...`);
    // Folder ada tapi executable di Release/ (instalasi sebelumnya): perbaiki dulu agar paket tidak menolak folder itu
    fixWindowsLayout();
    if (!existsSync(whisperExecutable())) await installWhisperCpp({ to: whisperDir, version: WHISPER_VERSION, printOutput: false }).catch((e) => { fixWindowsLayout(); if (!existsSync(whisperExecutable())) throw e; });
    fixWindowsLayout();
    if (!existsSync(whisperExecutable())) {
      throw new Error(
        `whisper.cpp tidak terpasang di ${whisperDir}. Hapus folder itu lalu jalankan ulang.`,
      );
    }
    await downloadWhisperModel({ model: WHISPER_MODEL, folder: modelDir, printOutput: false });
  })().catch((e) => {
    ready = null; // izinkan coba lagi
    throw e;
  });
  return ready;
}

/**
 * Token Whisper -> kata. Token yang diawali spasi memulai kata baru;
 * token lain (tanda baca, potongan sub-kata) digabung ke kata sebelumnya.
 */
export function captionsToWords(
  captions: Array<{ text: string; startMs: number; endMs: number; confidence: number | null }>,
): Word[] {
  const words: Word[] = [];
  const confs: number[][] = [];
  for (const c of captions) {
    const text = c.text;
    if (!text.trim() || /^\[_.*_\]$/.test(text.trim())) continue; // token khusus
    const startsNew = text.startsWith(" ") || words.length === 0;
    if (startsNew) {
      words.push({
        text: text.trim(),
        start: c.startMs / 1000,
        end: c.endMs / 1000,
        confidence: null,
      });
      confs.push(c.confidence == null ? [] : [c.confidence]);
    } else {
      const last = words[words.length - 1];
      last.text += text;
      last.end = Math.max(last.end, c.endMs / 1000);
      if (c.confidence != null) confs[confs.length - 1].push(c.confidence);
    }
  }
  // Confidence kata = yang terendah di antara token-nya (konservatif).
  words.forEach((w, i) => {
    w.confidence = confs[i].length ? Math.min(...confs[i]) : null;
  });
  return normalizeWordTimes(words);
}

const MIN_WORD_SEC = 0.05;

/**
 * whisper.cpp kadang memberi kata berdurasi nol (mis. 9.60-9.60). Perpanjang sampai awal kata
 * berikutnya (maks 0,4 dtk) supaya cut tidak memotong di titik tanpa lebar.
 */
export function normalizeWordTimes(words: Word[]): Word[] {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    if (w.end < w.start) w.end = w.start;
    if (w.end - w.start < MIN_WORD_SEC) {
      w.end = next
        ? Math.max(w.start + MIN_WORD_SEC, Math.min(next.start, w.start + 0.4))
        : w.start + 0.2;
    }
  }
  return words;
}

export async function transcribeWav(
  wavPath: string,
  onProgress: (fraction: number) => void,
  language: string = WHISPER_LANGUAGE,
  /** Istilah pengguna (nama produk, singkatan) sebagai petunjuk ejaan untuk Whisper. */
  prompt?: string,
): Promise<{ words: Word[]; language: string; model: string }> {
  await ensureWhisper();
  const output = await transcribe({
    inputPath: wavPath,
    whisperPath: whisperDir,
    whisperCppVersion: WHISPER_VERSION,
    model: WHISPER_MODEL,
    modelFolder: modelDir,
    tokenLevelTimestamps: true,
    language: language as never,
    printOutput: false,
    onProgress,
    // CPU: bawaan whisper.cpp hanya 4 thread; pakai hampir semua inti (sisakan 2 untuk web/worker)
    additionalArgs: [["-t", String(WHISPER_THREADS)], ...(prompt?.trim() ? [["--prompt", prompt.trim().slice(0, 600)] as [string, string]] : [])],
  });
  const { captions } = toCaptions({ whisperCppOutput: output });
  return {
    words: captionsToWords(captions),
    language: output.result?.language ?? language,
    model: WHISPER_MODEL,
  };
}
