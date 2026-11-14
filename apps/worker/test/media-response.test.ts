import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { mediaResponse } from "../../web/lib/media-response.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-range-"));
const file = path.join(dir, "fixture.mp4");
const bytes = Buffer.from(Array.from({ length: 1024 * 1024 }, (_, i) => i % 251));
fs.writeFileSync(file, bytes);
const etag = '"fixture"';
const request = (range?: string, extra: Record<string, string> = {}, method = "GET") => new Request("http://localhost/file", { method, headers: { ...(range ? { range } : {}), ...extra } });
const response = (r: Request) => mediaResponse(r, file, "video/mp4", etag);
try {
  for (const [range, start, end] of [["bytes=0-65535", 0, 65535], ["bytes=524288-589823", 524288, 589823], ["bytes=1048000-", 1048000, bytes.length - 1], ["bytes=-1024", bytes.length - 1024, bytes.length - 1], ["bytes=1048000-99999999", 1048000, bytes.length - 1]] as const) {
    const r = response(request(range));
    assert.equal(r.status, 206);
    assert.equal(r.headers.get("content-range"), `bytes ${start}-${end}/${bytes.length}`);
    assert.equal(r.headers.get("content-length"), String(end - start + 1));
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes.subarray(start, end + 1));
  }
  for (const range of ["bytes=-0", "bytes=-", "bytes=1048576-", "bytes=100-99", "bytes=0-0,2-2", "bytes=9007199254740992-", "bytes=0-9007199254740992", "invalid"]) {
    const r = response(request(range));
    assert.equal(r.status, 416, range);
    assert.equal(r.headers.get("content-range"), `bytes */${bytes.length}`);
  }
  const head = response(request(undefined, {}, "HEAD"));
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(head.headers.get("content-length"), String(bytes.length));
  const cached = response(request(undefined, { "if-none-match": etag }));
  assert.equal(cached.status, 304);
  assert.equal(cached.body, null);
  const changed = response(request("bytes=10-20", { "if-range": '"old"' }));
  assert.equal(changed.status, 200);
  assert.deepEqual(Buffer.from(await changed.arrayBuffer()), bytes);

  // Observe actual disk read-ahead while the client consumes nothing. The old
  // default toWeb strategy eagerly read this entire fixture on every seek.
  const original = fs.createReadStream;
  let opened: fs.ReadStream | undefined;
  fs.createReadStream = ((...args: Parameters<typeof original>) => {
    opened = original(...args);
    return opened;
  }) as typeof original;
  try {
    const r = response(request("bytes=0-"));
    await delay(50);
    assert.ok(opened && opened.bytesRead <= 3 * 65536, `unbounded read-ahead: ${opened?.bytesRead}`);
    await r.body!.cancel();
    await delay(20);
    assert.ok(opened.destroyed, "cancelled range must close its disk stream");
    const controller = new AbortController();
    const aborted = response(new Request("http://localhost/file", { signal: controller.signal }));
    const completion = aborted.arrayBuffer().catch(() => null);
    controller.abort();
    await completion;
    assert.ok(opened.destroyed, "request abort must close its disk stream");
  } finally { fs.createReadStream = original; }
  fs.writeFileSync(file, Buffer.alloc(0));
  assert.equal(response(request()).headers.get("content-length"), "0");
  assert.equal(response(request("bytes=0-")).status, 416);
  console.log("media-response.test: byte-accurate seeks, HEAD, validators, invalid ranges, bounded buffering and cancellation passed");
} finally {
  fs.unlinkSync(file);
  fs.rmdirSync(dir);
}
