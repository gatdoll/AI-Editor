import { reusableDir } from "./temp-dir.ts"; // HARUS pertama: arahkan folder sementara Remotion ke luar drive sistem
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VIDEO } from "@app/config";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition, type makeCancelSignal } from "@remotion/renderer";

type CancelSignal = ReturnType<typeof makeCancelSignal>["cancelSignal"];
import type { EditedProps } from "../../../packages/remotion/src/edited-props.ts";
import type { MotionProps } from "../../../packages/remotion/src/motion-props.ts";
import { getSfx, listSfx, sfxPath } from "@app/shared/sfx-library";
import { renderTuning } from "./render-tuning.ts";

const tuning = (retry?: boolean) => renderTuning({ freeBytes: os.freemem(), retry, envConcurrency: process.env.RENDER_CONCURRENCY });

const here = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.resolve(here, "../../../packages/remotion/src/index.ts");

/**
 * Server HTTP lokal KHUSUS BACA untuk file di disk, dengan dukungan Range.
 * Chrome/compositor Remotion butuh URL http; file mentah tidak disalin dan tidak pernah ditulis (aturan 1).
 * Hanya mendengarkan 127.0.0.1 pada port acak. `files`: nama jalur -> { file, type }.
 */
function serveFiles(files: Record<string, { file: string; type: string }>): Promise<{ urlFor: (name: string) => string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    const entry = files[decodeURIComponent((req.url ?? "/").split("?")[0].slice(1))];
    if (!entry) return void res.writeHead(404).end();
    const size = statSync(entry.file).size;
    const range = req.headers.range;
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (m[1] === "" && m[2] === "")) {
        res.writeHead(416, { "content-range": `bytes */${size}` }).end();
        return;
      }
      if (m[1] === "") start = Math.max(0, size - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2] !== "") end = Math.min(Number(m[2]), size - 1);
      }
      if (start > end || start >= size) {
        res.writeHead(416, { "content-range": `bytes */${size}` }).end();
        return;
      }
      status = 206;
    }
    const headers: Record<string, string | number> = {
      "content-type": entry.type,
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
      "access-control-allow-origin": "*",
    };
    if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    if (req.method === "HEAD") return void res.end();
    createReadStream(entry.file, { start, end }).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        urlFor: (name) => `http://127.0.0.1:${port}/${encodeURIComponent(name)}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Satu file (video mentah / audio hasil reduksi noise). */
async function serveFile(file: string, contentType = "video/mp4"): Promise<{ url: string; close: () => Promise<void> }> {
  const s = await serveFiles({ source: { file, type: contentType } });
  return { url: s.urlFor("source"), close: s.close };
}

// Bundel Remotion cukup dibuat sekali per proses worker.
const getBundle = reusableDir(() => bundle({ entryPoint: ENTRY }), "index.html");

export type RenderArgs = {
  sourceFile: string;
  outFile: string;
  /** Props komposisi tanpa `src` (server file lokal memberi URL-nya). */
  props: Omit<EditedProps, "src">;
  onProgress: (fraction: number) => void;
  /** Pembatalan oleh pengguna (render-cancel.ts). */
  cancelSignal?: CancelSignal;
  /** Log konsol browser renderer (untuk menangkap error kode kreatif per frame). */
  onBrowserLog?: (text: string) => void;
  /** Fase 11: audio hasil reduksi noise (menggantikan audio video). */
  audioFile?: string | null;
  /** Fase 15: file gambar/logo untuk `props.creative.assets` (id sama). */
  materials?: MotionFile[];
  /** Fase 16: file tiap video untuk `props.sources` (id sama) + audio hasil reduksi noise per video. */
  sources?: ReelSourceFile[];
  /** Percobaan ulang setelah gagal: concurrency rendah. */
  retry?: boolean;
};

export type ReelSourceFile = { id: string; file: string; audioFile?: string | null; /** Fase 24: video talent transparan (VP9+alpha). */ talentFile?: string | null };

/** Fase 16: semua video project lewat server lokal; `props.sources[].src/audioSrc` diganti URL server ini. */
async function serveReelSources<P extends { sources?: EditedProps["sources"] }>(props: P, files: ReelSourceFile[] | undefined): Promise<{ props: P; close: () => Promise<void> }> {
  if (!props.sources?.length) return { props, close: async () => {} };
  const map: Record<string, { file: string; type: string }> = {};
  for (const s of props.sources) {
    const f = files?.find((x) => x.id === s.id);
    if (!f) throw new Error(`File video ${s.id} tidak disiapkan untuk render`);
    map[`v:${s.id}`] = { file: f.file, type: "video/mp4" };
    if (f.audioFile) map[`a:${s.id}`] = { file: f.audioFile, type: "audio/mp4" };
    if (f.talentFile) map[`t:${s.id}`] = { file: f.talentFile, type: "video/webm" };
  }
  const server = await serveFiles(map);
  return {
    props: { ...props, sources: props.sources.map((s) => ({ ...s, src: server.urlFor(`v:${s.id}`), ...(map[`a:${s.id}`] ? { audioSrc: server.urlFor(`a:${s.id}`) } : {}), ...(map[`t:${s.id}`] ? { talentSrc: server.urlFor(`t:${s.id}`) } : {}) })) },
    close: server.close,
  };
}

/** Fase 15: gambar/logo kode kreatif lewat server lokal; `src` tiap aset diganti URL server ini. Aset tanpa file = error jelas. */
async function serveCreativeAssets<P extends Omit<EditedProps, "src">>(props: P, materials: MotionFile[] | undefined): Promise<{ props: P; close: () => Promise<void> }> {
  // Fase 18: klip akhir memakai gambar yang sama
  const assets = [...(props.creative?.assets ?? []), ...(props.endClip?.assets ?? [])];
  // Fase 24: font tambahan versi kreatif / klip akhir (bahan id `font:<id>`)
  const fonts = [...(props.creative?.fonts ?? []), ...(props.endClip?.fonts ?? [])];
  if (!assets.length && !fonts.length) return { props, close: async () => {} };
  const map: Record<string, { file: string; type: string }> = {};
  for (const x of assets) {
    const m = materials?.find((f) => f.id === x.id);
    if (!m) throw new Error(`Gambar "${x.name}" tidak ada di disk. Unggah ulang di Mode Kreatif.`);
    map[x.id] = { file: m.file, type: m.type };
  }
  for (const f of fonts) {
    const m = materials?.find((x) => x.id === `font:${f.id}`);
    if (!m || !existsSync(m.file)) throw new Error(`Font "${f.family}" tidak ada di disk. Jalankan npm run setup:fonts atau unggah ulang fontnya.`);
    map[`font:${f.id}`] = { file: m.file, type: m.type };
  }
  const server = await serveFiles(map);
  const served = <T extends { id: string }>(list: T[]) => list.map((x) => ({ ...x, src: server.urlFor(x.id) }));
  const servedFonts = <T extends { id: string }>(list: T[]) => list.map((x) => ({ ...x, src: server.urlFor(`font:${x.id}`) }));
  return {
    props: {
      ...props,
      ...(props.creative ? { creative: { ...props.creative, ...(props.creative.assets ? { assets: served(props.creative.assets) } : {}), ...(props.creative.fonts ? { fonts: servedFonts(props.creative.fonts) } : {}) } } : {}),
      ...(props.endClip ? { endClip: { ...props.endClip, ...(props.endClip.assets ? { assets: served(props.endClip.assets) } : {}), ...(props.endClip.fonts ? { fonts: servedFonts(props.endClip.fonts) } : {}) } } : {}),
    },
    close: server.close,
  };
}

/** Fase 14: file SFX pustaka lewat server lokal; URL web di props diganti URL server ini. */
async function serveSfx(cues: Array<{ id: string; src: string }> | undefined) {
  const ids = [...new Set((cues ?? []).map((c) => c.id))];
  if (!ids.length) return { rewrite: <T extends { id: string }>(c: T[]) => c, close: async () => {} };
  const map: Record<string, { file: string; type: string }> = {};
  for (const id of ids) {
    const item = getSfx(id);
    if (!item) throw new Error(`SFX "${id}" tidak ada di pustaka (mungkin sudah dihapus). Hapus isyaratnya di timeline atau jalankan npm run setup:sfx.`);
    map[id] = { file: sfxPath(item), type: item.mime };
  }
  const server = await serveFiles(map);
  return { rewrite: <T extends { id: string }>(c: T[]) => c.map((x) => ({ ...x, src: server.urlFor(x.id) })), close: server.close };
}

export async function renderEdited(a: RenderArgs): Promise<{ durationInFrames: number }> {
  const server = await serveFile(a.sourceFile);
  const audio = a.audioFile ? await serveFile(a.audioFile, "audio/mp4") : null;
  const sfx = await serveSfx(a.props.sfx).catch(async (e) => { await server.close(); await audio?.close(); throw e; });
  const assets = await serveCreativeAssets(a.props, a.materials).catch(async (e) => { await server.close(); await audio?.close(); await sfx.close(); throw e; });
  const reel = await serveReelSources(assets.props, a.sources).catch(async (e) => { await server.close(); await audio?.close(); await sfx.close(); await assets.close(); throw e; });
  try {
    const serveUrl = await getBundle();
    const inputProps = { ...reel.props, src: server.url, ...(audio ? { denoisedSrc: audio.url } : {}), ...(a.props.sfx ? { sfx: sfx.rewrite(a.props.sfx) } : {}) };
    const composition = await selectComposition({ serveUrl, id: "Edited", inputProps });
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      crf: VIDEO.crf,
      audioCodec: "aac",
      outputLocation: a.outFile,
      ...tuning(a.retry),
      chromiumOptions: { enableMultiProcessOnLinux: true },
      cancelSignal: a.cancelSignal,
      onProgress: ({ progress }) => a.onProgress(progress),
      onBrowserLog: a.onBrowserLog ? (l) => a.onBrowserLog!(l.text) : undefined,
    });
    return { durationInFrames: composition.durationInFrames };
  } finally {
    await server.close();
    await audio?.close();
    await sfx.close();
    await assets.close();
    await reel.close();
  }
}

/** Render satu frame (PNG) untuk pemeriksaan visual. */
export async function renderEditedStill(a: { sourceFile: string; outFile: string; props: Omit<EditedProps, "src">; frame: number; scale?: number; onBrowserLog?: (text: string) => void; materials?: MotionFile[]; sources?: ReelSourceFile[] }): Promise<void> {
  const server = await serveFile(a.sourceFile);
  const assets = await serveCreativeAssets(a.props, a.materials).catch(async (e) => { await server.close(); throw e; });
  // Still tidak memutar audio: audio hasil noise dan SFX tidak perlu disajikan
  const reel = await serveReelSources(assets.props, a.sources?.map((x) => ({ ...x, audioFile: null }))).catch(async (e) => { await server.close(); await assets.close(); throw e; });
  try {
    const serveUrl = await getBundle();
    const inputProps = { ...reel.props, src: server.url, sfx: undefined };
    const composition = await selectComposition({ serveUrl, id: "Edited", inputProps });
    await renderStill({ composition, serveUrl, inputProps, frame: a.frame, output: a.outFile, scale: a.scale, chromiumOptions: { enableMultiProcessOnLinux: true }, onBrowserLog: a.onBrowserLog ? (l) => a.onBrowserLog!(l.text) : undefined });
  } finally {
    await server.close();
    await assets.close();
    await reel.close();
  }
}

// ------------------------------------------------- motion graphics berdiri sendiri (Fase 13)
export type MotionFile = { id: string; file: string; type: string };

/** Bahan motion disajikan lewat server lokal; props dibangun dengan URL-nya (sama dengan pratinjau, beda asal). */
async function withMotionServer<T>(materials: MotionFile[], fn: (srcFor: (id: string) => string) => Promise<T>): Promise<T> {
  // Fase 14: seluruh pustaka SFX ikut disajikan dengan awalan "sfx:" (isyarat boleh memakai suara mana pun; hanya yang dipakai yang dibaca)
  const sfx = Object.fromEntries(listSfx().map((s) => [`sfx:${s.id}`, { file: sfxPath(s), type: s.mime }]));
  const server = await serveFiles({ ...sfx, ...Object.fromEntries(materials.map((m) => [m.id, { file: m.file, type: m.type }])) });
  try {
    return await fn((id) => server.urlFor(id));
  } finally {
    await server.close();
  }
}

export async function renderMotionStill(a: { materials: MotionFile[]; props: (srcFor: (id: string) => string) => MotionProps; frame: number; outFile: string; scale?: number; onBrowserLog?: (text: string) => void }): Promise<void> {
  await withMotionServer(a.materials, async (srcFor) => {
    const serveUrl = await getBundle();
    const inputProps = a.props(srcFor);
    const composition = await selectComposition({ serveUrl, id: "Motion", inputProps });
    await renderStill({ composition, serveUrl, inputProps, frame: a.frame, output: a.outFile, scale: a.scale, chromiumOptions: { enableMultiProcessOnLinux: true }, onBrowserLog: a.onBrowserLog ? (l) => a.onBrowserLog!(l.text) : undefined });
  });
}

export async function renderMotion(a: { materials: MotionFile[]; props: (srcFor: (id: string) => string) => MotionProps; outFile: string; onProgress: (f: number) => void; onBrowserLog?: (text: string) => void; cancelSignal?: CancelSignal }): Promise<{ durationInFrames: number }> {
  return withMotionServer(a.materials, async (srcFor) => {
    const serveUrl = await getBundle();
    const inputProps = a.props(srcFor);
    const composition = await selectComposition({ serveUrl, id: "Motion", inputProps });
    await renderMedia({
      composition, serveUrl, inputProps, codec: "h264", crf: VIDEO.crf, audioCodec: "aac", outputLocation: a.outFile,
      ...tuning(),
      chromiumOptions: { enableMultiProcessOnLinux: true },
      cancelSignal: a.cancelSignal,
      onProgress: ({ progress }) => a.onProgress(progress),
      onBrowserLog: a.onBrowserLog ? (l) => a.onBrowserLog!(l.text) : undefined,
    });
    return { durationInFrames: composition.durationInFrames };
  });
}
