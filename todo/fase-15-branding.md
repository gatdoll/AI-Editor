# Fase 15: gambar branding (logo) di prompt Kreatif

Permintaan pengguna (30 Okt 2026): di prompt Kreatif bisa melampirkan foto JPG/PNG, terutama logo, karena hasil prompt sudah bagus tetapi logonya salah (AI menggambar ulang logo).

Status: **selesai (30 Okt 2026)**, menunggu uji pengguna.

## Kondisi sekarang
- Project **motion**: bahan gambar sudah ada (Fase 13), tetapi diunggah di panel kanan (Pengaturan → Bahan), bukan di kotak prompt. AI melihat gambarnya dan menampilkannya dengan `<Img src={data.assets[i].src}>`.
- Project **video**: Mode Kreatif tidak punya bahan gambar sama sekali. Permintaan logo membuat AI menggambar logo sendiri dari bentuk/teks, jadi hampir pasti meleset.

## Prinsip
- Logo dipakai **apa adanya** (file asli), tidak digambar ulang. Kontrak AI melarang menggambar ulang logo yang sudah dilampirkan.
- Lampiran tersimpan per project (kit branding), jadi tidak perlu diunggah ulang di tiap prompt atau revisi.
- File asli tidak diubah; AI melihat salinan di folder kerja (seperti Fase 13).

## Desain
- Kotak prompt Kreatif (video dan motion): tombol **"＋ Gambar / logo"**, deretan thumbnail lampiran, hapus per gambar. Seret-lepas file ke kotak prompt juga bisa.
- Tiap gambar punya peran: **Logo** atau **Gambar** (bawaan: nama berisi "logo" = Logo). Peran dan nama masuk `data.assets` (`role: "logo"`), agar AI tahu mana logo.
- Penyimpanan: tabel `assets` kind `material` yang sudah ada (tanpa migrasi), JPG/PNG/WebP/SVG, batas dari `MOTION_GFX.materials` dipindah ke konstanta bersama.
- Project video: `data.assets` ikut di brief, still, pratinjau (rute aset web), dan render (server lokal), sama dengan motion. Kontrak video mendapat bagian "Bahan pengguna".
- Kontrak: "Jika ada aset `role: logo`, tampilkan logo lewat `<Img>` dengan rasio asli; jangan menggambar ulang, mengubah warna, atau mengetik nama brand sebagai pengganti logo." Validator: bila prompt menyebut logo dan ada aset logo, still dicek bahwa kode memakai `data.assets` (peringatan ke AI bila tidak).
- Motion: bahan di panel kanan dan lampiran di kotak prompt adalah daftar yang sama.

## Langkah
- 15.1 Lampiran di kotak prompt Kreatif (unggah, thumbnail, peran, hapus) untuk video dan motion.
- 15.2 Project video: aset ke brief/salinan folder kerja, komposisi Edited, pratinjau, still, dan render.
- 15.3 Kontrak + pemeriksaan pemakaian logo.
- 15.4 Uji: tes otomatis + uji nyata prompt dengan logo PNG pada project video dan motion + ekspor MP4.

## Risiko
- Logo berlatar putih (JPG) akan tampil dengan kotak putih. Disarankan PNG/SVG transparan; UI memberi peringatan untuk JPG logo.

## Hasil (30 Okt 2026)
- [x] 15.1 Kotak prompt Kreatif (video dan motion): tombol "＋ Gambar / logo", seret-lepas file ke kotak perintah, thumbnail di latar kotak-kotak (transparansi terlihat), tombol peran Logo/Gambar, hapus. Peringatan untuk logo JPG. Di motion, daftar ini sama dengan Pengaturan → Bahan (saling memuat ulang).
- [x] Peran tersimpan di `projects/<id>/materials/roles.json` (`packages/shared/src/material-roles.ts`), tanpa migrasi; `PATCH /api/projects/[id]/materials/[mid]` `{ role }`; GET bahan menyertakan `role`. Bawaan: nama berkas berisi "logo" = logo.
- [x] 15.2 Project video: gambar disalin ke folder kerja AI (`assets/`), `data.assets` di brief (gambar saja, dengan `role`), still dan ekspor menyajikan file asli lewat server lokal (`serveCreativeAssets` di `render.ts`), pratinjau editor dan review memakai rute aset web. `materialAssets()` satu fungsi untuk video dan motion.
- [x] 15.3 Kontrak: bagian "Gambar dan logo pengguna" (video) dan aturan logo (motion): tampilkan `role: "logo"` apa adanya lewat `<Img>`, dilarang menggambar ulang atau mengganti dengan teks. Prompt sistem video menyuruh melihat gambar dulu. Validator `logoErrors`: prompt menyebut logo + ada lampiran logo + kode tidak memakai `<Img>` dari `data.assets` -> dikembalikan ke AI.
- [x] 15.4 Uji: `apps/worker/test/fase15.test.ts` (masuk `npm test`), typecheck, still nyata `apps/worker/src/render-logo-smoke.ts` (logo PNG transparan tampil dari file asli, rasio tepat).
- [ ] Uji pengguna: prompt Kreatif dengan logo asli di project video dan motion, lalu ekspor MP4. Tampilan panel lampiran belum dilihat di browser (aplikasi sedang mati saat selesai).
