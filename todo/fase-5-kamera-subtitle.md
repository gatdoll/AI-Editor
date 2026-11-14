# Fase 5: Kamera dan Subtitle

Tujuan: gerakan kamera, subtitle per kata, pemilih gaya.

Legenda: [x] selesai dan diuji · [~] kode ditulis, belum diuji penuh · [ ] belum

## Kamera
- [x] Komponen `<Camera>` (scale, translate, rotate). Logika murni di `camera-plan.ts` agar identik di browser, server, dan renderer
- [x] Lima preset: push-in, pull-back, pan, tilt ringan, zoom ke titik. Semua dipakai (sebaran 2.052 / 2.742 / 2.778 / 2.714 / 2.250 pada 12.536 gerakan uji)
- [x] Semua gerakan memakai easing (cubic-bezier ease-in-out, lambat di awal). Teruji: menyimpang dari linear, monoton
- [x] Preset tidak sama dua kali berturut-turut, termasuk di sambungan cut. Teruji pada 1.000 rencana acak
- [x] Drift handheld sangat kecil: maksimum 2 px, deterministik
- [x] Batas zoom per kasus: 1080p -> 1,2x; 4K -> 1,6x; 16:9 dipotong ke 9:16 -> 1,08x (sudah diperbesar ~1,8x)
- [x] **Tidak ada tepi hitam**: pemeriksaan geometri eksak (rotasi + translasi + drift, empat sudut). Teruji pada 1,12 juta sampel frame, 4 konfigurasi resolusi/rasio, nol pelanggaran. Tes ini menangkap bug nyata (awal gerakan tilt belum diperiksa)
- [x] Tanpa lompatan di tengah segmen: state awal = state akhir sebelumnya; lompatan hanya di sambungan cut
- [x] Segmen < 0,6 dtk ditahan diam (gerakan secepat itu terlihat menyentak). 756 dari 13.616 gerakan uji
- [x] Rencana disimpan: gaya ada di `edl.params.style`; rencana kamera dihitung deterministik dari (EDL, rasio, seed = id EDL)
- [ ] **Penempatan preset otomatis TIDAK bisa diubah pengguna per scene.** Pengguna hanya memilih kamera nyala/mati. Pengubahan preset per scene belum dibuat
- [ ] Zoom ke titik memakai titik tetap (wajah talking head kira-kira di tengah-atas). Face tracking = setelah MVP

## Subtitle
- [x] Memakai tipe `Caption` dari `@remotion/captions` (token milidetik). Penyusunan halaman memakai kode sendiri agar maksimal 2 baris terkontrol
- [x] Kata yang diucapkan disorot (warna aksen + terangkat), kata lain redup. Dilihat pada render still. Pembesaran kata dibuang karena menimpa spasi ("welcometo")
- [x] Maksimal 2 baris, tiap baris <= batas karakter (16:9: 34; 9:16: 20; huruf besar dikurangi 12%). Teruji 36/36 termasuk semua kata muncul tepat sekali dan berurutan
- [x] Zona aman: 16:9 bawah 8%; 9:16 bawah 24% dan samping 7% (menghindari UI Instagram/TikTok). Dilihat pada still 9:16
- [x] Timing dari transkrip Whisper, dipetakan ke timeline hasil memakai pembulatan frame yang sama dengan komposisi
- [x] Layer terpisah di atas kamera: tidak ikut bergerak (aturan 4)
- [x] Timing dihitung ulang mengikuti EDL: kata di bagian terpotong dibuang, kata di tepi segmen dipangkas
- [~] **Sinkron subtitle-suara BELUM terjamin.** Timestamp kata whisper.cpp 1.5.5 sering meleset di sekitar jeda: pada video uji "videos" tercatat 1,26 dtk padahal ucapan sebenarnya ~0,5 dtk (ffmpeg menunjukkan diam di 10,88-11,66). Sorotan kata bisa tertinggal/mendahului hingga ~0,8 dtk di dekat jeda. Mitigasi: perataan durasi kata yang diperas (kata "quickly." tadinya hilang dari subtitle). Perbaikan sejati = forced alignment atau model lebih besar; belum dikerjakan
- [ ] Halaman subtitle kadang dimulai dengan kata penutup kalimat sebelumnya ("channel." di awal halaman berikutnya pada 9:16). Kosmetik

## Gaya
- [x] Satu font family (Plus Jakarta Sans via `@remotion/google-fonts`), 2 weight (500, 800). BUTUH internet saat render/pratinjau pertama (font diunduh dari Google)
- [x] Tiga gaya (Bersih, Tebal, Lembut), tiap gaya maks 3 warna (teks, aksen, gelap), gradient halus
- [x] Vignette ringan dan grain tipis. Grain DIHITUNG MAHAL: lihat bagian Ukuran dan kecepatan
- [x] Semua konstanta di `config/index.ts` (aturan 8)
- [~] Pemilih gaya di UI (rasio, gaya, kamera, subtitle, efek, posisi potong) dengan pratinjau Remotion Player; disimpan ke EDL. **Build produksi lolos dan API teruji, tetapi tampilan dan pratinjau Player belum pernah dilihat di browser**

## Rasio
- [x] Keduanya, dipilih saat render (keputusan pengguna). Teruji: dua hasil dari EDL yang sama, 1920x1080 dan 1080x1920
- [x] 9:16 dari sumber 16:9 = potong tengah dengan geser posisi (slider). Face tracking = setelah MVP
- [ ] Sumber 1080p ke 9:16 diperbesar ~1,8x sehingga agak lembut; sumber 4K lebih tajam. Belum diuji pada video nyata

## Ukuran dan kecepatan (terukur pada video uji 28 dtk, 834 frame, i5-10400)
| Konfigurasi | Waktu render | Ukuran |
|---|---|---|
| Polos (tanpa kamera/subtitle/efek) | 44 dtk (19 fps) | ~3,4 MB |
| + kamera + subtitle | 45 dtk (18,5 fps) | sama |
| + efek dengan `mix-blend-mode` grain | 75-81 dtk | 43-162 MB |
| + efek (grain tekstur, tipis, CRF 23) | 52 dtk (16 fps) | 13-16 MB |
- Temuan: kamera dan subtitle hampir gratis; yang mahal adalah **grain** (waktu dan ukuran). Blend mode dibuang, grain dibuat tipis, CRF 23. Pengguna bisa mematikan "Efek film"
- [ ] Ekstrapolasi kasar: video 1 jam 16:9 dengan efek = ~1,6 GB dan ~1 jam render. **Belum diukur**

## Uji
- [x] Unit/properti: 1.000 rencana kamera, 36 tes subtitle, 11 tes perataan kata dan hold, 11 tes EDL/padding
- [x] Render nyata lewat antrean: 18/18 (gaya tersimpan di EDL, override saat render, normalisasi gaya tak valid, dua rasio, unduh, file mentah utuh)
- [x] Pemeriksaan visual pada frame render (16:9 dan 9:16, tiga gaya): teks terbaca, zona aman benar, kata aktif tersorot, spasi benar
- [~] Satu kegagalan render sesaat teramati (ffmpeg tidak bisa menulis ke folder sementara Windows), tidak bisa direproduksi; ditambahkan satu kali coba ulang otomatis. Belum terbukti menangani kasus itu
- [ ] Gerakan kamera DILIHAT bergerak pada video (hanya still dan angka); video uji berupa animasi teks sehingga tidak mewakili wajah/talking head
- [ ] Uji video nyata (bahasa Indonesia, wajah, 1-3 menit)

## Selesai jika
- Render punya subtitle sinkron dan minimal satu gerakan kamera bermakna per scene.
- Status: gerakan kamera dan susunan subtitle terbukti benar secara matematis dan visual pada frame diam. **Sinkron subtitle-suara dan kualitas gerakan pada video nyata belum terbukti.**
