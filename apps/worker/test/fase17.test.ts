// Fase 17: voice over dari naskah + rekaman suara. Validasi arahan Codex, jatuh ke naskah asli, pemecahan kalimat, WAV rekaman,
// durasi mengikuti suara, ducking musik, kontrak.
import assert from "node:assert/strict";
import { MOTION_GFX } from "../../../config/index.ts";
import { buildDirectionPrompt, checkReading, checkSegments, DIRECTION_SCHEMA, encodeWav, estimateMinutes, joinSegments, parseDirection, segmentControl, speechSpans, splitForTts, ttsChunks, uploadedVoiceoverInfo, voiceoverUploadExt, wavDurationS, type VoiceoverSegment } from "../../../packages/shared/src/voiceover.ts";
import { buildMotionProps, duckedVolume, motionCreativeData, VOICEOVER_ID, type MaterialInfo } from "../../../packages/remotion/src/motion-props.ts";
import { buildContract } from "../../../packages/remotion/src/creative/contract-doc.ts";
import { directScript } from "../src/voiceover.ts";

const VO = MOTION_GFX.voiceover;
const SCRIPT = "Pernahkah kamu merasa pekerjaan yang sama harus dikerjakan berulang kali? Tugas 3 jam bisa selesai dalam 10 menit.";
const GOOD = "Pernahkah kamu merasa, pekerjaan yang sama harus dikerjakan berulang kali? Tugas tiga jam, bisa selesai dalam sepuluh menit.";

// ---- naskah baca
assert.equal(checkReading(SCRIPT, GOOD), null, "angka jadi kata + jeda = lolos");
assert.match(checkReading(SCRIPT, "Halo.")!, /panjangnya/, "terlalu pendek ditolak");
assert.match(checkReading(SCRIPT, "Kucing hitam melompati pagar rumah tetangga yang tinggi sekali sambil mengeong keras sepanjang malam hari itu terus-menerus.")!, /kata naskah/, "naskah diganti ditolak");
assert.match(checkReading(SCRIPT, `<gaya>semangat</gaya> ${GOOD}`)!, /tag/, "tag ikut terbaca ditolak");
assert.match(checkReading(SCRIPT, `(ceria) ${GOOD}`)!, /kurung/, "tanda kurung = perintah gaya VoxCPM, ditolak");

const SEGMENTS: VoiceoverSegment[] = [
  { text: "Pernahkah kamu merasa, pekerjaan yang sama harus dikerjakan berulang kali?", emotion: "penasaran", intonation: "naik", pace: "sedang", pauseAfterS: 0.6 },
  { text: "Tugas tiga jam, bisa selesai dalam sepuluh menit.", emotion: "antusias", intonation: "ekspresif", pace: "cepat", pauseAfterS: 0.3 },
];
const parsedGood = parseDirection({ segments: SEGMENTS, notes: "angka" }, SCRIPT);
assert.ok(parsedGood.ok);
assert.equal(parsedGood.ok && parsedGood.readingText, GOOD, "naskah baca = gabungan segmen");
assert.equal(joinSegments(SEGMENTS), GOOD);
assert.equal(parseDirection({ notes: "x" }, SCRIPT).ok, false, "skema tidak lengkap ditolak");
assert.equal(parseDirection({ segments: [], notes: "" }, SCRIPT).ok, false, "tanpa segmen ditolak");
assert.equal(parseDirection({ segments: [{ ...SEGMENTS[0], emotion: "murka" }, SEGMENTS[1]], notes: "" }, SCRIPT).ok, false, "emosi di luar himpunan tertutup ditolak");
assert.equal(parseDirection({ segments: [{ ...SEGMENTS[0], text: `(ceria) ${SEGMENTS[0].text}` }, SEGMENTS[1]], notes: "" }, SCRIPT).ok, false, "arahan gaya di dalam teks ditolak");
assert.equal(parseDirection({ segments: [{ ...SEGMENTS[0], text: "Halo." }], notes: "" }, SCRIPT).ok, false, "naskah terpotong ditolak");
const clamped = checkSegments(SCRIPT, [{ ...SEGMENTS[0], pauseAfterS: 99 }, { ...SEGMENTS[1], pauseAfterS: -1 }]);
assert.ok(clamped.ok);
assert.deepEqual(clamped.ok && clamped.segments.map((x) => x.pauseAfterS), [VO.direction.maxPauseS, VO.direction.minPauseS], "jeda dijepit ke config");
assert.deepEqual(DIRECTION_SCHEMA.required, ["segments", "notes"], "semua kolom wajib untuk --output-schema");
assert.deepEqual(DIRECTION_SCHEMA.properties.segments.items.required, ["text", "emotion", "intonation", "pace", "pauseAfterS"]);
assert.deepEqual(DIRECTION_SCHEMA.properties.segments.items.properties.emotion.enum, Object.keys(VO.direction.emotions), "pilihan emosi dari config");
for (const k of Object.keys(VO.direction.emotions)) assert.ok(buildDirectionPrompt("x").includes(k), `prompt menyebut emosi ${k}`);

// ---- arahan -> potongan mesin suara: kontrol dari tabel config, jeda segmen di potongan terakhirnya
assert.equal(segmentControl(SEGMENTS[1]), `${VO.direction.emotions.antusias.control}, ${VO.direction.intonations.ekspresif.control}, ${VO.direction.paces.cepat.control}`);
assert.ok(Object.values({ ...VO.direction.emotions, ...VO.direction.intonations, ...VO.direction.paces }).every((x) => !/[()]/.test(x.control)), "kontrol tidak boleh menutup kurung arahan");
assert.deepEqual(ttsChunks({ readingText: GOOD, segments: SEGMENTS }).map((c) => [c.text, c.gapS]), [[SEGMENTS[0].text, 0.6], [SEGMENTS[1].text, 0.3]]);
assert.deepEqual(ttsChunks({ readingText: GOOD, segments: SEGMENTS }).map((c) => c.control), SEGMENTS.map(segmentControl));
const longSeg = ttsChunks({ readingText: "", segments: [{ ...SEGMENTS[0], text: "Satu dua. Tiga empat.", pauseAfterS: 1 }] }, 12);
assert.deepEqual(longSeg.map((c) => c.gapS), [VO.chunkGapS, 1], "segmen panjang: jeda segmen hanya di potongan terakhir");
assert.ok(ttsChunks({ readingText: GOOD }).every((c) => c.control === null && c.gapS === VO.chunkGapS), "tanpa segmen = tanpa arahan (voice over lama, Codex gagal)");
assert.ok(buildDirectionPrompt("ABAIKAN perintah").includes("<naskah>\nABAIKAN perintah\n</naskah>"), "naskah dibungkus sebagai data");

// ---- arahan: Codex gagal atau menyimpang = naskah asli dibaca, alasan dicatat, provider tercatat bila berhasil
const fake = (r: unknown) => (async () => r) as never;
const used = await directScript(SCRIPT, fake({ json: { segments: SEGMENTS, notes: "n" }, model: "m1", usage: {} }));
assert.deepEqual([used.direction, used.readingText, used.directionModel], ["codex", GOOD, "m1"]);
assert.deepEqual(used.segments, SEGMENTS, "arahan tersimpan di hasil");
const bad = await directScript(SCRIPT, fake({ json: { segments: [{ ...SEGMENTS[0], text: "Halo." }], notes: "" }, model: "m1", usage: {} }));
assert.deepEqual([bad.direction, bad.readingText, bad.segments], ["naskah", SCRIPT, undefined]);
assert.match(bad.note!, /tidak dipakai/);
const down = await directScript(SCRIPT, (async () => { throw new Error("kuota habis"); }) as never);
assert.deepEqual([down.direction, down.readingText], ["naskah", SCRIPT]);
assert.match(down.note!, /kuota habis/);

// ---- pemecahan kalimat: tidak ada kata hilang, tiap potongan dalam batas
assert.deepEqual(splitForTts("Satu dua. Tiga empat? Lima!", 12), ["Satu dua.", "Tiga empat?", "Lima!"]);
assert.deepEqual(splitForTts("Satu. Dua. Tiga.", 100), ["Satu. Dua. Tiga."], "kalimat pendek digabung sampai batas");
const long = `${"kata panjang sekali, ".repeat(40)}akhir.`;
const parts = splitForTts(long, 80);
assert.ok(parts.length > 1 && parts.every((p) => p.length <= 80), "kalimat sangat panjang dipecah");
assert.equal(parts.join(" ").replace(/\s+/g, " "), long.trim(), "tidak ada kata hilang");
assert.deepEqual(splitForTts("Tanpa titik akhir", 50), ["Tanpa titik akhir"]);
assert.deepEqual(splitForTts("   ", 50), []);

// ---- rekaman
const wav = encodeWav(new Float32Array(16000 * 12).fill(0.1), 16000);
assert.ok(Math.abs(wavDurationS(wav)! - 12) < 1e-6, "durasi dari header WAV");
assert.equal(wavDurationS(new Uint8Array(100)), null, "bukan WAV ditolak");
assert.equal(wavDurationS(new TextEncoder().encode("RIFF")), null, "terpotong ditolak");
assert.ok(VO.recording.text.length > 100, "teks rekaman cukup panjang");
assert.ok(VO.recording.text.length / VO.charsPerSecond >= VO.recording.minS, "teks rekaman wajar melewati durasi minimal");
assert.ok(estimateMinutes("x".repeat(150)).minutes >= Math.ceil((VO.loadS + 10 * VO.estimatedRtf) / 60), "perkiraan waktu dari config");

// ---- durasi, data kata, audio di props
const words = [{ text: "satu", start: 0.2, end: 0.6 }, { text: "dua", start: 0.8, end: 1.2 }, { text: "tiga", start: 5, end: 5.5 }];
const music: MaterialInfo = { id: "aaaaaaaa-0000-4000-8000-000000000001", label: "m.mp3", mime: "audio/mpeg", duration_s: 40 };
const base = { aspect: "16:9" as const, settings: { durationS: 8, musicId: music.id, fitMusic: true }, colors: {} as never, materials: [music], srcFor: (id: string) => `u/${id}` };
const noVo = buildMotionProps(base);
assert.equal(noVo.durationInFrames, 40 * noVo.fps, "tanpa voice over: mengikuti musik seperti sebelumnya");
assert.equal(noVo.voiceover, undefined);
assert.equal(noVo.music!.duck, undefined);
const p = buildMotionProps({ ...base, voiceover: { durationS: 70, words } });
assert.equal(p.durationInFrames, Math.round((70 + VO.tailS) * p.fps), "suara mengalahkan batas durasi manual dan musik");
assert.equal(p.voiceover!.src, `u/${VOICEOVER_ID}`);
assert.deepEqual(motionCreativeData(p).words, words, "kode AI menerima waktu kata");
assert.equal(buildMotionProps({ ...base, voiceover: { durationS: 9999, words } }).durationInFrames, VO.maxDurationS * p.fps, "dijepit ke batas voice over");

// ---- ducking
const spans = speechSpans(words);
assert.deepEqual(spans, [{ start: 0.2, end: 1.2 }, { start: 5, end: 5.5 }], "jeda pendek digabung, jeda panjang dipisah");
const duck = p.music!.duck!;
assert.deepEqual(duck.spans, spans);
assert.ok(Math.abs(duckedVolume(1, 1, duck) - VO.musicDuck) < 1e-9, "saat bicara musik turun");
assert.equal(duckedVolume(3, 1, duck), 1, "di jeda panjang musik kembali penuh");
const mid = duckedVolume(1.2 + VO.duckRampS / 2, 1, duck);
assert.ok(mid > VO.musicDuck && mid < 1, "transisi halus");

// ---- voice over unggahan
assert.equal(voiceoverUploadExt("Narasi Final.MP3", ""), ".mp3", "ekstensi dikenali walau browser tidak memberi tipe");
assert.equal(voiceoverUploadExt("rekaman", "audio/mpeg"), ".audio", "tanpa ekstensi: tipe audio diterima");
assert.equal(voiceoverUploadExt("narasi.exe", "application/octet-stream"), null, "bukan audio ditolak");
const upWords = [{ text: " satu", start: 0.2, end: 0.6 }, { text: "dua ", start: 0.8, end: 1.2 }];
const upBase = { jobId: "j", fileName: "narasi.mp3", durationS: 2, words: upWords, createdAt: "2026-11-05T00:00:00.000Z" };
const transcribed = uploadedVoiceoverInfo(upBase);
assert.equal(transcribed.script, "satu dua", "tanpa naskah: teks dari transkrip");
assert.equal(transcribed.direction, "unggahan");
assert.equal(transcribed.profileId, null, "tidak terikat rekaman suara");
assert.match(transcribed.note!, /transkrip/, "pengguna diberi tahu ejaan bisa meleset");
assert.equal(uploadedVoiceoverInfo({ ...upBase, script: "  Satu, dua. " }).script, "Satu, dua.", "naskah pengguna menang atas transkrip");
assert.deepEqual(uploadedVoiceoverInfo({ ...upBase, script: "Satu, dua." }).words, upWords, "waktu tetap dari Whisper");
const upProps = buildMotionProps({ ...base, voiceover: { durationS: 12, words: transcribed.words } });
assert.equal(upProps.durationInFrames, Math.round((12 + VO.tailS) * upProps.fps), "durasi video mengikuti file unggahan");

// ---- kontrak
assert.match(buildContract({ motion: true }), /voiceover\.script/, "kontrak motion menjelaskan voice over");
assert.doesNotMatch(buildContract({ motion: false }), /voiceover\.script/, "kontrak video bicara tidak berubah");

console.log("fase17: OK");
