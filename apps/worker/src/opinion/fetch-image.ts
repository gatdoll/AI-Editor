// Fase 19: unduh gambar kandidat dari internet. Alamat diperiksa (anti-SSRF) di setiap pengalihan, hanya tipe gambar,
// ukuran dan waktu dibatasi, lalu di-encode ulang dengan ffmpeg (berkas asli tidak pernah disajikan apa adanya).
import { rm, writeFile } from "node:fs/promises";
import { OPINION } from "@app/config";
import { checkUrl } from "@app/shared/safe-url";
import { reencodeImage } from "../media.ts";

const I = OPINION.image;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 EditingStudio/1.0";

export type FetchedImage = { mime: "image/jpeg" | "image/png" | "image/svg+xml"; ext: ".jpg" | ".png" | ".svg"; width?: number; height?: number; bytes: number; finalUrl: string };

/**
 * Berkas asli Wikimedia Commons sering puluhan MB (uji 10 Nov 2026: foto Prabowo "terlalu besar"). Thumbnail resmi Wikimedia
 * (`/thumb/.../<lebar>px-<nama>`) cukup tajam untuk video. null = bukan berkas asli Wikimedia yang bisa di-thumbnail.
 */
export function wikimediaThumb(raw: string, width: number = I.wikimediaThumbWidth): string | null {
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/([a-z-]+)\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+\.(?:jpe?g|png|webp))$/i.exec(raw);
  return m ? `https://upload.wikimedia.org/wikipedia/${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/${width}px-${m[4]}` : null;
}

/** Unduh `rawUrl` ke berkas sementara `tmpFile`, lalu tulis hasil aman ke `outBase` + ekstensi. Gagal = Error berpesan jelas. */
export async function fetchImage(rawUrl: string, tmpFile: string, outBase: string, referer?: string, signal?: AbortSignal, check: (u: string) => Promise<URL> = checkUrl): Promise<FetchedImage & { file: string }> {
  const thumb = wikimediaThumb(rawUrl);
  if (thumb) {
    // Thumbnail gagal (mis. gambar asli lebih kecil dari lebar yang diminta) = coba berkas aslinya
    try { return await fetchOne(thumb, tmpFile, outBase, referer, signal, check); } catch (e) { if (signal?.aborted) throw e; }
  }
  return fetchOne(rawUrl, tmpFile, outBase, referer, signal, check);
}

async function fetchOne(rawUrl: string, tmpFile: string, outBase: string, referer: string | undefined, signal: AbortSignal | undefined, check: (u: string) => Promise<URL>): Promise<FetchedImage & { file: string }> {
  let url = await check(rawUrl);
  let res: Response;
  for (let hop = 0; ; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), I.timeoutMs);
    signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
    try {
      res = await fetch(url, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8", ...(referer ? { referer } : {}) } });
    } catch (e) {
      throw new Error(ctrl.signal.aborted ? "Waktu unduh habis." : `Gagal mengunduh (${e instanceof Error ? e.message : e}).`);
    } finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= I.maxRedirects) throw new Error("Terlalu banyak pengalihan.");
      url = await check(new URL(res.headers.get("location")!, url).href);
      continue;
    }
    break;
  }
  if (!res.ok || !res.body) throw new Error(`Gambar tidak bisa diambil (HTTP ${res.status}).`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) throw new Error(`Bukan file gambar (${type || "tipe tidak diketahui"}); kemungkinan link halaman, bukan gambar.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > I.maxBytes) throw new Error("Gambar terlalu besar.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > I.maxBytes) { await reader.cancel(); throw new Error("Gambar terlalu besar."); }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);
  // SVG (sering untuk logo brand) tidak bisa di-encode ffmpeg: disimpan sebagai teks, hanya bila tidak memuat skrip
  if (type === "image/svg+xml") {
    const text = buf.toString("utf8");
    if (!/<svg[\s>]/i.test(text) || /<script|on\w+\s*=|javascript:|<foreignObject/i.test(text)) throw new Error("SVG ditolak (bukan SVG atau memuat skrip).");
    const file = `${outBase}.svg`;
    await writeFile(file, buf);
    return { mime: "image/svg+xml", ext: ".svg", bytes: buf.length, finalUrl: url.href, file };
  }
  // ffmpeg bawaan Remotion mengenali gambar dari ekstensi (tanpa ekstensi = "Invalid data"): beri ekstensi sesuai tipe,
  // dan cocokkan dengan tanda tangan berkas agar tipe yang salah dideklarasikan server tetap terbaca.
  const sniffed = buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? ".png" : buf[0] === 0xff && buf[1] === 0xd8 ? ".jpg"
    : buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP" ? ".webp" : buf.subarray(0, 3).toString("latin1") === "GIF" ? ".gif"
    : buf.subarray(4, 12).toString("latin1").startsWith("ftypavi") ? ".avif" : null;
  if (!sniffed) throw new Error(`Format gambar tidak didukung (${type}).`);
  tmpFile = `${tmpFile}${sniffed}`;
  await writeFile(tmpFile, buf);
  try {
    const png = sniffed !== ".jpg";
    const ext = png ? ".png" : ".jpg";
    const file = `${outBase}${ext}`;
    let dims: { width: number; height: number };
    try { dims = await reencodeImage(tmpFile, file, { maxLongSide: I.maxLongSide, jpegQ: I.jpegQ, png }); }
    catch { throw new Error("File gambar rusak atau formatnya tidak dikenali."); }
    if (Math.min(dims.width, dims.height) < I.minShortSide) { await rm(file, { force: true }); throw new Error(`Gambar terlalu kecil (${dims.width}×${dims.height}).`); }
    return { mime: png ? "image/png" : "image/jpeg", ext, ...dims, bytes: buf.length, finalUrl: url.href, file };
  } finally {
    await rm(tmpFile, { force: true });
  }
}
