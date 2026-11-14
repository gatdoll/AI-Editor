# Fase 6: Pemolesan

Tujuan: aplikasi stabil dipakai pada video nyata.

Legenda: [x] selesai dan diuji · [~] kode ditulis, belum diuji penuh · [ ] belum

## Status dan error
- [x] Status per tahap di atas halaman project: unggah, periksa file, transkrip, analisis, render. Ikon, progres, lama proses ("selesai 26 dtk"), dan penanda "menunggu worker". API di baliknya teruji (job terbaru per jenis); **tampilan belum dilihat di browser**
- [x] Progres render (bar + persen) di status tahap dan di bagian Render MP4
- [x] Penjelas error (`packages/shared/src/errors.ts`): pesan ramah + saran + **detail teknis yang bisa dibuka/disalin**, pesan teknis penuh tetap di log worker. 31 tes lolos dengan pesan error nyata dari kode kita (13 jenis)
- [x] Deteksi batas pemakaian langganan Claude/Codex (celah dari Fase 3): diberi awalan `[BATAS_PEMAKAIAN]`, dan **tidak dicoba ulang** (mengulang hanya membuang kuota). **Teruji hanya terhadap contoh teks, belum terhadap batas sungguhan**
- [x] Tidak mengulang otomatis untuk error percuma: kuota, belum login, tanpa audio, file rusak, disk penuh, timeout
- [x] Coba ulang per tahap: ingest gagal -> ulang ingest; transkrip gagal -> ulang HANYA transkrip (teruji: tidak ada job ingest baru). Analisis dan render gagal tidak merusak project (status tetap `ready`), tombol di layar tinggal diklik lagi
- [x] Pengaman: transkrip yang sudah dikoreksi pengguna **tidak ditimpa** saat transkrip diulang (teruji 7/7)
- [~] Satu kegagalan render sesaat (folder sementara Windows) pernah terjadi, tidak bisa direproduksi; ada 1x coba ulang otomatis. Belum terbukti menanganinya. Pesan untuk kasus itu ("Gangguan sementara saat merender") sudah ada
- [ ] Jalur gagal LANGSUNG belum dipicu nyata untuk: ffprobe pada file rusak, disk penuh, Claude/Codex tidak login, render gagal. (Hanya teks error yang diuji, bukan kegagalan sungguhan)

## Keamanan dan integritas (`npm run audit`, 34/34 lolos)
- [x] **Aturan 6**: tidak ada variabel `NEXT_PUBLIC_` rahasia; kunci publik dan rahasia berjenis benar; berkas klien hanya mengimpor TIPE; **15 berkas bundel browser hasil build produksi dipindai: kunci rahasia dan namanya tidak ada**; 4 respons API tidak memuat kunci
- [x] **Aturan 1**: 52 berkas kode dipindai (semua hapus/ganti-nama/tulis hanya ke `.part`, cache, folder hasil); trigger database menolak ubah `storage_path`/`sha256`/`kind`/`storage_bucket` aset mentah (diuji langsung); **SHA-256 semua file mentah dihitung ulang = checksum database (5 file)**; semua file hanya-baca
- [x] **Aturan 2**: kata "approved" hanya di rute persetujuan/UI/tipe; worker tidak pernah menulisnya; 15 usulan approved semuanya melalui tindakan pengguna; EDL segmen valid
- [x] **Aturan 8**: audit menemukan pelanggaran NYATA (warna `#000`, dimensi 1080/1920, bobot font, offset bayangan, posisi gradient, ukuran font demo tertulis di komponen) -> dipindah ke `config/index.ts`. Kini 0 pelanggaran, maks 3 warna per gaya, maks 2 bobot font
- [x] Batas unggahan: ekstensi (.exe ditolak), ukuran 0/negatif, nama file 400 karakter, nama berbahaya (`../`), path di luar folder media (5 percobaan), **ruang disk dicek di awal** (file 5 PB ditolak 507 dengan pesan jelas). Audit menemukan `safeFileName("..")` mengembalikan `".."` -> diperbaiki
- [x] Audit mendeteksi build usang sendiri (terbukti: gagal bila kode lebih baru dari build)
- [ ] Tidak ada batas ukuran file maksimum (keputusan pengguna: hanya dibatasi disk)

## Uji 5 video nyata  **MENUNGGU VIDEO PENGGUNA**
Alat ukurnya sudah siap dan tervalidasi: `npm run eval -- <projectId> <labels.json>` (format di `eval/contoh-labels.json`).
Menilai tiap analisis sendiri (Claude vs Codex), melaporkan recall per jenis, presisi, galat batas, terlewat, positif palsu, dan **salah potong pada bagian "keep"** (pengulangan sengaja). Divalidasi pada kasus benar (100%) dan kasus yang sengaja salah (melaporkan terlewat dan pelanggaran). Catatan: n kecil tidak bermakna statistik.

Yang dibutuhkan dari pengguna per video: file video, dan daftar detik awal-akhir bagian yang seharusnya dipotong (serta bagian pengulangan sengaja yang harus dipertahankan).
- [ ] Video 1: ____
- [ ] Video 2: ____
- [ ] Video 3: ____
- [ ] Video 4: ____
- [ ] Video 5: ____
- [ ] Catat: temuan retake benar/salah, masalah transkrip, masalah render, waktu proses (waktu per tahap sudah tampil di layar)
- [ ] Tetapkan target akurasi berdasarkan hasil nyata (bagian 12). **Jangan menjanjikan angka sebelum ini.**

## Kualitas
- [x] Performa video panjang, terukur pada transkrip sintetis: 1 jam (9.000 kata, 300 potongan) EDL 20 ms, props komposisi 39 ms, 426 usulan 5 ms; **3 jam** (27.000 kata): 63 / 78 / 5 ms. Logika murni bukan hambatan
- [x] Perbaikan layar: detail project tidak lagi membawa daftar kata (462 KB untuk 1 jam, tadinya ikut di-polling tiap 2,5 dtk); kata diambil sekali lewat `/api/transcripts/[id]`; tampilan transkrip memakai pencarian biner + `memo` (tadinya semua ribuan kata dirender ulang 5x per detik); satu klik "Setuju" memperbarui satu baris (tadinya mengunduh ulang semua usulan). **Peningkatan ini belum diukur di browser**
- [x] Peluncur tanpa terminal: `Mulai Aplikasi.bat` -> `scripts/start-all.mjs` memeriksa Node, `.env`, kunci Supabase (jenis secret), tabel database, port; menyalakan web + worker; membuka browser; tidak menggandakan proses bila dijalankan dua kali. Teruji (menemukan bug path berspasi)
- [x] Dokumentasi: `README.md` (persiapan, cara pakai, aturan, **batasan jujur**, pemecahan masalah, perintah)
- [x] Regresi penuh pada kode akhir: alur unggah -> analisis kedua provider -> review -> EDL 27/27; render lewat antrean 15/15
- [ ] Perbaiki bug dari uji 5 video (menunggu uji)
- [ ] Panjang analisis video 1 jam (30 panggilan CLI, ~3,5 menit perkiraan) dan transkrip 1 jam: belum diukur
- [ ] Uji tampilan di browser (ekstensi Chrome tidak terhubung): status per tahap, kotak error, panel gaya, pratinjau Player, layar review

## Selesai jika
- Semua kriteria selesai MVP di bagian 12 brief terpenuhi pada 5 video nyata.
- **Status: BELUM.** Sisi teknis (error, status, audit, performa logika, peluncur, dokumentasi) selesai dan teruji. Kriteria 2 (deteksi retake pada video berlabel), 4 (subtitle sinkron pada video nyata), dan "video 5 menit tanpa terminal" belum bisa dinyatakan terpenuhi tanpa video Anda.
