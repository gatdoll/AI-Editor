# Fase 17: Voice over dari naskah

Permintaan pengguna (2–3 Nov 2026): di project motion, pengguna memberi naskah narasi dan prompt gaya visual. **Visual tetap dari Claude Code CLI, arahan suara dari Codex CLI, dan suaranya dikeluarkan mesin TTS gratis tanpa API berbayar.**

Status: **kode selesai (3 Nov 2026).** Tes otomatis dan uji ujung-ke-ujung tanpa database lulus. Menunggu langkah pengguna: migrasi `20261103100000_fase17_voiceover.sql`, mulai ulang aplikasi, lalu uji nyata dari browser (menulis naskah, motion Claude Code sungguhan, ekspor).

## Keputusan dan alasannya
| Kandidat | Hasil uji | Keputusan |
|---|---|---|
| Codex CLI sendiri | Tidak punya TTS bawaan (uji 2 Nov); skill `speech` butuh `OPENAI_API_KEY` | Dipakai sebagai pengarah, bukan mesin suara |
| OpenAI API | Berbayar | Ditolak pengguna |
| Voicebox + Chatterbox (`ms`) | Tidak punya kode `id`; `instruct` diabaikan; logat Melayu masih terasa (penilaian pengguna); trik ejaan Codex membuat hasil baca makin buruk | Ditolak |
| VoxCPM2 | Resmi mendukung Indonesia, tetapi sekitar 8 GB VRAM | Tidak dijalankan di mesin ini |
| OmniVoice (dari VoiceStudio) | Sekitar 6.300 jam data Indonesia, tetapi bobot CC-BY-NC | Tidak dipakai: non-komersial |
| **Supertonic-3** | Resmi `id`; audio 11 dtk selesai sekitar 3 dtk di CPU; Whisper mendeteksi `id` (93–98%), kata sesuai naskah | **Dipilih** |

Aplikasi VoiceStudio (AGPL-3.0) tidak dipasang: worker memanggil Supertonic-3 langsung. Bobot Supertonic-3 berlisensi BigScience Open RAIL-M, yang punya batasan penggunaan (Attachment A); periksa sebelum dipakai untuk konten komersial.

## Alur
```
Naskah + pilihan suara + prompt visual
  -> job `voiceover`
       Codex CLI (`codex exec --output-schema`): naskah baca + kecepatan; divalidasi kode kita
       Supertonic-3 (Python lokal, CPU): suara
       Whisper (bahasa id): waktu tiap kata
       Simpan: projects/<id>/voiceover/<job>.m4a + current.json
  -> (brief pertama) job `creative` otomatis
       Claude Code menerima data.words + brief.voiceover, menyusun adegan mengikuti narasi
  -> komposisi Motion memutar voice over; musik turun otomatis saat bicara
```

## Aturan
- Naskah asli tidak pernah diubah. Yang dibaca mesin disimpan terpisah sebagai naskah baca, dan bisa diedit pengguna.
- Codex hanya boleh mengubah cara tulis angka, singkatan, istilah asing, dan tanda baca. Ejaan kata biasa tidak boleh diubah, karena uji 2 Nov menunjukkan itu merusak pengucapan.
- Keluaran Codex divalidasi (`checkReading`): panjang, porsi kata naskah yang tersisa, dan tag. Kecepatan dijepit ke config.
- Codex gagal, kuota habis, atau keluarannya ditolak: naskah dibaca apa adanya dan alasannya tampil di UI (tidak gagal diam-diam).
- Asal naskah baca dicatat di tiap hasil: `codex`, `pengguna`, atau `naskah`.
- Kode AI tetap tidak memutar audio. Voice over diputar komposisi, sama seperti musik dan SFX.
- Durasi video mengikuti suara (suara + `tailS`), maksimal `MOTION_GFX.voiceover.maxDurationS`.
- Voice over gagal tidak menyentuh project, versi motion, maupun voice over aktif sebelumnya.

## Yang dibuat
- Config: `MOTION_GFX.voiceover`.
- Migrasi: jenis job `voiceover`. Hasil berbasis file, tanpa kolom baru.
- Shared: `voiceover.ts` (murni), `voiceover-store.ts` (Node).
- Worker: `voiceover.ts`, `py/voiceover.py`, `voiceover-smoke.ts`; `transcribeWav` menerima bahasa; `prepareMotion` memuat voice over.
- Remotion: `MotionProps.voiceover`, `duckedVolume`, `VOICEOVER_ID`; komposisi `Motion`; kontrak bagian Voice over.
- Web: rute `voiceover` (GET/POST/DELETE) dan `voiceover/file`; `VoiceoverPanel` di halaman brief dan tab "🎙 Voice over".
- Setup: `npm run setup:voiceover` (venv, model, dan contoh tiap suara di `MEDIA_DIR/voiceover-samples`).
- Contoh suara: klik suara = pilih dan putar contoh; rute `/api/voiceover/samples/[voice]`. Contoh memakai `sampleText` di config, belum melewati arahan Codex.

## Upload voice over (5 Nov 2026)
Pengguna bisa mengunggah voice over yang sudah jadi di halaman brief dan tab Voice over, sebagai ganti membuat dari naskah.
- Batas suara dinaikkan menjadi 5 menit (9 Nov 2026, untuk video branding), berlaku untuk upload dan naskah, di motion dan Animasi. Naskah maks. 5.000 karakter. Uji render 9 Nov (animasi sederhana, 9:16, voice over + subtitle): 9.000 frame selesai 207 dtk, durasi video dan audio 300 dtk, RAM bebas terendah 1,6 GB. Pembuatan motion oleh AI sepanjang 5 menit belum diuji.
- Alur: file (MP3/M4A/WAV/AAC/OGG, maks. 5 menit) -> rute `voiceover/upload` -> job `voiceover` dengan `payload.upload` -> `importVoiceover` (ffmpeg, waktu kata Whisper) -> voice over aktif -> job `creative` bila ada `next`. Tanpa Codex dan VoxCPM2, tanpa migrasi.
- Naskah opsional: dipakai untuk ejaan teks di layar. Kosong = transkrip Whisper, dan UI memberi tahu ejaannya bisa meleset. Waktu selalu dari Whisper.
- `direction: "unggahan"`, `profileId: null`. Arahan suara dan naskah baca tidak ditampilkan.
- File asli dihapus setelah job selesai atau dibatalkan; yang diputar hasil AAC.
- Whisper dipaksa bahasa `VO.language` (`id`), jadi voice over berbahasa lain akan salah transkrip.
- Subtitle (9 Nov 2026): pilihan "subtitle otomatis dari voice over" tampil di halaman brief begitu file dipilih, tidak perlu menunggu voice over selesai diproses. Tersimpan di `motion.subtitle` sebelum job dikirim, jadi AI langsung diberi tahu agar bawah layar dikosongkan.

## Uji
- [x] `apps/worker/test/fase17.test.ts` (masuk `npm test`): validasi arahan, jatuh ke naskah asli, durasi, kata di data AI, ducking, kontrak.
- [x] Uji asap `apps/worker/src/voiceover-smoke.ts` (3 Nov): Codex CLI sungguhan, Supertonic-3, Whisper, render MP4. Suara 14,4 dtk, total 42 dtk; MP4 berisi video dan audio; "80%" dibaca "delapan puluh persen".
- [ ] Migrasi dijalankan, aplikasi dimulai ulang.
- [ ] Uji pengguna dari browser: naskah + prompt visual, motion Claude Code mengikuti narasi, ganti suara, musik + voice over, ekspor MP4.

## Batasan yang diketahui
- Supertonic-3 tidak bisa clone suara dan tidak punya arahan emosi. Pilihannya 10 suara bawaan; natural tidaknya dipengaruhi tanda baca dan kecepatan dari Codex.
- Whisper kadang menulis angka sebagai digit atau meleset pada istilah (`e ai` terdengar `EI`). Teks di layar karena itu mengikuti naskah; dari Whisper hanya waktunya.
- Mengubah voice over tidak otomatis menyesuaikan versi motion yang sudah ada: perlu minta revisi.
- Di worker Linux/VPS: jalankan `npm run setup:voiceover` di dalam container agar venv dan model tersedia.
