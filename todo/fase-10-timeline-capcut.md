# Fase 10: Timeline seperti CapCut

Permintaan pengguna (28 Okt 2026): timeline yang benar-benar bisa dipakai mengedit seperti CapCut. Klip bisa dihapus, di-trim, dan **diperpanjang lagi ke bagian yang sudah terpotong** (bila ada yang kelewat terpotong). Ini berlaku bukan hanya untuk klip video, tapi juga untuk klip subtitle (auto subtitle) dan lapisan Mode Kreatif.

Status: **rencana, menunggu persetujuan.** Keputusan 1 sampai 3 sudah dipilih pengguna pada 28 Okt 2026. Fase 9.5 (uji Mode Kreatif) belum selesai dan dikerjakan bersamaan atau sesudahnya, sesuai arahan pengguna.

## Keputusan pengguna (28 Okt 2026)
1. **Timeline memakai waktu hasil**, seperti CapCut. Klip berurutan rapat tanpa celah. Hapus atau trim langsung merapatkan klip sesudahnya (ripple). Bagian yang terpotong tidak terlihat, tapi bisa dimunculkan lagi dengan menarik tepi klip ke luar.
2. **Subtitle menjadi klip mandiri.** Subtitle otomatis dibuat sekali menjadi klip-klip. Setiap klip bisa diedit teksnya, dihapus, di-trim, digeser, dipecah, dan digabung. Tombol "Buat ulang dari transkrip" mengembalikan ke hasil otomatis.
3. **Jenis klip yang bisa diedit: video, subtitle, lapisan Mode Kreatif.** Judul/teks tetap seperti sekarang (trim/geser) dan tidak masuk fase ini.
4. **Tambah rasio 4:5** (1080×1350, feed Instagram/Facebook) di samping 16:9 dan 9:16.

## Prinsip yang tidak berubah
- Aturan 1: file mentah tidak disentuh. Semua edit disimpan di `projects.style` (non-destruktif). Undo/redo dan penyimpanan dengan cek konkurensi yang sudah ada dipakai apa adanya.
- Aturan 2: tidak ada cut otomatis. Memperpanjang klip hanya **memulihkan** bagian yang terpotong. Itu tindakan pengguna, bukan pemotongan.
- Aturan 4: subtitle tetap di layer terpisah, tidak ikut gerak kamera.
- Aturan 5: padding 0,1 detik di tiap sambungan tetap berlaku.
- Data disimpan dalam **waktu video mentah**, sama seperti cut, judul, dan kamera sekarang. Timeline hanya **menampilkan** waktu hasil. Akibatnya, subtitle dan efek tetap menempel pada ucapan yang benar walaupun cut berubah.
- Pratinjau dan render memakai `build-props.ts` yang sama.

## Desain

### Video: perpanjang ke bagian terpotong
- Data baru `style.manual.keeps: Range[]`: bagian yang dipulihkan pengguna. Batas jumlahnya ada di `config/`.
- Urutan penerapan: segmen hasil cut AI yang disetujui ∪ `keeps` − `manual.cuts`, lalu split. Logikanya ada di `manualSegments` (`packages/shared/src/manual.ts`), satu tempat untuk pratinjau dan render.
- Tarik tepi klip **ke dalam** sama dengan trim. Ini sudah ada: menambah `manual.cuts`.
- Tarik tepi klip **ke luar**:
  - menambah `keeps` untuk rentang yang dimunculkan;
  - menghapus atau memendekkan `manual.cuts` yang tumpang tindih.
  Batasnya: sampai bertemu klip berikutnya di video mentah, sehingga urutan ucapan tidak pernah tertukar. Bila bertemu, keduanya menyatu.
- Penanda kecil di sambungan menunjukkan "ada X detik terpotong di sini". Klik penanda memberi pilihan pulihkan semua atau tarik sebagian.
- Usulan AI yang dipulihkan sebagian tetap berstatus disetujui. Panel usulan menampilkan keterangan "dipulihkan sebagian di timeline".

### Timeline dalam waktu hasil
- Semua track (video, subtitle, kreatif, judul, kamera, keyframe) diposisikan lewat pemetaan sumber -> hasil (`frameSegs`; `outputToSource` sudah ada di `timeline.ts`). Playhead, scrub, zoom, dan seek bekerja dalam waktu hasil.
- Track usulan AI yang masih `pending`: usulan ini berada di bagian yang masih tampil, jadi tetap terlihat. Usulan yang sudah disetujui berubah menjadi penanda sambungan.
- Ripple otomatis: posisi dihitung ulang dari segmen setiap kali ada perubahan, tanpa state posisi terpisah.

### Subtitle: klip mandiri
- Data baru `style.subtitles: { clips: Array<{ id, start, end, text, words }> }` dalam waktu sumber. `words` berisi waktu per kata untuk sorotan kata (karaoke).
- Belum ada `style.subtitles` berarti subtitle otomatis seperti sekarang (`buildPages`). Edit pertama apa pun **membekukan** halaman otomatis menjadi klip, lalu menerapkan edit itu.
- Operasi yang didukung:
  - edit teks: kata dipecah ulang; bila jumlah kata berubah, waktu kata dibagi rata di dalam klip;
  - hapus;
  - trim kedua tepi;
  - geser;
  - split di playhead;
  - gabung dengan klip berikutnya.
  Klip tidak boleh tumpang tindih.
- Klip yang melintasi sambungan cut hanya tampil di bagian yang tidak terpotong, sama seperti sekarang.
- "Buat ulang dari transkrip" menghapus `style.subtitles` setelah konfirmasi, sehingga subtitle kembali otomatis. Koreksi typo di tab Transkrip ikut terpakai saat dibuat ulang.
- Batas jumlah klip dan panjang teks ada di `config/`. Ukuran `style` dicek agar tidak membengkak pada video panjang.

### Lapisan Mode Kreatif sebagai klip
- Data baru `style.creativeRanges?: Range[]` (waktu sumber): di rentang mana lapisan kreatif tampil. Kosong berarti seluruh video, seperti sekarang.
- Di timeline, lapisan kreatif tampil sebagai satu track. Bisa di-trim, di-split, dan bagiannya bisa dihapus untuk mematikan efek di bagian tertentu.
- Di luar rentang:
  - `CreativeOverlay` tidak digambar;
  - `CreativeVideo` tidak menggerakkan video;
  - bila versi kreatif menggantikan subtitle bawaan, subtitle bawaan muncul kembali di bagian itu.
- Pergantian versi kreatif (Aktifkan versi lain) tidak mengubah rentang.

### Rasio 4:5
- `ASPECTS["4:5"] = 1080×1350` di `config/`. Setiap konstanta per rasio diberi nilai 4:5:
  - lebar baris dan ukuran font subtitle;
  - zona aman (UI feed Instagram di bawah lebih tipis daripada Reels);
  - tinggi acuan;
  - posisi lower third;
  - batas zoom kamera untuk sumber 16:9 yang dipotong (perbesaran sekitar 1,4×).
- Daftar rasio di operasi mode Cepat (`ops.ts`, `translate.ts`, `effects.ts`), kontrak Mode Kreatif (`contract.ts`, `contract-doc.ts`), dan pilihan rasio di UI diambil dari `ASPECTS`, bukan ditulis ulang per tempat. Dengan begitu rasio berikutnya cukup ditambah di satu tempat.
- Pemotongan bingkai (`bingkai.fokusX`) dan gerak kamera memakai jalur yang sama dengan 9:16.
- Versi Mode Kreatif yang dibuat untuk rasio lain tetap jalan karena kontrak memberi ukuran layar. Tata letaknya mungkin kurang pas, jadi panel Kreatif menampilkan peringatan bila rasio versi berbeda dari rasio sekarang.

### Interaksi (sama untuk semua jenis klip)
- Klik memilih. Tarik tepi untuk trim atau memperpanjang. Tarik badan klip untuk menggeser (subtitle saja).
- **Delete/Backspace** menghapus. **S** split di playhead. **Ctrl+Z / Ctrl+Y** untuk undo/redo.
- Snap ke playhead, tepi klip lain, dan batas kata.
- Klik dua kali klip subtitle untuk mengedit teks langsung.

## Langkah

### 10.0 Rasio 4:5 (selesai 28 Okt 2026)
- [x] `ASPECTS` + semua konstanta per rasio di `config/`
- [x] Daftar rasio di ops/translate/effects/kontrak kreatif diturunkan dari `ASPECT_IDS`
- [x] Pilihan rasio di UI: editor dan halaman project otomatis dari `ASPECTS`. Ukuran pratinjau dihitung dari rasio. Peringatan rasio versi kreatif dibaca dari ukuran still versi itu, tanpa migrasi.
- [x] Tes `aspect.test.ts` (setiap konstanta per rasio wajib lengkap, op, prompt, props 1080×1350, subtitle, batas zoom crop, kontrak)
- [x] Render still 4:5 dicek mata (`src/render-aspect-still.ts`, tanpa menulis DB). Video-1 (sumber vertikal) terbingkai baik, dan subtitle berada di zona aman. Catatan: kata "slam" pada puncak animasi (3×) keluar tepi frame, di 9:16 juga, jadi itu perilaku lama, bukan karena 4:5.

### 10.1 Data dan logika (selesai 28 Okt 2026)
- [x] `manual.keeps`, `restoreRange`, `extendLimits` di `packages/shared/src/manual.ts` (+ tes di `manual.test.ts`)
- [x] `style.subtitles`:
  - skema dan operasi ada di `packages/shared/src/subtitles.ts`;
  - pembekuan dan penyusunan halaman ada di `packages/remotion/src/subtitle-clips.ts` (`buildPages` diberi opsi `keepTogether`);
  - `captionPageOptions` adalah satu sumber aturan halaman;
  - tes: `subtitles.test.ts`.
  Pembekuan sama persis dengan subtitle otomatis yang tampil. Halaman yang melintasi sambungan cut menyimpan kata terpotongnya, tersembunyi sampai bagian itu dipulihkan. Kata terpotong lain dibuatkan klip per wilayah cut. Edit teks hanya mengubah kata yang terlihat.
- [x] Koreksi typo (tab Transkrip dan `fix_word` mode Cepat) ikut ke subtitle beku (`applyWordFixes`)
- [x] `style.creativeRanges`:
  - dipetakan ke timeline hasil di `build-props.ts`;
  - overlay dan gerak video hanya aktif di rentangnya;
  - subtitle bawaan yang digantikan kreatif dibuang dari `pages` hanya di rentang kreatif (komposisi tidak lagi menyembunyikan seluruhnya);
  - struktur pembungkus video tetap sama, sehingga video tidak di-remount saat masuk/keluar rentang.
- [x] Batas di `config/` (`MANUAL.maxKeeps`, `MANUAL.subtitles`, `CREATIVE.maxRanges`); rute style menolak subtitle tidak sah (bukan diam-diam kembali otomatis), keeps/subtitle melewati durasi

### 10.2 Timeline waktu hasil (selesai 28 Okt 2026)
- [x] `Timeline.tsx` memetakan semua track ke waktu hasil (`toOut`/`toSrc`). Props dan seek tetap dalam waktu mentah, sehingga bagian editor lain tidak berubah. Playhead, scrub, zoom, ruler, dan durasi memakai durasi hasil.
- [x] Penanda sambungan berisi durasi yang terpotong (`.gapMark`), menggantikan blok cut. Klik penanda = pulihkan semua (`restoreGap`).
- [x] Judul dan keyframe dipetakan. Kamera dan subtitle sudah dalam waktu hasil. Usulan yang sudah diterapkan tampil sebagai penanda tipis di sambungan.

### 10.3 Klip video (selesai 28 Okt 2026)
- [x] `EditableBlock` mendapat `minStart`/`maxEnd` (batas tarik ke luar). `clipRange` di editor: lebih sempit = cut manual, lebih lebar = `restoreRange`, satu langkah undo. Delete dan S seperti sebelumnya. In/Out di panel Manual bisa melewati klip sampai batas pulih.
- [x] Panel usulan: "Dipulihkan sebagian/seluruhnya di timeline"

### 10.4 Klip subtitle (selesai 28 Okt 2026)
- [x] Track subtitle: pilih, klik dua kali = edit teks, tarik tepi = trim, tarik badan = geser, Delete, S = pecah di playhead. Subtitle otomatis dibekukan pada edit pertama (`autoSubtitleClips`). Klip yang seluruhnya terpotong tidak tampil.
- [x] `SubtitleClipPanel`: teks (kata di bagian terpotong tidak ikut diedit), pecah, gabung dengan berikutnya, hapus, "Buat ulang dari transkrip"

### 10.5 Klip Mode Kreatif (selesai 28 Okt 2026)
- [x] Track "Kreatif" hanya muncul bila versi kreatif aktif. Tarik tepi/badan untuk mengatur rentang. S memecah, dengan celah 1 frame agar tidak digabung lagi. Delete mematikan efek di bagian itu. "Tampilkan di seluruh video" mengembalikan bawaan.

### 10.6 Uji
- [x] Tes otomatis: `aspect.test.ts`, `subtitles.test.ts`, `manual.test.ts` (keeps), `creative-composition.test.ts` (diperbarui). Semua 15 berkas `npm test` lulus, typecheck bersih.
- [x] Uji klik di browser pada project uji "Tes Fase 3 07:39:51" (28 Okt 2026). Semuanya berjalan:
  - edit teks subtitle (pratinjau berubah);
  - tarik tepi klip ke luar (+0,50 dtk, ripple);
  - klik penanda 0,5 dtk (dipulihkan);
  - Ctrl+Z dua kali (kembali);
  - pecah dan matikan lapisan kreatif (subtitle bawaan muncul kembali di bagian itu);
  - hapus, gabung, dan geser subtitle;
  - buat ulang dari transkrip;
  - 4:5 di pratinjau.
  Bug yang ditemukan dan diperbaiki: setelah pernah klik dua kali, memilih subtitle lain memfokus kotak teks lagi sehingga Delete menghapus teks di kotak, bukan klipnya.
- [x] Render still dengan kode terbaru (`render-aspect-still.ts`, gaya tersimpan: 4:5, subtitle beku, kreatif sebagian) sama dengan pratinjau.
- [ ] Render MP4 penuh belum terbukti. Dua percobaan pada 28 Okt 2026 gagal karena memori mesin, bukan error kode:
  - percobaan pertama: `x264 malloc failed` sejak frame 0;
  - percobaan kedua, dengan `RENDER_CONCURRENCY=1`: proses compositor mati di frame 468.
  Sisa memori komit hanya 2,5 GB karena pagefile di C: kecil. Ulangi setelah memori lega (tutup Chrome/CapCut, atau perbesar pagefile/ruang C:).

## Risiko yang sudah diketahui
- Mengubah timeline ke waktu hasil menyentuh semua track sekaligus. Dikerjakan bertahap dan diuji per track.
- Subtitle beku tidak lagi mengikuti transkrip otomatis. Ini disengaja (keputusan 2) dan diatasi dengan "Buat ulang dari transkrip".
- Video panjang bisa punya ratusan klip subtitle, sehingga `style` membesar. Perlu batas dan pengecekan ukuran.
- Render MP4 tidak stabil di mesin ini karena memori (catatan Fase 9). Ini terpisah dari fase ini, tapi bisa mengganggu uji render. Pada 28 Okt 2026 sisa memori komit hanya 2,5 GB (pagefile di C: kecil). `RENDER_CONCURRENCY=1` (env worker, `render.ts`) mengurangi kebutuhan memori.
- Lapisan Mode Kreatif membaca kata dari transkrip, bukan dari klip subtitle. Edit teks di klip subtitle tidak terlihat di tipografi buatan AI; koreksi di tab Transkrip terlihat.
- Worker harus dimulai ulang agar render memakai kode Fase 10. Worker yang berjalan sejak sebelum perubahan mengabaikan keeps, klip subtitle, dan rentang kreatif.

## Selesai jika
- Klip video bisa di-trim, dihapus, di-split, dan diperpanjang ke bagian terpotong, dengan klip lain merapat otomatis.
- Subtitle bisa diedit seperti klip CapCut dan hasilnya sama di pratinjau dan render.
- Lapisan kreatif bisa dimatikan di bagian tertentu.
- Undo/redo bekerja untuk semuanya, dan file mentah tidak berubah.
- Video bisa dipratinjau dan dirender dalam rasio 4:5 dengan subtitle dan judul di zona aman.
