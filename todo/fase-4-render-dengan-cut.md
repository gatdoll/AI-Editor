# Fase 4: Render dengan Cut

Tujuan: EDL diterapkan ke Remotion, preview dan render MP4. Hosting render diputuskan di sini.

Legenda: [x] selesai dan diuji · [~] kode ditulis, belum diuji penuh · [ ] belum

## Komposisi dari EDL
- [x] Komposisi `Edited` membaca EDL (segmen yang dipertahankan) sebagai satu-satunya sumber; `OffthreadVideo` dengan `trimBefore/trimAfter` per segmen
- [x] Durasi total dihitung ulang dari EDL lewat `calculateMetadata`; rumus frame dipakai bersama (`packages/remotion/src/frames.ts`)
- [x] Ukuran dan fps mengikuti file sumber
- [x] Fade audio 2 frame di sambungan (bukan di tepi file) agar tidak klik. Kasus tepi ditemukan lewat uji: segmen 4 frame membuat rentang fade tidak valid -> diperbaiki
- [x] Padding 0,1 dtk di sambungan (aturan 5) DIBATASI jarak aman ke kata yang dipotong, supaya tidak membawa serpihan kata. Ditemukan lewat uji: versi pertama menyisakan "Hello," dari retake. Teruji unit (11/11) dan lewat transkrip ulang hasil render
- [x] Potongan yang memuat kata pertama/terakhir video diperluas ke tepi file
- [x] Preview di browser: pemutar melompati bagian yang disetujui + "Putar hasil setelah dipotong" (layar review; tampilan belum dilihat)
- [ ] Preview dengan Remotion Player (komposisi `Edited` di browser). Saat ini preview memakai elemen video biasa yang melompat

## Hosting render (keputusan)
- [x] KEPUTUSAN: render di komputer ini dulu (worker lokal, `@remotion/renderer`). Sesuai keputusan "jalan lokal dulu"
- [ ] VPS Coolify: butuh Docker (`node:22-bookworm-slim`, library Chrome, build-essential untuk whisper.cpp, ffmpeg). Docker TIDAK ada di mesin ini, jadi Dockerfile tidak bisa diuji di sini. Dikerjakan saat pindah ke VPS
- [x] Server HTTP lokal baca-saja (127.0.0.1, port acak) menyajikan file mentah ke Remotion dengan Range; file mentah tidak disalin
- [x] Kecepatan terukur: video 28 dtk (834 frame) 1080p30 dirender 45 dtk di i5-10400 (~1,6x durasi). **Ekstrapolasi, belum diukur:** video 1 jam bisa makan ~1,5 jam. Perlu diukur pada video panjang sebelum dipercaya
- [ ] Hitung biaya/waktu render di VPS (butuh spesifikasi VPS)

## Render job
- [x] Migrasi `20261027180000_fase4_render.sql` (`assets.edl_id`) sudah dijalankan
- [x] API `POST /api/projects/[id]/render`: teruji, dua permintaan bersamaan = satu 201 + satu 409; project tanpa EDL/video ditolak
- [x] Worker `handleRender`: teruji lewat antrean; hasil tercatat sebagai aset `output` yang menunjuk EDL; tidak ada `.part` tersisa
- [~] Render gagal tidak mengubah status project (kode ada; jalur gagal belum dipicu di uji; status tetap 'ready' pada jalur sukses)
- [~] Layar: tombol render, progres, peringatan "EDL usang", daftar hasil dengan Putar dan Unduh. API di baliknya teruji (progres, unduh, Range); TAMPILAN belum dilihat
- [x] Render langsung (tanpa antrean) teruji lewat `npm run render-smoke`
- [x] Render lewat antrean + API teruji 15/15 (render ulang menghasilkan hasil kedua, hasil lama tidak ditimpa). Tombol di layar belum diklik siapa pun

## Uji
- [x] Durasi hasil sesuai EDL: 27,82 dtk vs harapan 27,80
- [x] Resolusi/fps/codec: 1920x1080, 30 fps, H.264 + audio
- [x] Isi benar: transkrip ulang hasil menunjukkan retake dan filler yang disetujui hilang, bagian yang TIDAK disetujui tetap ada
- [x] File mentah utuh setelah render (sha256 sama dengan checksum di DB)
- [~] Sinkron audio-video: durasi aliran video 27,800 vs audio 27,819 dtk (selisih 19 ms, normal). Sinkron di sambungan dengan telinga/mata BELUM diperiksa, dan video uji berupa animasi berulang sehingga gambar tidak bisa dibandingkan dengan ucapan
- [ ] Uji video sumber nyata (bukan video sintetis), bahasa Indonesia, durasi menit-an

## Selesai jika
- Dari EDL yang disetujui, pengguna bisa preview dan mengunduh MP4 yang sudah ter-cut.
- Status: jalur API selesai dan teruji; tinggal dicoba pengguna dari layar dengan video nyata.
