import fs from "node:fs";
import { Readable } from "node:stream";

/** Serve immutable local media with byte ranges and bounded read-ahead. */
export function mediaResponse(req: Request, file: string, contentType: string, etag: string, downloadName?: string): Response {
  const size = fs.statSync(file).size;
  const headers = new Headers({ "content-type": contentType, "accept-ranges": "bytes", "cache-control": "private, max-age=0, must-revalidate", etag });
  if (downloadName) headers.set("content-disposition", `attachment; filename="${downloadName}"`);
  if (req.headers.get("if-none-match")?.split(",").some((v) => v.trim() === etag || v.trim() === "*")) return new Response(null, { status: 304, headers });
  let start = 0, end = size - 1, status = 200;
  // HEAD describes the complete representation without opening a file stream.
  const range = req.method === "HEAD" ? null : req.headers.get("range");
  const ifRange = req.headers.get("if-range");
  if (range && (!ifRange || ifRange === etag)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const invalid = () => {
      headers.set("content-range", `bytes */${size}`);
      headers.set("content-length", "0");
      return new Response(null, { status: 416, headers });
    };
    if (!m || (!m[1] && !m[2]) || size === 0) return invalid();
    const a = Number(m[1]), b = Number(m[2]);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return invalid();
    if (!m[1]) {
      if (b <= 0) return invalid();
      start = Math.max(0, size - b);
    } else {
      start = a;
      if (m[2]) end = Math.min(b, size - 1);
    }
    if (start > end || start >= size) return invalid();
    status = 206;
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("content-length", String(Math.max(0, end - start + 1)));
  if (req.method === "HEAD" || size === 0) return new Response(null, { status, headers });

  const stream = fs.createReadStream(file, { start, end, highWaterMark: 64 * 1024 });
  // Release cancelled seeks, including requests aborted before the body starts.
  const abort = () => stream.destroy();
  req.signal.addEventListener("abort", abort, { once: true });
  stream.once("close", () => req.signal.removeEventListener("abort", abort));
  const body = Readable.toWeb(stream, {
    // Default size counts chunks, turning 64 KiB into 65,536 chunks of read-ahead.
    strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
  });
  if (req.signal.aborted) abort();
  return new Response(body as ReadableStream, { status, headers });
}
