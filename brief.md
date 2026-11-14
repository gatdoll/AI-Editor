# Brief: Aplikasi Editor Video Berbasis Remotion + Claude

Versi 0.1 | Dibuat 27 Oktober 2026

## 1. Tujuan

Membangun aplikasi web sehingga pengguna **tidak perlu command prompt**. Pengguna mengunggah video mentah, sistem mengusulkan bagian yang sebaiknya di-cut (retake, salah ucap, jeda, filler), pengguna mereview, lalu sistem menambahkan permainan kamera dan subtitle bergaya modern, dan merender MP4.

Sebelumnya semua ini dilakukan lewat Claude Code di terminal. Aplikasi ini membungkus alur itu dalam antarmuka.

## 2. Asumsi yang dipakai (koreksi kalau salah)

- Jenis video utama: **video bicara** (talking head, tutorial, voiceover). Deteksi cut berbasis transkrip hanya andal untuk video yang ada suaranya.
- Bahasa utama: Indonesia dengan istilah Inggris.
- Tahap awal dipakai sendiri. Rencana dijual datang setelah MVP stabil.
- Pengembangan dibantu Claude Code.

## 3. Alur utama pengguna

1. **Upload** video mentah ke project baru.
2. **Transkrip** otomatis dengan timestamp per kata.
3. **Analisis cut**: sistem menghasilkan daftar usulan (mulai, selesai, jenis, alasan, kutipan teks).
4. **Review**: pengguna menyetujui, menolak, atau menggeser tiap usulan. Ada pemutar untuk mendengar hasil sebelum dan sesudah cut.
5. **Styling**: pilih preset kamera dan gaya subtitle.
6. **Preview** di browser memakai Remotion Player.
7. **Render** ke MP4 dan unduh.

## 4. Ruang lingkup

### MVP (wajib)
- Project, upload, penyimpanan file mentah.
- Transkrip dengan timestamp per kata.
- Deteksi: retake/pengulangan kalimat, koreksi diri, filler, jeda panjang.
- Layar review cut (setuju/tolak per usulan).
- Komponen kamera reusable (push-in, pull-back, pan, zoom ke titik) dengan easing.
- Subtitle per kata dengan highlight, di layer terpisah dari kamera.
- Preview dan render MP4.

### Setelah MVP
- Analisis visual (sampling frame) untuk kesalahan tanpa suara.
- Face tracking untuk framing otomatis.
- Beat sync dengan musik.
- Multi-user, pembayaran, kuota render.

### Di luar lingkup
- Editor timeline penuh ala Premiere (kecuali memakai Editor Starter, lihat bagian 5).
- Mengizinkan user mengunggah kode Remotion sendiri (dilarang lisensi, lihat bagian 9).

## 5. Keputusan: fork repo atau template mana

Perlu diputuskan di awal. Tiga opsi:

| Opsi | Sumber | Biaya | Kelebihan | Kekurangan |
|---|---|---|---|---|
| A. Remotion Recorder | github.com/remotion-dev/recorder (`npx create-video@latest --recorder`) | Gratis, open source | Sudah ada alur Whisper lokal dan potongan otomatis untuk video bicara | Dirancang untuk alur perekaman milik mereka, bukan aplikasi multi-user. UI harus banyak diubah |
| B. Template Next.js | `npx create-video@latest --next` | Gratis | Bersih, kamu yang menentukan semua | Semua UI dibangun dari nol |
| C. Editor Starter | remotion.dev/editor-starter | Berbayar, sekali beli | Timeline, canvas, asset upload, captioning, dan rendering sudah ada | Berbayar, punya lisensi sendiri yang harus dicek sebelum dijual |

**Rekomendasi sementara:** mulai dari **B** (template Next.js), dan jadikan **A** sebagai referensi logika Whisper dan pemotongan. Pilih C hanya jika kamu memang butuh editor timeline manual. [Likely]

**Catatan:** isi repo di atas diketahui dari dokumentasi dan artikel, belum saya buka satu per satu. Tugas pertama di Claude Code adalah membaca README tiap opsi dan mengonfirmasi.

## 6. Arsitektur yang diusulkan

- **Frontend:** Next.js + React, Remotion Player untuk preview.
- **Backend:** API routes Next.js (atau service Node terpisah).
- **Storage dan database:** Supabase (Postgres + Storage) untuk project, transkrip, daftar cut, dan file. Boleh diganti kalau ada preferensi lain.
- **Transkrip:** Whisper.cpp lokal via `@remotion/install-whisper-cpp`, atau API transkripsi. Putuskan berdasarkan biaya dan akurasi pada bahasa campuran.
- **Analisis cut:** Claude API. Input transkrip dengan timestamp, output JSON berstruktur. Kunci API hanya di server.
- **Deteksi jeda:** `ffmpeg silencedetect`.
- **Render:** Remotion Lambda (AWS), Cloud Run, atau server sendiri dengan `@remotion/renderer`. Render butuh Chrome dan ffmpeg, jadi tidak cocok di serverless biasa tanpa penyiapan khusus. Putuskan saat milestone 4.
- **Antrean:** render berjalan sebagai job asinkron dengan status (queued, rendering, done, failed).

## 7. Model data (garis besar)

- `projects`: id, nama, status, dibuat.
- `assets`: id, project_id, jenis (raw, audio, output), path, durasi, resolusi.
- `transcripts`: id, asset_id, bahasa, words (array: teks, mulai, selesai, confidence).
- `cut_suggestions`: id, project_id, mulai, selesai, jenis (retake, koreksi, filler, jeda), alasan, kutipan, status (pending, approved, rejected).
- `edit_decision_list` (EDL): daftar segmen yang dipertahankan, keyframe kamera per segmen, gaya subtitle. Ini satu-satunya sumber kebenaran untuk render.
- `render_jobs`: id, project_id, status, output_asset_id, error.

## 8. Aturan yang tidak boleh dilanggar

1. **File mentah tidak pernah diubah.** Semua edit bersifat non-destruktif lewat EDL.
2. **Tidak ada cut otomatis tanpa persetujuan pengguna.** Sistem hanya mengusulkan.
3. Untuk retake, default mempertahankan take terakhir kecuali ada alasan lain, dan alasannya ditampilkan.
4. Subtitle selalu di layer terpisah di atas kamera, tidak ikut bergerak.
5. Padding 0,1 detik di tiap sambungan cut agar tidak terasa patah.
6. Kunci API tidak pernah dikirim ke browser.
7. Kalau satu bagian tidak bisa dinilai (misalnya kesalahan visual tanpa suara), sistem harus bilang tidak bisa menilai, bukan menebak.
8. Semua konstanta gaya (warna, font, durasi, easing) di satu file config.

## 9. Lisensi dan kepatuhan

Hasil pencarian per 26 Oktober 2026. Baca ulang sebelum jualan karena lisensi Remotion akan sedikit berubah di versi 5.0.

- **Gratis:** individu dan perusahaan sampai 3 orang, termasuk komersial dan automation.
- **Wajib Company License:** 4 orang ke atas. Opsi "Remotion for Automators": $0,01 per render, minimum $100 per bulan.
- Headcount dihitung gabungan kalau berkolaborasi dengan tim atau perusahaan lain.
- **Boleh:** user merender video dari template milikmu, dan layanan yang meng-generate kode Remotion dengan AI lalu merendernya.
- **Dilarang:** user mengunggah kode Remotion sendiri untuk dirender, dan menjual Remotion itu sendiri atau turunannya.
- **Editor Starter** punya lisensi sendiri di luar lisensi Remotion. Isinya belum saya baca. Cek apakah boleh dipakai sebagai dasar aplikasi yang dijual sebelum membeli.
- Aset di dalam video (musik, font, foto stok, logo) punya lisensi masing-masing.
- Repo skill pihak ketiga punya file LICENSE sendiri. Cek sebelum memakai kodenya.

## 10. Spesifikasi kamera dan subtitle

**Kamera**
- Komponen `<Camera>` membungkus scene, menganimasikan scale, translate, dan rotate dengan `interpolate()` dan `spring()`.
- Semua gerakan memakai easing, tidak ada gerakan linear.
- Preset: push-in perlahan, pull-back reveal, pan horizontal, tilt ringan, zoom ke titik.
- Tidak boleh memakai preset yang sama dua kali berturut-turut.
- Drift atau getaran handheld sangat kecil agar frame tidak statis.
- Catatan teknis: zoom pada rekaman 1080p mulai terlihat pecah di atas sekitar 1,2x. Rekam 4K, atau batasi zoom. [Likely]

**Subtitle**
- `@remotion/captions`, gaya per kata: kata yang diucapkan ter-highlight, lainnya redup.
- Maksimal 2 baris, ukuran besar, kontras tinggi, di safe zone bawah (hindari UI Instagram dan TikTok untuk 9:16).
- Timing dari transkrip Whisper, bukan tebakan.

**Gaya**
- Tipografi tebal dari satu font family sans-serif modern (Inter, Geist, atau Plus Jakarta Sans), maksimal 2 weight.
- Maksimal 3 warna utama, gradient halus, grain film tipis dan vignette ringan.

## 11. Milestone

1. **Fondasi:** fork atau template, aplikasi jalan lokal, satu video contoh dirender dari kode.
2. **Ingest dan transkrip:** upload, penyimpanan, transkrip dengan timestamp per kata, tampil di UI.
3. **Deteksi cut dan review:** analisis Claude plus ffmpeg, layar review, EDL tersimpan.
4. **Render dengan cut:** EDL diterapkan ke Remotion, preview dan render MP4. Putuskan hosting render di sini.
5. **Kamera dan subtitle:** komponen kamera, preset, subtitle per kata, pemilih gaya.
6. **Pemolesan:** status render, penanganan error, uji pada 5 video nyata.
7. **(Opsional) Komersialisasi:** login, kuota, pembayaran, cek ulang lisensi.

## 12. Kriteria selesai MVP

- Video bicara 5 menit bisa diunggah dan diproses tanpa terminal.
- Dari video uji yang sudah diberi label manual, sistem menemukan sebagian besar retake yang disengaja. Target angka ditentukan setelah ada 5 video uji. Jangan menjanjikan akurasi sebelum diukur.
- Tidak ada cut yang diterapkan tanpa persetujuan.
- Hasil render memiliki subtitle yang sinkron dan minimal satu gerakan kamera bermakna per scene.
- File mentah tetap utuh setelah semua proses.

## 13. Risiko

- **Whisper lemah pada bahasa campuran Indonesia-Inggris dan nama produk.** Akurasi deteksi ikut turun. Sediakan fitur koreksi transkrip. [Likely]
- **Claude bisa menganggap pengulangan yang disengaja (penekanan) sebagai retake.** Karena itu ada tahap review. [Likely]
- **Kesalahan visual tanpa suara tidak terdeteksi andal.** Jangan dijanjikan di versi awal. [Certain]
- **Render butuh infrastruktur khusus**, dan biayanya naik seiring jumlah render. Hitung sebelum menentukan harga jual. [Likely]
- **Biaya lisensi bisa muncul lebih awal** kalau headcount lewat 3 orang. [Likely]
- **Ketergantungan pada template berbayar** (opsi C) menambah risiko lisensi. [Guessing]

## 14. Pertanyaan terbuka

1. Video yang diedit selalu ada suara bicara, atau ada yang visual saja?
2. Dipakai sendiri dulu, atau langsung dijual ke orang lain?
3. Siapa saja yang terlibat dalam proyek (untuk hitungan lisensi)?
4. Rasio target: 16:9, 9:16, atau keduanya?
5. Durasi video tipikal? Ini memengaruhi biaya transkrip dan render.
6. Hosting: sudah ada akun AWS, VPS, atau Supabase yang akan dipakai?

## 15. Langkah pertama di Claude Code

Tempel ini ke Claude Code sebagai tugas pertama:

```
Baca brief.md sepenuhnya. Jangan menulis kode aplikasi dulu.
1. Buka dan baca README serta LICENSE untuk: remotion-dev/recorder, template Next.js dari create-video, dan Editor Starter (docs). Buat tabel perbandingan singkat berdasarkan apa yang benar-benar kamu baca, tandai mana yang belum bisa kamu verifikasi.
2. Berikan rekomendasi fork atau template untuk bagian 5 beserta alasannya.
3. Ajukan rencana struktur folder dan skema database berdasarkan bagian 6 dan 7.
4. Daftar pertanyaan terbuka dari bagian 14 yang harus saya jawab sebelum milestone 1.
Tunggu persetujuan saya sebelum mulai membangun.
```
