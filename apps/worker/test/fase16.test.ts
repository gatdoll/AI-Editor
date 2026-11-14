// Fase 16: banyak video dalam satu project. Sumbu reel (offset tetap), urutan tampil, video tersembunyi, pemetaan waktu
// tanpa asumsi urut naik, props komposisi per file, dan project lama (satu video) identik. Jalankan: node apps/worker/test/fase16.test.ts
import assert from "node:assert/strict";
import { VIDEO } from "../../../config/index.ts";
import { buildEdl } from "../../../packages/shared/src/edl.ts";
import { applyManualEdl } from "../../../packages/shared/src/manual.ts";
import { arrangeEdl, arrangeSegments, clipAt, nextOffset, normalizeFocusBy, normalizeIdList, normalizeOrder, reelDuration, reelMediaSeconds, type ReelClip } from "../../../packages/shared/src/reel.ts";
import { rawLabel, reelOf } from "../../../packages/shared/src/reel-db.ts";
import type { AssetRow } from "../../../packages/shared/src/index.ts";
import { buildEditedProps, DEFAULT_STYLE, normalizeStyle } from "../../../packages/remotion/src/build-props.ts";
import { mapWordsToTimeline } from "../../../packages/remotion/src/captions.ts";
import { toFrameSegments } from "../../../packages/remotion/src/frames.ts";
import { mapSpanToOutput } from "../../../packages/remotion/src/subtitle-clips.ts";
import { mapRangeToOutput, outputToSource, sourceToOutput } from "../../../packages/remotion/src/timeline.ts";
import { localRanges } from "../src/reel-media.ts";

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} != ${b}`);
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const gap = VIDEO.reelGapSec;
// Tiga video: A 10 s di 0, B 6 s, C 4 s (offset = akhir sebelumnya + jarak)
const clips: ReelClip[] = [];
for (const [id, d] of [[A, 10], [B, 6], [C, 4]] as const) clips.push({ id, offset: nextOffset(clips, gap), duration: d });
const [ca, cb, cc] = clips;

// ---- sumbu reel: offset tetap, video baru di ujung
assert.equal(ca.offset, 0, "video pertama mulai di 0");
near(cb.offset, 10 + gap);
near(cc.offset, 10 + gap + 6 + gap);
near(reelDuration(clips), cc.offset + 4);
assert.equal(reelMediaSeconds(clips), 20, "durasi media tanpa lubang");
assert.equal(clipAt(clips, 0)?.id, A);
assert.equal(clipAt(clips, cb.offset + 1)?.id, B);
assert.equal(clipAt(clips, 10 + gap / 2), undefined, "lubang antar video bukan milik video mana pun");
assert.equal(clipAt(clips, reelDuration(clips))?.id, C, "akhir video terakhir masih milik video itu");

// ---- urutan tampil
assert.deepEqual(normalizeOrder(undefined, clips), [A, B, C], "bawaan = urutan unggah");
assert.deepEqual(normalizeOrder([C, A], clips), [C, A, B], "video yang tidak disebut menyusul menurut offset");
assert.deepEqual(normalizeOrder([C, "hilang", C, A], clips), [C, A, B], "id hilang/ganda dibuang");
assert.deepEqual(normalizeIdList([A.toUpperCase(), A, "bukan-uuid", 3]), [A]);
assert.equal(normalizeIdList([]), undefined);
assert.deepEqual(normalizeFocusBy({ [A]: 2, [B]: -1, x: 0.3, [C]: Number.NaN }), { [A]: 1, [B]: 0 });

// ---- segmen tersusun: dipotong di batas video, lubang dibuang, dikelompokkan per urutan
{
  const whole = [{ start: 0, end: reelDuration(clips) }];
  const seg = arrangeSegments(whole, clips, [C, A, B]);
  assert.deepEqual(seg.map((s) => [s.start, s.end]), [[cc.offset, cc.offset + 4], [0, 10], [cb.offset, cb.offset + 6]]);
  const hidden = arrangeSegments(whole, clips, [C, A, B], [A]);
  assert.deepEqual(hidden.map((s) => s.start), [cc.offset, cb.offset], "video tersembunyi tidak tampil");
  // potongan di dalam video tetap urut waktu di dalam videonya
  const cutInA = arrangeSegments([{ start: 0, end: 3 }, { start: 5, end: cb.offset + 2 }], clips, [B, A]);
  assert.deepEqual(cutInA.map((s) => [s.start, s.end]), [[cb.offset, cb.offset + 2], [0, 3], [5, 10]]);
  assert.deepEqual(arrangeSegments([{ start: 2, end: 4 }], []), [{ start: 2, end: 4 }], "tanpa reel = apa adanya");
  // tiap segmen berada di dalam satu video (syarat komposisi memilih file per segmen)
  for (const s of seg) assert.ok(clips.some((c) => s.start >= c.offset - 1e-9 && s.end <= c.offset + c.duration + 1e-9));
}

// ---- EDL tersusun: angka dipertahankan/dipotong dihitung dari media, bukan dari lubang
{
  const dur = reelDuration(clips);
  const edl = arrangeEdl(applyManualEdl(buildEdl(dur, [{ start: 2, end: 4 }], VIDEO.cutPaddingSec), undefined, dur), clips, [B, C, A]);
  assert.equal(edl.segments[0].start, cb.offset, "B tampil pertama");
  const kept = edl.segments.reduce((n, s) => n + s.end - s.start, 0);
  near(edl.keptS, kept);
  near(edl.removedS, 20 - kept);
  assert.ok(edl.removedS > 1.5 && edl.removedS < 2.5, "hanya potongan 2-4 s (plus padding) yang terhitung dipotong");
}

// ---- pemetaan waktu dengan urutan dibalik (C, A, B)
{
  const fps = 30;
  const segs = arrangeSegments([{ start: 0, end: reelDuration(clips) }], clips, [C, A, B]);
  const frames = toFrameSegments(segs, fps, reelDuration(clips));
  near(sourceToOutput(frames, fps, cc.offset + 1).out, 1, "C diputar pertama");
  near(sourceToOutput(frames, fps, 2).out, 4 + 2, "A sesudah C");
  near(sourceToOutput(frames, fps, cb.offset).out, 14, "B terakhir");
  assert.equal(sourceToOutput(frames, fps, 10 + gap / 2).inCut, true, "lubang reel = terpotong");
  for (const t of [0.5, 3, 7.25, 12, 13.9]) near(sourceToOutput(frames, fps, outputToSource(frames, fps, t)).out, t, `bolak-balik di ${t}`);
  near(outputToSource(frames, fps, 0.5), cc.offset + 0.5);
  // judul/sorotan dan subtitle klip: rentang dalam satu video
  assert.deepEqual(mapRangeToOutput(frames, fps, cb.offset + 1, cb.offset + 2), { start: 15, end: 16 });
  const sp = mapSpanToOutput(segs, fps, reelDuration(clips), 9, cb.offset + 1);
  assert.deepEqual(sp, { start: 13, end: 15 }, "A lalu B bersambung di hasil: satu rentang");
  // B tampil sebelum A: rentang tidak boleh membentang di atas seluruh hasil, pakai bagian bersambung terpanjang
  const ba = arrangeSegments([{ start: 0, end: reelDuration(clips) }], clips, [B, A, C]);
  const sp2 = mapSpanToOutput(ba, fps, reelDuration(clips), 8.5, cb.offset + 1);
  assert.deepEqual(sp2, { start: 6 + 8.5, end: 16 }, "bagian di A (1,5 s) lebih panjang dari bagian di B (1 s)");
  // project satu video: rentang melintasi cut tetap satu rentang dari potongan pertama sampai terakhir (perilaku lama)
  assert.deepEqual(mapSpanToOutput([{ start: 0, end: 2 }, { start: 3, end: 6 }], fps, 6, 1, 4), { start: 1, end: 3 });
  // kata dari video berbeda tersusun menurut waktu hasil
  const words = [{ text: "satu", start: 1, end: 1.4 }, { text: "dua", start: cb.offset + 0.5, end: cb.offset + 0.9 }, { text: "tiga", start: cc.offset + 0.2, end: cc.offset + 0.6 }];
  const tw = mapWordsToTimeline(words, segs, fps, reelDuration(clips));
  assert.deepEqual(tw.map((w) => w.text), ["tiga", "satu", "dua"]);
  for (let i = 1; i < tw.length; i++) assert.ok(tw[i].start >= tw[i - 1].start);
}

// ---- props komposisi: sumber per video + fokus per video; satu video = sama dengan data lama
{
  const source = { width: 1920, height: 1080, fps: 30, durationS: reelDuration(clips) };
  const style = normalizeStyle({ ...DEFAULT_STYLE, focusBy: { [B]: 0.2 } });
  const segs = arrangeSegments([{ start: 0, end: reelDuration(clips) }], clips, [C, A, B]);
  const { props } = buildEditedProps({ segments: segs, source, words: [], style, seed: 1, clips });
  assert.deepEqual(props.sources?.map((s) => s.id), [A, B, C]);
  assert.equal(props.sources?.find((s) => s.id === B)?.focusX, 0.2);
  assert.equal(props.sources?.find((s) => s.id === A)?.focusX, undefined, "tanpa fokus khusus = fokus project");
  assert.equal(props.segments.length, 3, "segmen beda video tidak digabung (ada lubang)");

  const one: ReelClip[] = [{ id: A, offset: 0, duration: 10 }];
  const oldSegs = [{ start: 0, end: 3 }, { start: 4, end: 10 }];
  const src1 = { width: 1920, height: 1080, fps: 30, durationS: 10 };
  const legacy = buildEditedProps({ segments: oldSegs, source: src1, words: [], style: DEFAULT_STYLE, seed: 7 }).props;
  const reel1 = buildEditedProps({ segments: arrangeSegments(oldSegs, one), source: src1, words: [], style: DEFAULT_STYLE, seed: 7, clips: one }).props;
  const { sources, ...rest } = reel1;
  assert.equal(sources?.length, 1);
  assert.deepEqual(rest, legacy, "project satu video: props identik selain daftar sumber");
}

// ---- reel dari baris aset: urut unggah, project lama tanpa kolom offset
{
  const row = (id: string, created: string, extra: Partial<AssetRow>) => ({ id, project_id: "p", kind: "raw", storage_path: `projects/p/raw/${id}-take ${id[0]}.mp4`, created_at: created, duration_s: 5, ...extra }) as unknown as AssetRow;
  const legacy = reelOf([row(A, "2026-10-01", { reel_offset_s: undefined })]);
  assert.deepEqual(legacy.clips.map((c) => c.offset), [0], "satu video tanpa migrasi = offset 0");
  const multi = reelOf([row(B, "2026-10-02", { reel_offset_s: 6 }), row(A, "2026-10-01", { reel_offset_s: 0 }), row(C, "2026-10-03", { reel_offset_s: null, duration_s: null })]);
  assert.equal(multi.primary?.id, A, "video utama = yang pertama diunggah");
  assert.deepEqual(multi.clips.map((c) => c.id), [A, B], "video yang belum diingest belum punya posisi");
  assert.equal(multi.assets.length, 3);
  assert.equal(rawLabel(multi.assets[0]), "take a.mp4");
}

// ---- worker: rentang reel -> rentang lokal per file
{
  const parts = localRanges(clips, [{ start: 8, end: cb.offset + 2 }]);
  assert.deepEqual(parts.map((p) => [p.clip.id, p.local.map((r) => [r.start, r.end])]), [[A, [[8, 10]]], [B, [[0, 2]]]]);
  const all = localRanges(clips, null);
  assert.deepEqual(all.map((p) => p.local[0].end), [10, 6, 4], "tanpa rentang = seluruh tiap video");
}

console.log("fase16: reel, urutan tampil, video tersembunyi, pemetaan waktu tanpa urut naik, sumber per file, project lama identik passed");
