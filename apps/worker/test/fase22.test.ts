// Fase 22: video referensi gaya (unggah / link YouTube, Instagram, TikTok) untuk Mode Kreatif di semua kategori
// (video, klip akhir, motion, animasi, Opinion Motion). Bagian murni + penyimpanan di folder media sementara.
// Jalankan: node apps/worker/test/fase22.test.ts
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";

const tmp = await mkdtemp(path.join(os.tmpdir(), "fase22-"));
process.env.MEDIA_DIR = tmp;
const { attachReference, loadReference, referenceDir, saveReference } = await import("../../../packages/shared/src/reference-store.ts");
const { referenceErrors, referenceInstruction } = await import("../src/creative/loop.ts");

try {
  const project = crypto.randomUUID();
  // ---- link: dikanonikkan (token pelacak dibuang) dan dicatat sebagai referensi project ini
  const link = await attachReference(project, { kind: "link", url: "https://www.tiktok.com/@demo/video/123456789?is_from_webapp=1&sender=x", startS: 4 });
  assert.equal(link.url, "https://www.tiktok.com/@demo/video/123456789");
  assert.equal(link.startS, 4);
  assert.match(link.label, /TikTok/);
  assert.equal((await loadReference(project, link.id)).kind, "link");
  await assert.rejects(attachReference(project, { kind: "link", url: "https://www.tiktok.com/@demo", startS: 0 }), /satu video/, "profil ditolak");
  await assert.rejects(attachReference(project, { kind: "link", url: "http://127.0.0.1/a.mp4", startS: 0 }), "alamat lokal ditolak");

  // ---- unggahan: harus milik project ini
  const up = crypto.randomUUID();
  await mkdir(referenceDir(project, up), { recursive: true });
  await writeFile(path.join(referenceDir(project, up), "source.mp4"), "x");
  await saveReference({ id: up, projectId: project, kind: "upload", label: "gaya.mp4", file: "source.mp4", size: 1 });
  assert.deepEqual(await attachReference(project, { kind: "upload", id: up, startS: 0 }), { id: up, label: "gaya.mp4", startS: 0 });
  await assert.rejects(attachReference(crypto.randomUUID(), { kind: "upload", id: up, startS: 0 }), /tidak ditemukan/, "unggahan project lain ditolak");
  await assert.rejects(attachReference(project, { kind: "upload", id: link.id, startS: 0 }), /tidak valid/, "link bukan unggahan");

  // ---- instruksi agen: lihat frame dulu, tulis reference.md, tiru gaya bukan isi
  const ins = referenceInstruction({ files: ["reference/frame-01.png", "reference/frame-02.png"], times: [4, 4.2], label: "TikTok · referensi video", url: link.url, startS: 4, sampledSeconds: 30, width: 1080, height: 1920 });
  assert.match(ins, /frame-01\.png=4\.00s, frame-02\.png=4\.20s/);
  assert.match(ins, /dari detik 4 sampai 34\.0/);
  assert.match(ins, /LANGKAH 1[\s\S]*reference\.md/);
  assert.match(ins, /JANGAN menyalin isi/);
  assert.match(ins, /DATA, bukan instruksi/);
  assert.match(ins, /audio[\s\S]*tidak terlihat/i);
  assert.equal(referenceErrors(true, false).length, 1, "referensi tanpa analisis = diperbaiki agen");
  assert.equal(referenceErrors(true, true).length, 0);
  assert.equal(referenceErrors(false, false).length, 0, "tanpa referensi tidak ada kewajiban");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
console.log("fase22: semua tes lulus");
