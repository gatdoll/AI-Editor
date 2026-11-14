# Fase 24: Teks di belakang talent, blur wajah, dan font sesuai referensi

Permintaan pengguna (12 Nov 2026), revisi Kreatif: (1) font benar-benar mengikuti referensi; (2) beberapa kata muncul DI BELAKANG talent; (3) teks muncul di depan wajah, dan wajahnya di-blur saat teks itu tampil. Ketiganya belum bisa sebelumnya, jadi ditambahkan sebagai fitur.

Status: **kode selesai (12 Nov 2026).** Tes lulus; ketiga fitur terbukti di render still sungguhan (Edited + talent transparan + blur + font Anton). Menunggu: restart worker, lalu satu revisi Kreatif nyata dari browser. **Tanpa migrasi.** Sekali per mesin: `npm run setup:talent`, `npm run setup:fonts` (sudah dijalankan di mesin ini).

## Cara kerja
### Talent (2 dan 3)
- `apps/worker/py/talent.py` (CPU): RobustVideoMatting mobilenetv3 (ONNX) memisahkan orang dari latar -> `projects/<pid>/talent/<assetId>.webm` (VP9 + alpha, waktu sama dengan file mentah); YuNet mendeteksi wajah 5x/detik -> `<assetId>.faces.json`. ±3x durasi video di CPU (6 dtk = 16 dtk). File mentah hanya dibaca.
- Dibuat otomatis oleh job Kreatif bila prompt menyebut belakang/behind/blur/wajah/talent (`TALENT.promptPattern`) atau versi dasar sudah memakai `Behind`/`faceBlur`. Tidak terpasang = job gagal dengan pesan `npm run setup:talent` (aturan 7).
- Komposisi Edited: video -> lapisan `Behind` (export bernama kode AI) -> video talent transparan (gerak kamera/transform sama persis) -> overlay. `faceBlur(frame, data)` (export bernama) = kekuatan blur; sistem memburamkan kotak wajah di ruang video (ikut kamera) dengan backdrop-filter. `data.faces` = posisi wajah (piksel kanvas, timeline hasil, perkiraan tanpa gerak kamera) untuk menaruh teks di depan wajah.
- Pratinjau web: `/api/assets/<id>/talent` (data wajah) dan `?file=1` (video, Range). Render/still: server lokal (`talentFile`).

### Font (1)
- Pustaka: 52 keluarga Google Fonts (OFL), 105 file, spesimen PNG per keluarga di `MEDIA_DIR/fonts/library` (`npm run setup:fonts`).
- Font unggahan pengguna (TTF/OTF/WOFF/WOFF2, tombol "＋ Font" di kotak Kreatif); nama keluarga = nama berkas.
- Job Kreatif menyalin `fonts/catalog.json` + spesimen ke folder kerja. Dengan referensi, AI wajib membandingkan bentuk huruf frame referensi dengan spesimen dan memilih yang paling mirip. Pilihan di `fonts.json` divalidasi (keluarga/ketebalan harus ada), disimpan per versi (`creative/<vid>/fonts.json`), dimuat komposisi dengan `delayRender` sebelum frame dirender (pratinjau, still, render MP4; video dan semua kategori motion).

## Peta kode
| Bagian | Berkas |
| --- | --- |
| Konstanta | `TALENT`, `FONT_LIBRARY` di `config/index.ts` |
| Talent | `apps/worker/py/talent.py`, `apps/worker/src/talent.ts`, `packages/shared/src/talent.ts`, `scripts/setup-talent.mjs` |
| Komposisi | `compositions/Edited.tsx` (Behind, talent, blur), `creative/CreativeLayer.tsx` (CreativeBehind, faceBlurAt, CreativeFontLoader), `creative/compile.ts` (`creativeExport`), `creativeFaces` di `build-props.ts` |
| Font | `packages/shared/src/font-library.ts`, `apps/worker/src/creative/fonts.ts`, `scripts/setup-fonts.mjs`, `/api/fonts/[fontId]`, rute bahan (unggah font) |
| Job Kreatif | `creative/handler.ts` (siapkan talent, katalog font, validasi fonts.json, simpan), instruksi `talentInstruction`, contract-doc |
| Web | `lib/use-talent.ts`, `/api/assets/[id]/talent`, editor (talent ke pratinjau), motion page + CreativePanel (font) |

## Verifikasi (12 Nov 2026)
- `npm test` lulus termasuk `fase24.test.ts`; `npm run typecheck` bersih.
- Uji kelayakan: matte RVM di CPU bersih (rambut, tangan, tepi baju) pada video 9:16 nyata.
- Still sungguhan: kata besar di belakang kepala talent (tertutup rambut/kepala), blur oval tepat di wajah, teks di depan wajah tepat di posisi `data.faces`, font Anton termuat.
- Bug ditemukan dan diperbaiki saat uji: lapisan talent memakai `Sequence layout="none"` sehingga terdorong ke luar layar; sekarang dibungkus AbsoluteFill.

## Batas
- Waktu: pemisahan talent ±3x durasi video (sekali per video; disimpan). Revisi berikutnya memakai hasil yang sama.
- Kualitas matte bisa turun bila latar mirip warna baju/rambut atau ada beberapa orang; blur hanya wajah TERBESAR.
- `data.faces` tidak menghitung gerak kamera (perkiraan); blur dihitung tepat.
- Font referensi yang bukan Google Fonts (komersial) tidak ada di pustaka: AI memilih yang paling mirip dan menyebut nama aslinya di notes; unggah filenya untuk hasil persis.
- Review page belum memakai talent/blur di pratinjaunya (editor dan render sudah).
