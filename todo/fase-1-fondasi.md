# Fase 1: Fondasi

Tujuan: aplikasi jalan lokal, satu video contoh dirender dari kode. Keputusan template diambil di sini.

## Riset dan keputusan (belum menulis kode aplikasi)
Hasil: [docs/fase-1-riset.md](../docs/fase-1-riset.md)
- [x] Baca README + LICENSE `remotion-dev/recorder` (README terbaca; LICENSE.md path main 404)
- [x] Baca README + LICENSE template Next.js (`create-video --next`) , **temuan: repo discontinued/diarsipkan**
- [x] Baca dokumentasi + lisensi Editor Starter ($600, tidak boleh ditanam di produk mandiri yang dijual)
- [x] Buat tabel perbandingan A/B/C dari yang benar-benar dibaca; tandai yang belum terverifikasi
- [x] Rekomendasi fork/template + alasan (revisi: template Next.js terbaru dari remotion.dev/templates, bukan repo arsip; A referensi Whisper)
- [x] Verifikasi kandidat pengganti: template Next.js = Lambda (tidak cocok VPS); Render Server belum jelas. Usulan: tanpa template, web + render-worker (docs/fase-1-riset.md bagian 3b)
- [x] Usulan struktur folder
- [x] Usulan skema database (bagian 7 brief)
- [x] Jawab pertanyaan terbuka bagian 14 yang memblokir fase ini (1, 2, 3, 6 terjawab; lihat `pertanyaan-terbuka.md`)
- [x] **Persetujuan pengguna** atas keputusan template (disetujui: tanpa template, web + render-worker)

## Setup
- [x] Inisialisasi monorepo npm workspaces (apps/web, apps/worker, packages/remotion, config)
- [x] Pasang dependensi Remotion (semua 4.0.539, exact) (`remotion`, `@remotion/player`, `@remotion/renderer`, `@remotion/captions`)
- [x] Chrome ada (+ Chrome Headless Shell diunduh Remotion). ffmpeg sistem BELUM terpasang: render memakai ffmpeg bawaan Remotion; pasang ffmpeg sistem sebelum Fase 2 (ffprobe) / Fase 3 (silencedetect)
- [x] Buat file config gaya tunggal (config/style.ts, config/analysis.ts) (warna, font, durasi, easing), aturan 8
- [x] `.env.example` dan `.env` masuk `.gitignore` (aturan 6)
- [x] Inisialisasi git (belum ada commit)
- [x] Buat CLAUDE.md proyek berisi aturan tak boleh dilanggar (bagian 8)

## Bukti jalan
- [x] `npm run dev` menampilkan aplikasi (HTTP 200, teks halaman terverifikasi via curl; belum dilihat di browser)
- [x] Satu komposisi contoh dipasang di Remotion Player (apps/web/app/page.tsx; tampilan visual belum dilihat)
- [x] Satu video contoh dirender ke MP4 dari kode (`npm run render:sample` -> out/sample.mp4, H.264 1920x1080 30fps 3,0 s, diverifikasi ffprobe)

## Selesai jika
- Aplikasi jalan lokal, MP4 contoh bisa diputar, keputusan template tercatat beserta alasan.
