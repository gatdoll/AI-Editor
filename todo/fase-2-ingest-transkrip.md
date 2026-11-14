# Fase 2: Ingest dan Transkrip

Tujuan: upload video, simpan, transkrip dengan timestamp per kata, tampil di UI.

## Database dan storage
- [x] Setup Supabase: koneksi dari server terbukti (env terbaca, PostgREST menjawab)
- [ ] Migrasi: `projects`, `assets`, `transcripts`, `jobs` , **ditulis di `supabase/migrations/20261027120000_fase2_ingest_transkrip.sql`, MENUNGGU dijalankan pengguna di SQL Editor**
- [x] KEPUTUSAN: video disimpan di disk lokal (`data/media/`, atau env MEDIA_DIR), bukan Supabase Storage (batas 50 MB). Supabase hanya untuk data. Berlaku saat jalan lokal; untuk VPS nanti pakai volume bersama web + worker
- [x] Kebijakan: trigger `assets_protect_raw` menolak perubahan path/jenis/checksum aset mentah; API menolak upload kedua ke project yang sama (belum teruji karena migrasi belum jalan)

## Upload
- [x] Halaman daftar project + buat project baru (kode ditulis, typecheck lolos; belum teruji end-to-end)
- [x] Form upload video: per potongan 8 MB ke disk lokal, progress bar, validasi format, bisa dilanjutkan jika putus, file dikunci hanya-baca setelah selesai (TERUJI via API: 22/22 pemeriksaan lolos)
- [x] Simpan file mentah ke storage, catat di `assets` (jenis raw) , kode ditulis, belum teruji
- [x] Ekstrak metadata dengan ffprobe: durasi, resolusi, fps , TERUJI pada video 20 detik via smoke test
- [x] Ekstrak audio mono 16 kHz untuk Whisper , TERUJI via smoke test. Audio hanya file sementara di cache worker, tidak disimpan sebagai aset `audio`

## Transkrip
- [x] Putuskan: Whisper.cpp lokal (tanpa API key, konsisten dengan keputusan CLI). Model dan bahasa lewat WHISPER_MODEL / WHISPER_LANGUAGE; akurasi ID-EN belum diukur
- [x] Implementasi transkrip dengan timestamp per kata + confidence , TERUJI (whisper.cpp 1.5.5, model small): video 20 dtk -> 37 kata benar. Catatan: beberapa kata berdurasi ~0 dtk (mis. 9.60-9.60) dan ada kata sisa di ujung ("ring.", confidence 0,42); perlu dirapikan sebelum dipakai untuk presisi cut di Fase 3
- [x] Jalankan sebagai job asinkron dengan status (tabel `jobs`, `claim_next_job` dengan SKIP LOCKED, pemulihan job tertinggal) , belum teruji
- [x] Simpan ke `transcripts.words` (kode ditulis, belum teruji)
- [x] Tampilkan transkrip di UI, klik kata untuk lompat ke waktu di pemutar (kode ditulis, belum dilihat di browser)
- [x] Fitur koreksi transkrip: klik dua kali pada kata; hasil mesin disimpan di `original_words`; kata ber-confidence rendah digarisbawahi (belum teruji)

## Uji
- [ ] Video 5 menit terproses tanpa terminal (belum; sekarang worker masih dinyalakan manual dengan `npm run worker`)
- [x] Verifikasi checksum file mentah tidak berubah setelah proses (sha256 di DB = file asli; file di disk identik byte-per-byte dan hanya-baca)

## Selesai jika
- User upload video dari browser dan melihat transkrip per kata yang bisa dikoreksi.

## Catatan teknis dan pekerjaan yang tersisa
- [ ] Jalankan migrasi SQL (pengguna)
- [ ] Pasang Visual C++ Redistributable x64 di mesin dev Windows, lalu ulangi `npm run smoke -w @app/worker -- <video>`
- [x] Uji end-to-end via API: upload 3 potongan 25 MB + putus-sambung -> ingest -> transkrip -> koreksi -> Range (22/22 lolos, ~26 dtk untuk video 20 dtk). Bagian "tampil di UI" belum dilihat
- [ ] Uji unggah file multi-GB dan putus-sambung di browser sungguhan
- [ ] Transkrip video 1 jam: ukur waktu (rtf) di VPS, tentukan model; pecah per potongan jika perlu
- [ ] Dockerfile worker (node:22-bookworm-slim, build-essential untuk whisper.cpp, ffmpeg, libs Chrome) , dikerjakan bersama Fase 4
- [ ] Verifikasi SHA-256 file mentah tidak berubah setelah semua proses
- [x] `.env` diperbaiki: SUPABASE_SERVICE_ROLE_KEY kini secret key
- [x] Migrasi SQL sudah dijalankan; Visual C++ Redistributable sudah terpasang
- [ ] Rapikan timestamp kata Whisper (kata berdurasi 0, kata sisa confidence rendah) , ukur pada video nyata
- [ ] Lihat tampilan UI di browser (belum dilihat: ekstensi Chrome tidak terhubung; hanya dicek HTTP 200 dan log tanpa error)
