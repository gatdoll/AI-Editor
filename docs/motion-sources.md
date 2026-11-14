# Motion lewat prompt dan referensi upstream

Integrasi ini memperluas engine editor yang sudah ada. Preview dan ekspor tetap memakai `buildEditedProps` dan komposisi `Edited` yang sama. Instalasi skill membantu coding agent menulis komposisi; skill bukan mesin yang otomatis menjalankan setiap resep di dalam chat editor.

## Sumber yang diperiksa

| Sumber | Commit yang diperiksa | Pemakaian |
| --- | --- | --- |
| [Remotion skills](https://github.com/remotion-dev/skills) | `30d4553ecd46fbc5212fd0ff006ae43af522158b` | `remotion-best-practices` dipasang di `.agents/skills/` dan skill Codex lokal. Animasi berbasis frame, Studio, jalur preview/render bersama. |
| [remotion-claude-video](https://github.com/JJenglert1/remotion-claude-video) | `580b9a04558909eb9f2f71e4ec5f41af3e5358ae` | Starter dan alur prompt dipelajari; bukan backend pengganti editor. |
| [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) | `43bd349a136651865ecfa6ea1cf012f6e957d304` | Resep blur-slide: satu progres quint-out untuk perpindahan, opacity, blur; ide kamera halaman 2.5D diadaptasi ke frame video. Demo upstream BlurSlide dijalankan terpisah. Code/docs Apache-2.0; audio tidak disalin. |
| [animate](https://github.com/cth9191/animate) | `7e5eb56feb2dd573f890e1b7b34748af43d58263` | Skill cerita dan karakter (grammar cerita; gaya cut paper, sketchbook, crosshatch, riso, pixel, isometric, math; kit gambar canvas). Dipakai sebagai BACAAN lewat adaptor `apps/worker/src/creative/skills/animate-story.md`; alur interaktif, tools/ dan templates/ tidak disalin. Wajib untuk project Animasi. MIT. |
| [DigitalSamba toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) | `da3f474c1230d161be1384ef97aec27f73b11636` | Contoh hello-world/SprintReview dijalankan untuk referensi. MIT. Tidak mengaktifkan layanan cloud/GPU. |

Sumber rumus blur-slide: `demos/typography/blur-slide/BlurSlide.tsx` dan `references/shots/typography/blur-slide.md`. Kamera halaman: `assets/lib/PageCam.tsx`. Implementasi editor sendiri ada di `motion-plan.ts`, `MotionStage.tsx`, dan `KineticCaptions.tsx`. Konstanta berada di `config/index.ts`.

## Menjalankan

```powershell
npm.cmd run studio
npm.cmd run studio:shotcraft
npm.cmd run studio:toolkit
```

Dua perintah terakhir memakai checkout lokal `.cache/shotcraft-source` dan `.cache/toolkit-source`, mengunduh commit di atas jika belum tersedia. Studio Shotcraft memakai port 3003; toolkit memakai 3002. Toolkit menyamakan paket Remotion ke 4.0.539 dan memberi alias React agar monorepo ini tidak memuat dua React. Itu penyesuaian lokal; tidak ada fork atau push ke GitHub.

## Kemampuan chat editor

- Maksimum 64 operasi per prompt. Jika output AI melebihi batas, seluruh batch ditolak dengan satu alasan, bukan diterapkan sebagian secara diam-diam.
- Subtitle `kinetik` atau `blur-slide`, warna, ukuran, jumlah kata, dan dimming.
- Framing `datar`, `orbit`, atau `parallax`, diaktifkan dengan `motion.bingkai`.
- Pola kamera `otomatis`, `sinematik`, `kiri-kanan`, `maju-mundur`; arahan preset kamera pada waktu sumber tertentu. Batas crop, zoom, dan kontinuitas kamera tetap berlaku.
- Judul motion maksimal 12, masing-masing 120 karakter dan 20 detik, posisi atas/tengah, animasi kinetik/blur-slide. Waktu sumber dipetakan melalui EDL sehingga judul mengikuti cut yang disetujui.
- Panel hasil menampilkan operasi aktual. Teks rencana AI disimpan dalam bagian terlipat dan tidak dijadikan bukti keberhasilan.

### Efek video pendek (resep dari ketiga repo, dipetakan ke kontrol tertutup)

| Permintaan | Kontrol | Sumber resep |
| --- | --- | --- |
| Transisi whip pan / zoom-through / glitch | `transisi.jenis`, `transisi.durasi` (hanya di sambungan cut yang disetujui) | toolkit `zoom-blur`, `glitch`; whip = geser + blur |
| Camera shake 2–3 frame | `kamera.guncang` (pada kata slam, awal hook, arahan zoom) | Shotcraft `crash-zoom-punch` (amplitudo·e^(−t/1.8f)) |
| Dutch tilt lalu snap | `kamera.miring` (skala menutup sudut kosong) | — |
| Kata kunci 1.3x + kotak menyapu | op `highlight_phrase` effect `aksen` | Shotcraft `marker-underline-title` (8–12f) |
| Kata dibanting 300%→100% | op `highlight_phrase` effect `slam` (+ guncangan) | Shotcraft `slam-entrance-moves` (score-slam) |
| Headline hook dari berbagai arah | `add_title` animation `hook` (teks kosong = kata yang diucapkan) | — |
| Lower third garis + label | `add_title` animation `lower-third`, `subtext` | — |
| Font Montserrat ExtraBold / Inter Black | `teks.font` | — |
| Scale pop 80%→100% | `teks.popDari` | — |
| Teks keluar slide-out / dissolve | `teks.keluar` | — |

Belum didukung dan dilaporkan sebagai "Belum didukung" di hasil perintah: speed ramp, sinkron beat musik, musik/SFX. Konstanta di `FX` (`config/index.ts`), logika murni di `packages/remotion/src/fx-plan.ts`, tes di `apps/worker/test/fx.test.ts`, potret frame lewat `apps/worker/src/render-fx-study.ts <projectId>`.

Chat editor belum menjalankan JSX bebas, semua shot di galeri Shotcraft, atau transisi custom dari toolkit. Komposisi bebas dapat dikerjakan coding agent melalui skill Remotion dan Studio. Kata “sinematik” diterjemahkan ke kontrol yang telah terhubung, bukan janji menjalankan seluruh library.

Contoh prompt:

> Pakai gaya motion 9:16, subtitle blur-slide maksimal 3 kata, kapital tebal, putih hangat #FFF4E0 dengan aksen lime #B6F500. Aktifkan framing orbit dengan kekuatan 0.8. Kamera sinematik energik, gerakan 2–4 detik, zoom maksimal 1.2x. Tambahkan judul “BUKAN VIDEO BIASA” di atas pada detik sumber 0–4, animasi blur-slide. Pada detik sumber 6–9 arahkan kamera pull-back. Jangan ubah cut atau audio.

## Verifikasi

`npm test` mencakup regresi prompt 21 operasi, overflow tanpa penerapan sebagian, delapan kombinasi pola/aspek kamera, judul dan kamera bertiming, deduplikasi, serta pemetaan judul melewati cut. Uji langsung menggunakan proyek sintetis terpisah, bukan replay otomatis pada proyek pengguna.

Uji integrasi melalui API prompt + worker Codex menghasilkan 23 operasi, 0 penolakan, dan nilai yang tersimpan sesuai permintaan. Prompt kedua menghapus/mengganti judul, lalu edit teks lewat inspector terbukti tersimpan tanpa menghilangkan 20 parameter atau arahan kamera. Render still dari gaya tersimpan: 1080×1920, 834 frame / 27,8 detik, 10 gerakan kamera, 0 pelanggaran. Batas judul panjang menyesuaikan ukuran teks. Preview orbit diverifikasi di Chrome; stacking context eksplisit menjaga video tidak tertutup backdrop saat transformasi 3D.

`npm run typecheck`, build web, dan audit 37/37 lulus. Hasil ini memakai video uji sintetis; belum merupakan penilaian kualitas framing wajah pada semua footage pengguna. Di panel prompt tersedia shortcut **Orbit + blur** dan **Parallax halus**; pilih provider yang siap lalu kirim. Skill Codex yang baru diinstal akan tersedia pada sesi berikutnya.
