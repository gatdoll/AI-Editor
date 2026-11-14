# Fase 11: Video MOV, reduksi noise, hapus gerakan kamera

Permintaan pengguna (28 Okt 2026):
- Video MOV dari iPhone tampil kosong di pratinjau. Impor MOV harus bisa tampil, dan render tetap menghasilkan MP4.
- Fitur reduksi noise di workspace memakai [noisereduce](https://github.com/timsainb/noisereduce).
- Klip gerakan kamera bisa dihapus, supaya kamera hanya bergerak lewat perintah AI.

Status: **kode selesai dan diuji (28 Okt 2026).** Menunggu dua langkah pengguna:
- menjalankan migrasi `20261029090000_fase11_pratinjau_noise.sql`;
- memulai ulang aplikasi.

## Penyebab layar kosong
Video "Vid. 1 admin = 10 menit" adalah MOV iPhone dengan codec **HEVC (H.265)**. Chrome di Windows tidak bisa memutar HEVC, jadi gambar kosong. Video itu juga disimpan mendatar (1920×1080) dengan tanda rotasi −90°, sehingga tercatat landscape padahal tampil portrait.

## Yang dibuat
- **Salinan pratinjau**:
  - job `preview` membuat salinan H.264 di `projects/<id>/preview/<asset>.mp4` untuk codec yang tidak bisa diputar browser (`PREVIEW` di config: hanya H.264/VP8/VP9/AV1 8-bit 4:2:0 yang dianggap aman);
  - cap waktu dipertahankan (`-fps_mode passthrough`) dan rotasi diterapkan;
  - ingest mengantrekannya otomatis; project lama diantrekan editor saat dibuka;
  - rute `file?view=1` menyajikan salinan itu ke pemutar, sedangkan unduhan dan render tetap memakai file mentah (aturan 1);
  - MOV ber-H.264 disajikan sebagai `video/mp4`.
- **Rotasi**: `probe` membaca `side_data rotation`, jadi ukuran yang dicatat adalah ukuran yang tampil. Aset MOV yang sudah ada diperbaiki menjadi 1080×1920.
- **Reduksi noise**:
  - pengaturan "Kurangi noise" (`audio.kurangiNoise`, 0–1) ada di registri, sehingga muncul di panel Audio dan katalog AI mode Cepat;
  - job `denoise` menjalankan `apps/worker/py/denoise.py` (noisereduce 3.0.3, non-stasioner, venv `.cache/py-denoise` dari `npm run setup:denoise`);
  - setelah diproses, level bicara dikembalikan ke aslinya dengan penguatan maksimal 4× dan tanpa clipping;
  - satu file per langkah 0,05: `projects/<id>/audio/<asset>-nr<NN>.m4a`;
  - komposisi membisukan audio video dan memutar file ini dengan potongan frame yang sama;
  - render membuat file ini sendiri bila belum ada, dan gagal (bukan diam-diam memakai audio asli) bila proses gagal.
- **Hapus gerakan kamera**:
  - klik blok di track Kamera untuk memilih;
  - Delete pada gerakan otomatis membuat kamera **diam** di bagian itu (`style.cameraMuted`, waktu mentah); pada gerakan yang diminta, Delete membuang permintaannya;
  - "Hapus semua gerakan otomatis" (`kamera.otomatis` = false) membuat kamera diam di semua tempat, kecuali gerakan yang diminta lewat perintah;
  - `muteCameraMoves` dijalankan sesudah validasi. Bagian diam tidak pernah membuat lompatan atau tepi hitam. Deretan diam tepat sebelum gerakan yang diminta menahan posisi awal yang dibutuhkan gerakan itu (mis. pull-back).

## Uji
- `fase11.test.ts` + semua 16 berkas `npm test` lulus, typecheck bersih.
- Langsung pada MOV pengguna (122 dtk, HEVC):
  - salinan pratinjau dibuat dalam 36 dtk (77 MB, 1080×1920, durasi sama);
  - reduksi noise 75% selesai dalam 11 dtk. Bagian hening −44,7 → −49,8 dB, bicara −24,1 → −23,9 dB (sinyal terhadap noise naik sekitar 5 dB);
  - hash file mentah tidak berubah.
- Browser:
  - MOV pengguna tampil di pratinjau;
  - rute audio dan pratinjau menjawab 200/404 dengan benar;
  - hapus satu gerakan, lalu hapus semua otomatis (yang diminta tetap bergerak). Bug ditemukan dan diperbaiki: pull-back yang diminta sempat ikut diam;
  - project uji dikembalikan seperti semula.

## Catatan
- ffmpeg bawaan Remotion tidak punya encoder PCM float maupun muxer `.m4a`, jadi dipakai PCM 24-bit dan `-f mp4`.
- Render dengan audio hasil reduksi noise belum diuji sampai MP4 jadi (memori mesin, lihat catatan Fase 10).
