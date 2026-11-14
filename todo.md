# Todo: Aplikasi Editor Video Remotion + Claude

Sumber: [brief.md](brief.md). Satu file per fase, urut sesuai milestone bagian 11.

| Fase | File | Hasil |
|---|---|---|
| 1 | [Fondasi](todo/fase-1-fondasi.md) | Aplikasi jalan lokal, template diputuskan |
| 2 | [Ingest dan Transkrip](todo/fase-2-ingest-transkrip.md) | Upload + transkrip per kata di UI |
| 3 | [Deteksi Cut dan Review](todo/fase-3-deteksi-cut-review.md) | Usulan cut, review, EDL tersimpan |
| 4 | [Render dengan Cut](todo/fase-4-render-dengan-cut.md) | MP4 ter-cut, hosting render diputuskan |
| 5 | [Kamera dan Subtitle](todo/fase-5-kamera-subtitle.md) | Gerakan kamera + subtitle per kata |
| 6 | [Pemolesan](todo/fase-6-pemolesan.md) | Stabil di 5 video nyata |
| 7 | [Komersialisasi](todo/fase-7-komersialisasi.md) | Opsional: login, kuota, bayar |
| 8 | [Editor ala CapCut + prompt](todo/fase-8-editor-prompt.md) | Permintaan baru: timeline, edit lewat prompt |
| 9 | [Mode Kreatif](todo/fase-9-mode-kreatif.md) | AI menulis kode Remotion memakai skill repo (9.1–9.4 selesai, 9.5 uji belum) |
| 10 | [Timeline seperti CapCut](todo/fase-10-timeline-capcut.md) | Trim, hapus, perpanjang ke bagian terpotong untuk klip video, subtitle, dan lapisan kreatif; rasio 4:5 (selesai; render MP4 penuh belum terbukti karena memori) |
| 11 | [MOV, reduksi noise, hapus kamera](todo/fase-11-mov-noise-kamera.md) | Salinan pratinjau untuk MOV/HEVC, Kurangi noise (noisereduce), hapus gerakan kamera (kode selesai, migrasi belum dijalankan) |
| 12 | [Semua proses di workspace](todo/fase-12-alur-workspace.md) | Upload tanpa proses di depan; auto cut, auto subtitle, noise, edit AI semua di workspace (kode selesai; uji browser menunggu worker dimulai ulang) |
| 13 | [Motion graphics berdiri sendiri](todo/fase-13-motion-graphics.md) | AI menulis animasi dari brief + logo/gambar/musik/data, ekspor MP4 atau sisipkan sebagai intro/outro/B-roll (13.1–13.2 selesai di kode; menunggu migrasi + uji nyata; 13.3 sisipan belum) |
| 14 | [SFX dari prompt kreatif](todo/fase-14-sfx.md) | AI menaruh SFX (paket CC0 bawaan + unggahan sendiri) lewat daftar isyarat, diputar komposisi, bisa diedit di timeline, juga dari perintah Mode Cepat (selesai, menunggu uji pengguna) |
| 15 | [Gambar branding di prompt Kreatif](todo/fase-15-branding.md) | Lampirkan logo/gambar JPG/PNG di kotak prompt Kreatif (video dan motion); logo dipakai apa adanya, tidak digambar ulang (selesai, menunggu uji pengguna) |
| 16 | [Banyak video dalam satu project](todo/fase-16-multi-video.md) | Unggah beberapa video per project, panel Media dengan thumbnail, seret blok video di timeline untuk mengatur urutan (selesai: tes otomatis + uji nyata 3 video + MP4; tinggal cek tampilan di browser) |
| 17 | [Voice over dari naskah](todo/fase-17-voiceover.md) | Rekam suara sendiri, naskah pengguna, arahan Codex CLI, suara kloning VoxCPM2 lokal, waktu kata Whisper; motion Claude Code mengikuti narasi (kode selesai, menunggu uji pengguna) |
| 18 | [Klip motion di akhir video](todo/fase-18-klip-akhir.md) | Tambah klip CTA di akhir video: durasi dipilih, isi dari prompt (kode selesai, menunggu uji pengguna) |
| 19 | [Opinion Motion](todo/fase-19-opinion-motion.md) | Kategori ke-4: motion + aset internet (foto tokoh saat disebut, screenshot artikel berita), riset aset oleh AI, dipilih pengguna dulu (kode selesai; menunggu migrasi + uji browser) |
| 20 | [Desain ulang Mantiq Editor](todo/fase-20-redesign-mantiq.md) | Terapkan desain Claude Design (tema gelap Mantiq, header + status sistem, semua layar) tanpa mengubah logika (rencana, menunggu persetujuan) |
| 21 | [Aset sendiri di video bicara](todo/fase-21-aset-sendiri.md) | Unggah aset + keterangan; AI mencocokkan keterangan dengan transkrip dan mengusulkan waktu muncul; disetujui pengguna lalu dipakai Mode Kreatif (kode selesai, tanpa migrasi; menunggu restart worker + uji browser) |
| 22 | [Referensi gaya untuk Kreatif/motion](todo/fase-22-referensi-kreatif.md) | Video referensi (unggah atau link YouTube/Instagram/TikTok) di Video, Klip akhir, Motion, Animasi, Opinion Motion; AI melihat sampel frame dan menulis analisis gaya dulu (kode selesai, menunggu restart worker + uji browser) |
| 23 | [Safe area Reels/TikTok](todo/fase-23-safe-area.md) | Satu konstanta safe area: subtitle, judul, kode AI (`data.safeArea`, wajib di 9:16), garis bantu pratinjau (kode selesai, menunggu restart worker + uji versi baru) |
| 24 | [Talent, blur wajah, font referensi](todo/fase-24-talent-font.md) | Teks di belakang talent (matte RVM, CPU), blur wajah + teks di depan wajah (YuNet), pustaka 52 Google Fonts + unggah font; AI meniru font referensi (kode selesai, menunggu restart worker + revisi nyata) |

Pendukung: [Pertanyaan terbuka](todo/pertanyaan-terbuka.md)

## Aturan yang berlaku di semua fase (bagian 8)
1. File mentah tidak pernah diubah; edit non-destruktif lewat EDL.
2. Tidak ada cut otomatis tanpa persetujuan pengguna.
3. Retake: default pertahankan take terakhir, tampilkan alasan.
4. Subtitle di layer terpisah di atas kamera.
5. Padding 0,1 detik di tiap sambungan cut.
6. Kunci API tidak pernah dikirim ke browser.
7. Yang tidak bisa dinilai ditandai tidak bisa dinilai, bukan ditebak.
8. Semua konstanta gaya di satu file config.

## Status
- [x] Fase 1: fondasi
- [x] Fase 2: ingest dan transkrip
- [x] Fase 3: deteksi cut dan review (kedua provider)
- [x] Fase 4: render dengan cut
- [x] Fase 5: kamera dan subtitle
- [~] Fase 6: pemolesan. Sisi teknis selesai dan teruji; **uji 5 video nyata menunggu video pengguna** (alat ukur siap: `npm run eval`)
- [ ] Fase 7 (opsional)
- [~] Fase 8: editor ala CapCut + edit lewat prompt (sedang dikerjakan)

Semua fase di atas hanya teruji pada video buatan. Lihat "Batasan" di [README.md](README.md).
