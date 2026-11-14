# Fase 16: banyak video dalam satu project (seperti CapCut)

Permintaan pengguna (30 Okt 2026): satu project bisa berisi beberapa video (take cut-to-cut), ada panel Media dengan thumbnail, dan klip bisa diseret di timeline untuk mengatur urutan.

Status: **selesai di sisi data, worker, dan render (31 Okt 2026): migrasi sudah jalan, tes otomatis lolos, uji nyata 3 video + ekspor MP4 lolos. Tersisa: cek tampilan panel Media dan seret blok di browser.**

Pilihan pengguna:
- Urutan digeser **per video** (1 file = 1 blok). Split/trim/hapus tetap bisa; potongan hasil split tetap berurutan di dalam videonya.
- Video beda ukuran/orientasi: **isi penuh, potong tepi** (seperti sekarang), titik fokus per video.
- Unggah: **saat membuat project (banyak file sekaligus) dan dari panel Media di workspace**.

## Masalah inti
Sekarang 1 project = 1 video mentah, dan semua data memakai "waktu video mentah": kata transkrip, usulan cut, cut manual, split,
subtitle, judul, kamera, SFX, rentang Mode Kreatif, noise, waveform. Asumsi ini ada di sekitar 20 file.

## Desain: rangkaian sumber (reel)
- Semua video project disusun menjadi satu **sumbu waktu sumber** (reel): video ke-n mulai di `offset_s` = jumlah durasi video sebelumnya
  **menurut urutan unggah**. Offset ini **tidak pernah berubah** (video baru selalu ditambahkan di ujung), jadi semua data lama tetap benar
  tanpa dihitung ulang. File mentah tetap tidak diubah (aturan 1).
- **Urutan tampil** di hasil video terpisah dari reel: `style.reelOrder` (daftar id video). Menggeser blok video di timeline hanya mengubah
  daftar ini (ikut undo/redo). EDL menyusun segmen per video sesuai urutan itu; di dalam satu video tetap urut waktu.
- Hapus video dari timeline = seluruh rentangnya dipotong (bisa dipulihkan, seperti cut). Hapus dari panel Media = file bahan dihapus
  (dengan konfirmasi), dan rentangnya tidak pernah tampil lagi.
- Pemetaan waktu (sumber -> hasil -> sumber) diubah agar tidak lagi menganggap segmen selalu urut naik di waktu sumber. Ini perubahan
  terpenting; semua fitur (cut, subtitle, kamera, judul, SFX, Mode Kreatif) memakai fungsi pemetaan yang sama, jadi ikut benar.
- Komposisi Edited: tiap segmen memutar **file videonya sendiri** (src, waktu lokal = waktu reel - offset); segmen yang melintasi batas
  dua video dipecah otomatis. Ukuran beda: isi penuh + potong tepi, titik fokus per video.
- Transkrip, Auto cut, Auto subtitle, reduksi noise, waveform: diproses **per video**, lalu digabung ke waktu reel (kata dari video ke-n
  digeser `offset_s`). Video baru cukup diproses sendiri; yang lama tidak diulang.
- Render: worker menyajikan semua file lewat server lokal (pola Fase 13-15). Noise: audio hasil noisereduce per video.

## Data (migrasi kecil)
- `assets`: kolom `reel_offset_s` (numeric) dan `reel_index` (integer) untuk aset `raw`. Project lama: 1 video, offset 0. Indeks unik per project.
- `transcripts` tetap per aset; penggabungan ke waktu reel dilakukan kode.
- `style.reelOrder?: string[]`, `style.focusBy?: Record<assetId, number>`.

## Tampilan
- Membuat project: pilih banyak file sekaligus (urutan = urutan nama file, bisa diubah di workspace).
- Panel **Media** di workspace (tab baru di panel kiri): thumbnail tiap video, durasi, status (proses/siap), tombol ＋ Unggah,
  seret thumbnail ke timeline untuk menaruhnya di posisi tertentu, hapus.
- Timeline track Video: blok per video berwarna/berlabel nama file; seret blok untuk mengubah urutan; split/trim/hapus seperti sekarang.
- Kartu project di beranda: jumlah video.

## Langkah
- 16.1 Data + pemetaan reel: migrasi, offset, `style.reelOrder`, fungsi pemetaan waktu tanpa asumsi urut naik, EDL per video. Tes besar di sini.
- 16.2 Komposisi + render: segmen per file, pemecahan di batas video, fokus per video, server lokal multi-file, noise per video.
- 16.3 Unggah banyak file (buat project + panel Media), ingest/pratinjau/waveform per video.
- 16.4 Transkrip/Auto cut/Auto subtitle per video digabung ke waktu reel; perintah AI dan Mode Kreatif memakai data gabungan.
- 16.5 Timeline: blok per video, seret untuk mengubah urutan, seret dari Media ke timeline.
- 16.6 Uji: tes otomatis (pemetaan, EDL urutan, pemecahan batas, data lama tetap) + uji nyata 3 video beda orientasi + ekspor MP4.

## Hasil (31 Okt 2026)
- [x] 16.1 Reel: `packages/shared/src/reel.ts` (offset tetap + jarak `VIDEO.reelGapSec`, `style.reelOrder`, `style.reelHidden`,
      `style.focusBy`), `reel-db.ts` (`loadReel`), EDL tersusun per video di `edl-save.ts`. Transkrip project tetap satu, milik
      video UTAMA (yang pertama diunggah), dalam waktu reel. Indeks unik `reel_index` dari rencana tidak dipakai: posisi cukup dari offset.
- [x] 16.2 Komposisi: tiap segmen memutar file videonya sendiri (`props.sources`), fokus per video, render menyajikan semua file
      lewat server lokal, audio noise per video (`reel-media.ts`).
- [x] 16.3 Unggah banyak file (buat project + panel Media), ingest per video, satu job aktif per video (indeks baru di migrasi).
- [x] 16.4 Transkrip, jeda Auto cut, transkrip ulang per video lalu digabung ke waktu reel (`transcribeReel`, `reelSilences`).
- [x] 16.5 Timeline: blok per video, seret untuk mengubah urutan, panel Media.
- [~] 16.6 Tes otomatis `apps/worker/test/fase16.test.ts` (masuk `npm test`): sumbu reel, urutan tampil, video tersembunyi,
      pemetaan bolak-balik dengan urutan dibalik, kata lintas video, sumber + fokus per video, project satu video identik,
      rentang lokal worker. Perbaikan dari tes: `mapSpanToOutput` memakai bagian bersambung terpanjang bila urutan video diubah
      (sebelumnya rentang lintas video bisa membentang di atas seluruh hasil).
- [x] Uji nyata (31 Okt, lewat API yang sama dengan UI, project "Uji Fase 16: 3 video beda orientasi"): 3 video berbicara
      1280x720 (9 s), 720x1280 (7,7 s), 720x900 (6,4 s) diunggah berurutan -> offset reel 0 / 10 / 18,75 (jarak 1 s).
      Transkrip per video: kata tiap video jatuh di rentangnya sendiri, 0 kata di lubang. Urutan diubah ke tegak, mendatar,
      4:5 + fokus 0,3 untuk video mendatar -> EDL [10–17,75] [0–9] [18,75–25,14], keptS 23,14, removedS 0. Render 9:16:
      1080x1920, 23,15 s, ada audio; bingkai di 3 s / 12 s / 20 s menampilkan video yang benar, isi penuh + potong tepi,
      fokus kiri di video mendatar, subtitle dari video yang sedang tampil.
- [ ] Cek tampilan di browser: panel Media (thumbnail, durasi, unggah), blok video di timeline, seret untuk mengubah urutan.
      Potret layar headless tidak bisa dipakai: `next dev` memuat ulang halaman editor terus-menerus di Chrome headless (juga
      untuk project lama, jadi bukan dari Fase 16).

## Risiko
- Paling berisiko: pemetaan waktu yang selama ini mengandalkan urutan naik. Dijaga dengan tes yang membandingkan project 1 video
  sebelum/sesudah (hasil harus identik).
- Pekerjaan besar (perkiraan setara 2-3 fase sebelumnya). Project lama tetap jalan tanpa diubah.
- Pindah potongan hasil split ke luar videonya (CapCut penuh) tidak termasuk; bisa jadi fase lanjutan.
