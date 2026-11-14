# Editing manual + AI

Buka project → Editor → **Manual**. Prompt, referensi video, subtitle, usulan cut, dan ekspor tetap tersedia dalam project yang sama.

## Kontrol yang tersedia

- **Klip:** pilih bagian video pada timeline, `S` untuk split pada playhead, `Delete` untuk menghapus klip terpilih. Trim dengan menarik tepi atau mengisi In/Out. Cut manual langsung diterapkan karena tindakan pengguna sendiri; usulan AI tetap membutuhkan persetujuan.
- **Pulihkan:** daftar bagian yang dihapus manual bisa dikembalikan satu per satu. Gabungkan batas split menghapus pemisah tanpa mengembalikan cut.
- **Undo/redo:** tombol atas, `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y`. Riwayat berlaku selama sesi halaman. Edit tersimpan tetap ada setelah reload, tetapi riwayat undo sesi tidak disimpan lintas reload. Hasil AI punya tombol pembatalannya sendiri.
- **Teks:** tambah, edit, duplikat, hapus judul; pilih animasi kinetik / blur-slide dan posisi. Geser judul di jalur Teks, atau tarik tepinya. Judul bertumpuk memakai lajur terpisah.
- **Gambar:** skala, posisi X/Y, rotasi, opacity, flip horizontal/vertikal, kecerahan, kontras, saturasi. Berlaku pada seluruh video sumber.
- **Keyframe:** atur transform lalu simpan di playhead. Dua keyframe atau lebih menghasilkan interpolasi smoothstep. Waktu keyframe memakai waktu sumber; cut tidak menggeser targetnya. Keyframe menimpa transform statis. Kamera AI dapat dimatikan jika hanya ingin gerakan dari keyframe.
- **Audio:** volume, mute, fade-in/fade-out pada awal/akhir hasil. Berlaku pada audio video sumber.
- **Kamera:** tambah preset gerakan di playhead, hapus arahan individual, dan atur kamera/motion yang sama dengan prompt AI.
- **Navigasi:** Space untuk putar/jeda, panah kiri/kanan untuk satu frame, Ctrl+scroll untuk zoom timeline. Drag menempel ke frame/batas; tahan Alt untuk menonaktifkan snap ke batas lain.
- **Playhead:** tarik garis penunjuk waktu atau drag penggaris untuk scrubbing langsung. Preview mengikuti kursor; playback dijeda saat mulai drag. Saat timeline di-zoom, menarik ke tepi otomatis menggulir timeline. Playhead juga mendukung Home/End dan Shift+panah (10 frame). Scrubbing tidak mengubah klip atau keputusan edit.

Timeline menunjukkan **waktu sumber** sehingga keputusan cut AI, judul dan transkrip tetap cocok dengan rekaman. Preview dan ekspor merapatkan bagian yang dihapus. Split saja tidak mengubah durasi, subtitle, judul, rencana kamera, atau fade audio.

## Penyimpanan dan koeksistensi AI

Edit manual disimpan di `projects.style.manual`, tanpa migrasi database. Cut dan split masuk ke EDL melalui fungsi bersama `applyManualEdl`, dipakai browser dan `saveEdlFromApproved` (API maupun worker). Transform/audio masuk registri parameter sehingga bisa diatur manual maupun melalui prompt. `buildEditedProps` dipakai preview dan renderer.

Penyimpanan dilakukan berurutan, dengan pemeriksaan versi gaya sebelum menulis. Konflik atau kegagalan ditampilkan; ekspor/prompt menunggu edit tersimpan. Manual dinonaktifkan selama prompt AI berjalan. Worker juga memakai pemeriksaan gaya saat menulis agar tidak menimpa perubahan dari proses/tab lain. Saat hasil AI masuk, riwayat undo manual lama direset agar tidak membatalkan hasil baru secara tak sengaja.

File mentah, persetujuan cut AI, dan timestamp transkrip tidak dimodifikasi oleh split/trim/transform manual. Subtitle tetap di layer terpisah dari kamera dan transform video.

## Referensi Concat

Sumber: [jub0t/Concat](https://github.com/jub0t/Concat), commit yang diperiksa `3d549940ab79c7b65cc534efdd245ddd4f98e2c4`, checkout lokal `.cache/concat`.

Dibaca: README, LICENSE, `docs/MCP.md`, `src/crates/concat-project/src/commands/mod.rs`, model project dan clip. Pola yang diadaptasi secara mandiri: edit non-destruktif, trim edge, split, undo, keyframe transform dan audio controls. Kode Rust/Slint tidak disalin atau ditautkan ke bundle web. Lisensi repo upstream adalah AGPL-3.0-or-later (per header sumber); file LICENSE tetap di checkout upstream.

Concat adalah editor desktop dengan engine Rust, sedangkan aplikasi ini memakai Next.js/Remotion. Ini bukan fork Concat, tidak memasang binary desktop, tidak membuat koneksi MCP Concat, dan belum menyediakan impor/ekspor project Concat. AI existing tetap memakai worker aplikasi ini.

## Batas saat ini

Ini editing manual untuk **satu video sumber**, judul, subtitle, kamera, dan efek yang sudah ada. Belum setara seluruh CapCut/Concat: belum ada susunan beberapa file video/audio bebas, B-roll/PiP, speed ramp, transisi antar media, masking/background removal, atau curve editor Bezier. Kontrol gambar/audio berlaku global, bukan per klip. Trim ke luar batas klip menggunakan Pulihkan/Undo dahulu.

## Verifikasi

### Pemulihan preview dan drag playhead

Playhead bergerak mengikuti pointer setiap frame, sedangkan seek video selama drag dibatasi 10 kali/detik. Saat dilepas, posisi akhir dikirim langsung. Stream aset memakai antrean berbasis byte, membatalkan pembacaan ketika request dibatalkan, mendukung HEAD, ETag/If-Range, dan menolak range yang tidak valid.

Kegagalan media di preview menjeda pemutar dan menampilkan **Muat ulang preview**. Tombol ini membuat ulang decoder dengan URL baru pada frame yang sama; tidak menyimpan perubahan gaya/EDL. Handler hanya diberikan oleh editor: kegagalan media saat render tetap menghentikan render.

- `media-response.test.ts`: byte range awal/tengah/akhir, suffix/open-ended, HEAD, validator cache, range tidak valid, antrean baca terbatas, dan pembatalan stream.
- Browser: video H.264/AAC 1080×1920, 91.835 detik, 122.9 MB; drag awal→88 detik→15 detik dan playback sesudahnya tanpa error.
- Simulasi respons video rusak pada tab uji: pesan pemulihan muncul, retry kembali ke detik 20 dengan `readyState=4` dan `video.error=null`, lalu playback berjalan. Injeksi respons uji dihapus setelah pemeriksaan.
- Error seek asli bersifat intermiten dan belum berhasil direproduksi. Pembacaan range HTTP cocok dengan byte di disk; perbaikan membatasi beban seek/buffer dan menyediakan pemulihan, bukan menganggap file mentah rusak.

- `npm test` termasuk `manual.test.ts`: komposisi cut AI + manual, overlap, split tanpa kehilangan frame, keyframe, judul lintas cut, parameter render dan preservasi manual oleh operasi AI.
- `node apps/worker/test/manual-api.e2e.mjs <UUID-project-uji>`: simpan/reload, tolak penulis usang, validasi waktu, EDL bersama, keputusan AI tidak berubah. Hanya gunakan project uji; tes mengembalikan gaya awal melalui pemeriksaan versi.
- Browser: split, trim angka, drag trim, undo/redo, tambah/edit/drag judul, dua keyframe, volume dan fade audio. Tes menggunakan project sintetis, bukan rekaman pengguna.
- Uji gabungan langsung: prompt Codex mengubah `audio.volume` dari 0.7 menjadi 0.8; seluruh cut manual, split, keyframe, judul, dan pengaturan lainnya dibandingkan sebelum/sesudah dan tetap identik. UI audio memperlihatkan 0.8 setelah hasil prompt selesai. Reload mempertahankan edit tersimpan.
- Typecheck seluruh workspace, build produksi, semua suite tes, dan audit 37/37 lolos.
