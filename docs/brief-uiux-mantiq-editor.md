# Brief UI/UX: Mantiq Editor

> Brief ini untuk Claude Design. **Pakai design system yang dilampirkan** untuk semua warna, tipografi, spacing, radius, ikon, elevasi, dan komponen dasar (tombol, input, tab, toggle, slider, dropdown, toast). Jangan membuat token baru. Kalau ada kebutuhan yang belum ditangani design system (misalnya warna jenis klip di timeline, atau status "dipilih" pada kartu kandidat), turunkan dari token yang ada dan catat turunannya di spesifikasi.

## 1. Produk

**Mantiq Editor** adalah aplikasi editing video berbasis AI untuk kreator konten Indonesia. Pengguna tidak perlu terminal: unggah rekaman atau tulis brief, AI mengusulkan dan mengerjakan, pengguna memutuskan, lalu hasilnya diekspor ke MP4.

- **Pengguna:** satu orang (pemilik), kreator konten short-form dan long-form. Paham editing dasar (CapCut, Premiere), bukan programmer.
- **Platform:** web app di browser desktop (Chrome). Tema gelap sebagai tampilan utama. Ponsel bukan target, tetapi tidak boleh rusak.
- **Bahasa:** Indonesia, dengan istilah Inggris yang lazim di dunia editing (cut, timeline, playhead, voice over, motion, subtitle, preset, render).
- **Mesin di balik layar:** Remotion untuk komposisi dan render; Claude Code CLI atau Codex CLI untuk analisis dan penulisan kode motion; Whisper untuk transkrip per kata; kloning suara lokal untuk voice over.

### Janji produk yang harus terasa di seluruh UI
1. **File asli tidak pernah diubah.** Semua edit non-destruktif dan bisa dibatalkan.
2. **AI hanya mengusulkan; pengguna yang memutuskan.** Tidak ada cut, aset internet, atau versi motion yang diterapkan tanpa persetujuan.
3. **Jujur soal ketidakpastian.** Bagian yang tidak bisa dinilai ditandai "tidak bisa dinilai", bukan ditebak. Kegagalan tampil dengan alasan dan jalan keluarnya.
4. **Pratinjau sama dengan hasil ekspor.** Apa yang diputar di workspace adalah apa yang dirender.

## 2. Tujuan desain

1. **Satu bahasa visual untuk empat jenis project** (Video, Motion, Animasi, Opinion Motion), dengan workspace yang terasa sekeluarga tetapi jelas bedanya.
2. **Status proses AI selalu jelas dan menenangkan.** Banyak proses makan waktu: transkrip, auto cut, mode kreatif 2–8 menit, voice over menit sampai jam, render. Pengguna harus selalu tahu: sedang apa, sudah berapa persen, bisa dibatalkan atau tidak, dan apa yang terjadi sesudahnya.
3. **Keputusan cepat.** Menyetujui usulan cut, memilih versi motion, dan memilih aset internet harus bisa dilakukan dalam satu klik, tanpa dialog konfirmasi berlapis, dan selalu bisa diganti atau dibatalkan.
4. **Kepadatan profesional tanpa sesak.** Workspace editing padat informasi (timeline, properti, panel AI). Butuh hierarki tegas, bukan ruang kosong berlebihan.
5. **Rapikan yang sudah tumbuh organik.** UI sekarang dibangun bertahap per fase dan punya inkonsistensi: label tab campur aduk, emoji sebagai ikon tab, peringatan teknis (nama file migrasi) tampil ke pengguna, dan panel kanan yang berbeda lebar. Desain baru menyatukan semuanya.

## 3. Prinsip desain

- **Preview adalah pusat.** Video selalu terlihat dan sebesar mungkin. Panel di sekitarnya melayani preview.
- **Satu keputusan, satu tempat.** Usulan cut diputuskan di satu daftar, aset di satu panel, versi motion di satu daftar versi.
- **AI terlihat sebagai rekan kerja, bukan sihir.** Tiap hasil AI menampilkan provider/model, alasan, dan catatannya, dalam bentuk ringkas yang bisa dibuka.
- **Status tidak hanya lewat warna.** Selalu ada teks atau ikon pendamping.
- **Undo di mana-mana.** Edit manual punya undo/redo (Ctrl+Z / Ctrl+Shift+Z); perintah prompt punya "Batalkan perintah ini"; versi motion punya "Kembali ke versi N".
- **Pesan teknis untuk pemilik, bukan untuk ditakuti.** Peringatan seperti "worker perlu dimulai ulang" atau "migrasi database belum dijalankan" tetap ada, tetapi tampil sebagai kartu status sistem yang tenang dengan langkah perbaikan, bukan teks merah di tengah panel.

## 4. Peta aplikasi

```
Beranda (daftar project + buat project)
├── Project Video
│   ├── Persiapan: unggah video → transkrip → (opsional) auto cut
│   └── Workspace Video (editor utama: preview + timeline + panel kiri + properti kanan)
├── Project Motion          ┐
├── Project Animasi         ├─ Workspace Motion (brief dulu, lalu workspace: versi + preview + panel kanan)
└── Project Opinion Motion  ┘   (Opinion Motion menambah tahap Aset)
Demo (studi motion, halaman showcase)
```

Navigasi global: header tipis berisi logo **Mantiq Editor**, breadcrumb (Semua project / Nama project), indikator **Status sistem** (worker hidup atau tidak, Claude Code siap atau tidak, Codex siap atau tidak), dan tautan Demo.

## 5. Layar per layar

### 5.1 Beranda
- Heading besar ("Ruang untuk cerita berikutnya." boleh dipertahankan atau diganti) dan jumlah project.
- **Panel buat project:** input nama + **empat kartu jenis** (bukan empat tombol sejajar). Tiap kartu berisi ikon, nama, dan satu baris deskripsi:
  - **Video**: "Unggah rekaman bicara. AI memotong, memberi subtitle, dan gerakan kamera."
  - **Motion**: "Motion graphics dari brief: logo, teks, grafik, musik."
  - **Animasi**: "Cerita bergambar dengan karakter."
  - **Opinion Motion**: "Opini bernarasi dengan foto tokoh dan screenshot berita dari internet."
- **Daftar project:** grid kartu (cover dengan nomor urut + ikon jenis + label jenis, nama, status, tanggal, aksi "Buka"). Ada pencarian dan filter jenis.
- Hapus project lewat konfirmasi inline di kartu, dengan opsi "Hapus juga file dari disk" (tidak bisa dikembalikan, jadi beri penekanan).
- Status kosong: "Cerita pertamamu dimulai di sini".
- Status project: Baru, Mengunggah, Memproses file, Transkrip, Auto cut, Siap, Gagal.

### 5.2 Project Video: Persiapan
- Zona unggah (drag & drop, bisa beberapa video sekaligus; MP4/MOV termasuk HEVC dari iPhone).
- **Pipeline bertahap:** Unggah → Memproses file (metadata, salinan pratinjau bila perlu) → siap. Tiap tahap punya status, progres, dan tombol "Coba ulang dari tahap ini" bila gagal.
- Setelah siap: kartu "Video siap diedit" + CTA **Buka workspace**. Transkrip tidak wajib di sini (bisa dibuat dari workspace).

### 5.3 Workspace Video (layar terpenting)

Tata letak ala CapCut/Premiere:
```
┌──────────────── Header: ← project · nama · rasio · undo/redo · status · [Ekspor MP4] ────────────────┐
│ Panel kiri (tab)        │            Preview (stage + kontrol putar)          │ Panel properti (bisa   │
│ Prompt · Manual ·       │  [16:9 | 9:16 | 4:5]  [mode fokus] [geser/zoom]    │ ditutup): Video · Teks │
│ Usulan · Transkrip ·    │                                                     │ · Kamera · Audio ·     │
│ Media                   │                                                     │ Ekspor                 │
├─────────────────────────┴─────────────────────────────────────────────────────┴───────────────────────┤
│ Toolbar timeline: Auto cut · Auto subtitle · Kurangi noise · SFX · Klip akhir · split (S) · hapus · zoom │
│ Timeline: ruler · lane Video (klip per file) · lane Audio (waveform) · lane Subtitle · lane Judul ·       │
│ lane Usulan cut · lane SFX · blok Klip akhir · playhead                                                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Header**
- Pilihan rasio (16:9 / 9:16 / 4:5; video dipotong ke area aman), undo/redo, indikator simpan ("Tersimpan" / "Menyimpan…" / "Gagal menyimpan: Coba simpan"), dan **Ekspor MP4**.
- Ekspor: pengguna memilih lokasi file dulu, lalu render berjalan dengan progres di tombol ("Merender… 42%"), lalu tersimpan otomatis. Riwayat hasil ekspor (Putar, Simpan ke…) ada di tab Ekspor panel properti.

**Preview**
- Remotion Player dengan kontrol putar, waktu, dan loop.
- Mode fokus (perluas preview).
- Mode geser/zoom langsung di canvas (CanvasPan) untuk framing.
- Subtitle selalu di layer terpisah di atas video (tidak ikut gerak kamera). Desain pratinjau harus menunjukkannya.

**Panel kiri: lima tab**
1. **Prompt**: edit lewat bahasa alami. Ada tiga mode lewat segmented control:
   - **Cepat**: kalimat → operasi tertutup (subtitle, warna, kamera, judul, efek), selesai dalam detik. Pilih provider (Claude Code / Codex) + model. Shortcut preset (mis. "Orbit + blur", "Parallax halus"). **＋ Referensi gaya**: unggah video atau tempel link, pilih detik cuplikan, tulis aspek yang ditiru. Riwayat perintah: tiap perintah menampilkan operasi yang benar-benar diterapkan, yang ditolak beserta alasannya, teks rencana AI (terlipat), dan **Batalkan perintah ini**. Perintah yang memotong hanya membuat usulan yang menunggu persetujuan.
   - **Kreatif**: AI (Opus) menulis kode Remotion khusus video ini, 2–8 menit. Lampiran: gambar/logo, design system (PDF), screenshot masalah. Progres per tahap (Menyiapkan skill → AI menulis kode → Validasi → Render still → Simpan). Daftar **kartu versi**: 4 still berlabel, catatan AI, model, durasi, status (draft/aktif/ditolak/gagal), aksi Aktifkan / Tolak / Pulihkan / Lanjutkan dari versi ini / Lihat kode / Kembali ke versi N / Matikan Mode Kreatif.
   - **Klip akhir**: klip motion penutup (CTA) sesudah video. Durasi 3–60 detik + prompt + daftar versi seperti Kreatif.
2. **Manual**: edit langsung tanpa AI, dibagi seksi (Klip, Teks, Gambar, Kamera, Audio):
   - Klip sumber terpilih, bagian yang dihapus manual (Pulihkan), split, gabungkan batas split.
   - Judul & overlay (＋ Teks; animasi blur-slide, kinetik, hook, lower third).
   - Keyframe transform (posisi, skala, rotasi, opacity di playhead).
   - Kamera: kamera otomatis AI (toggle), preset gerakan di playhead (push-in, pull-back, pan, zoom), hapus semua gerakan otomatis.
   - Kontrol parameter dari registri "Pengaturan lanjutan" (slider, warna, enum, toggle), masing-masing dengan "Kembalikan ke bawaan gaya".
3. **Usulan** (Auto cut): daftar usulan cut dari AI. Tiap usulan menampilkan jenis (retake, salah ucap, koreksi diri, filler, jeda panjang, tidak bisa dinilai), rentang waktu, kutipan teks, alasan, dan untuk retake: "take terakhir dipertahankan karena…". Aksi per usulan: Setujui / Tolak / geser batas / Lihat (putar tanpa menyetujui). Aksi massal: Setujui yang belum diputuskan, Tolak yang belum diputuskan, Kembalikan semua ke belum diputuskan. Ringkasan: jumlah per status dan total detik yang terpotong. Kotak **Auto cut**: pilih provider + model, jalankan, lihat progres dan run sebelumnya.
4. **Transkrip**: teks per kata yang bisa dicari (Ke hasil pertama), klik kata = loncat ke detik itu, kata yang terpotong tampil dicoret, kata ragu (confidence rendah) ditandai. Aksi: Perbarui transkrip.
5. **Media**: semua video dalam project (thumbnail, durasi, ukuran), unggah tambahan, urutan klip (seret di timeline), status salinan pratinjau dan reduksi noise per file.

**Panel properti kanan** (bisa ditutup), berisi seksi:
- **Usulan terpilih** (bila sebuah usulan di timeline diklik).
- **Gaya video**: preset (Modern, Motion, dll.) dengan thumbnail.
- **Judul motion** (daftar judul aktif).
- **Pratinjau**: Muat ulang preview, kualitas.
- **Ekspor**: tombol, progres, riwayat hasil.

**Timeline** (waktu hasil, seperti CapCut: klip rapat tanpa celah, hapus = ripple)
- Ruler dengan zoom (Perbesar/Perkecil/Muat seluruh video), playhead yang bisa diseret, "Perluas / ringkas timeline".
- Lane: **Video** (blok per file/klip; trim dengan menarik tepi, termasuk memunculkan lagi bagian terpotong), **Audio** (waveform), **Subtitle** (blok per halaman, bisa diedit/trim; ＋ subtitle manual di playhead), **Judul**, **Usulan cut** (multi-baris bila tumpang tindih; warna per status), **SFX** (penanda di waktu; geser untuk memindah), dan blok **Klip akhir** di ujung.
- Toolbar: **Auto cut**, **Auto subtitle**, **Kurangi noise**, **SFX** (pustaka efek suara, dengan pencarian, pratinjau, dan "Tambah di playhead"), **Klip akhir**, Split (S), Hapus (Delete), Duplikat.
- Seleksi klip membuka propertinya. Pintasan keyboard tampil di tooltip.

**Keadaan khusus workspace:** transkrip belum ada (Auto subtitle/Auto cut akan membuatnya); auto cut berjalan; konflik simpan ("Buang edit lokal & muat server"); preview gagal ("Muat ulang preview"); worker lama atau CLI belum login (kartu status sistem).

### 5.4 Workspace Motion (Motion, Animasi, Opinion Motion)

**Halaman brief** (pertama kali masuk project): satu kolom terpusat, maksimal ±880px.
- Eyebrow jenis (MOTION GRAPHICS / ANIMASI / OPINION MOTION) + judul + penjelasan singkat.
- Textarea brief + chip contoh per jenis. Motion: Intro logo, Grafik angka, Ajakan bertindak, Judul bab. Animasi: Kisah pelanggan, Explainer bergambar, Sejarah singkat, Maskot. Opinion: Editorial gelap, Bersih & terang, Cepat & energik.
- **Voice over** (opsional untuk Motion/Animasi, **wajib** untuk Opinion): "Buat dari naskah" (suara pengguna dikloning; rekam suara sekali untuk semua project) atau "Unggah voice over jadi". Naskah baca hasil arahan AI bisa diedit.
- Pengaturan: rasio, durasi (3–60 dtk; mengikuti voice over/musik bila ada), subtitle otomatis + gaya, bahan (logo, gambar, musik, dokumen knowledge PDF/TXT/MD, link knowledge), data CSV untuk grafik, design system PDF.
- CTA sesuai jenis + estimasi waktu ("±2–8 menit", atau "Suara dulu, lalu…").

**Workspace** (tiga kolom):
- **Kiri:** panel versi Mode Kreatif (kolom revisi, kartu versi seperti 5.3).
- **Tengah:** preview + info (rasio, resolusi, durasi, "dengan voice over/musik") + peringatan error kode di sebagian frame ("Minta revisi 'perbaiki error'") + hasil ekspor.
- **Kanan (tab):** Pengaturan · Voice over · SFX, ditambah **Aset** untuk Opinion Motion.
- Header: nama, jenis, **Ekspor MP4**.
- **Area preview saat belum ada versi** adalah layar status besar, dengan teks tahap ("Tahap 1/2 · Membuat suara… 42%", "Versi pertama sedang dibuat…"). Opinion Motion memakai tiga tahap, lihat 5.5.

**Panel Voice over:** rekaman suara pengguna (rekam, putar, ulang; meter level; peringatan terlalu pelan), naskah, naskah baca per segmen yang bisa diedit, progres panjang (chunk per kalimat), batal, hapus voice over, dan voice over aktif dengan pemutar.

### 5.5 Opinion Motion: tahap Aset (fitur paling baru)

Alur: **1 Suara → 2 Aset → 3 Motion**. Tampilkan sebagai stepper di halaman brief (peta) dan di header workspace (tahap aktif).

Setelah voice over jadi, AI riset (Claude Code atau Codex, dipilih pengguna) mencari di web: foto **tokoh** yang disebut, screenshot **berita** (dengan kutipan disorot), logo **brand**, dan foto **tempat**. **Pengguna memilih tiap aset** sebelum motion dibuat. Di motion, tiap aset muncul tepat saat disebut, dengan kredit kecil "Sumber: …" (bisa dimatikan).

**Panel Aset** (tab kanan, lebar ±380px):
- Atas: pilihan AI riset + model; kotak status riset (tahap, persen, "Pilihan dikunci sampai selesai", Batalkan); ringkasan "5 sebutan · 3 dipilih · 2 belum diputuskan" dengan bar progres keputusan; **Riset ulang semua** (konfirmasi inline: "Pilihan sekarang dilepas"); toggle kredit sumber; **Catatan riset** yang bisa dibuka (keraguan AI, misalnya "berita X tidak ditemukan"; ini informasi, bukan error); peringatan bila voice over diganti sesudah riset.
- **Kartu sebutan** (urut waktu ucap):
  - Badge jenis, nama, timestamp yang bisa diklik untuk loncat, chip status (Belum dipilih / ✓ Dipilih / Tidak dipakai).
  - Kutipan konteks dari naskah (nama ditebalkan).
  - Grid kandidat. Tokoh: 3 kolom 1:1 dengan crop ke wajah. Berita: 2 kolom 3:4 dari atas. Brand: `contain` di latar terang. Tempat: 3 kolom. Klik = pilih; yang terpilih bertanda centang + outline; ada lightbox untuk perbesar.
  - Kandidat gagal (lipat, dengan alasan).
  - Info artikel: judul halaman, tautan, media, tanggal, peringatan "Kutipan tidak ditemukan".
  - **Instruksi screenshot** (berita): fokus Judul + foto utama / Kutipan (disorot) / Bagian atas; kalimat kutipan; link lain; Ambil ulang.
  - Aksi: petunjuk + **Cari ulang**, **Unggah sendiri** + sumber untuk kredit, **Tidak dipakai** / **Pakai lagi**.
  - Status kartu: belum dipilih, dipilih (bisa diciutkan), tidak dipakai (redup), sedang diproses (skeleton), tanpa kandidat berhasil (peringatan + aksi menonjol), terkunci.
- Bawah (sticky): arahan visual motion + **Buat motion** (nonaktif sampai semua diputuskan: "Putuskan 2 sebutan lagi").
- Catatan hak cipta satu kalimat di halaman brief: kredit bukan izin.

### 5.6 Demo
Halaman showcase studi motion (pilih rasio, putar), plus kartu ajakan "Pakai di videomu". Rancang sebagai halaman pemasaran ringan yang konsisten dengan aplikasi.

## 6. Pola dan komponen lintas aplikasi

| Komponen | Kebutuhan |
| --- | --- |
| **Job status** | Satu pola untuk semua proses panjang: label tahap, progres (persen atau tak tentu), estimasi, Batalkan bila bisa, hasil/alasan gagal + Coba lagi. Varian inline (di panel), banner (di preview), dan tombol (Ekspor) |
| **Stepper tahap** | Alur bertahap: Opinion Motion (Suara → Aset → Motion), persiapan video, pipeline Mode Kreatif |
| **Pemilih provider AI** | Segmented Claude Code / Codex + dropdown model + status kesiapan (siap / belum login + cara memperbaiki). Dipakai di Auto cut, Prompt, riset aset |
| **Kartu keputusan** | Usulan cut, kandidat aset, dan versi motion memakai pola yang sama: konten, alasan AI, status, aksi utama satu klik, aksi sekunder |
| **Kartu versi** | 4 still, metadata, catatan AI terlipat, status, aksi |
| **Catatan AI** | Blok ringkas yang bisa dibuka; membedakan "catatan" (info), "peringatan", dan "gagal" |
| **Status sistem** | Indikator global + kartu langkah perbaikan (worker, CLI, migrasi) |
| **Kontrol parameter** | Slider, warna, enum, toggle dengan label, nilai, deskripsi singkat, reset ke bawaan |
| **Timeline** | Ruler, lane, blok klip (default/hover/selected/trimming/tidak aktif), playhead, waveform, penanda |
| **Lampiran** | Chip file (gambar, PDF, video referensi, screenshot) dengan thumbnail, ukuran, hapus |
| **Toast** | Konfirmasi singkat ("SFX ditambahkan di 12,40 dtk. Undo tersedia."), dengan aksi Undo bila relevan |
| **Simpan ke…** | Alur ekspor: pilih lokasi → render → simpan otomatis, dengan pesan "jangan tutup tab ini" |

## 7. Konten dan nada

- Kalimat pendek, aktif, bahasa sehari-hari yang sopan. Sapaan konsisten: pilih "kamu" atau "Anda" untuk seluruh aplikasi (sekarang campur; rekomendasi: "kamu").
- Label tombol = kata kerja + objek ("Buat motion", "Setujui yang belum diputuskan", "Ambil ulang screenshot").
- Estimasi waktu jujur ("±2–8 menit", "beberapa menit sampai beberapa jam").
- Pesan gagal: apa yang terjadi, kenapa (bila diketahui), apa yang bisa dilakukan.
- Tanpa emoji sebagai ikon UI. Pakai set ikon dari design system.

## 8. Aksesibilitas

- Semua alur bisa dijalankan dengan keyboard; pintasan editor (Spasi putar, S split, Delete, Ctrl+Z / Ctrl+Shift+Z) ditampilkan di tooltip dan daftar pintasan.
- Grid pilihan (kandidat aset, preset, versi) berperilaku sebagai radio group.
- Kontras minimal AA, termasuk teks sekunder dan warna lane timeline.
- Progres job diumumkan ke pembaca layar (`role="status"`).
- Target klik minimal 32px; blok timeline sempit tetap punya handle trim yang bisa dipegang.
- Hormati `prefers-reduced-motion` untuk animasi UI.

## 9. Responsif

- **≥1440px:** tata letak penuh (kiri ±360px, properti/kanan ±320–380px, timeline ±240px tinggi, bisa diperluas).
- **1100–1440px:** panel properti bisa disembunyikan/melayang; panel kiri menyempit.
- **<1100px:** panel kanan pindah ke bawah preview; timeline tetap di bawah.
- **Ponsel:** satu kolom, hanya untuk melihat status, memutar preview, dan memilih (usulan/aset/versi). Editing timeline tidak perlu didukung.

## 10. Data contoh untuk mockup

- **Project:** "Review Kopi Susu Gula Aren" (Video, 9:16, 3 klip, 4:12 → 3:05 setelah cut), "Intro Channel 2026" (Motion, 8 dtk), "Kisah Toko Kecil" (Animasi, 20 dtk), "Benarkah Ekonomi Kita Aman?" (Opinion Motion, 0:58).
- **Usulan cut:** retake 0:42–0:51 ("tadi saya mau bilang… maksud saya", alasan: kalimat diulang, take terakhir dipertahankan), filler 1:03 ("eh"), jeda panjang 1:20 (2,4 dtk), tidak bisa dinilai 2:10 (suara tertutup musik).
- **Riwayat prompt:** "Subtitle kuning 3 kata, kamera lebih energik, judul 'JANGAN BELI INI' di awal" → 6 operasi diterapkan, 1 ditolak ("speed ramp belum didukung").
- **Opinion Motion:** naskah tentang efisiensi anggaran. Sebutan: berita efisiensi anggaran (screenshot, dipilih), tokoh A (kandidat gagal: gambar terlalu besar), tokoh B (2 kandidat, dipilih), berita pertumbuhan ekonomi (kutipan disorot, belum dipilih), brand Gojek (logo, tidak dipakai). **Foto tokoh pakai placeholder potret anonim; jangan menggambar wajah tokoh asli.**

## 11. Yang harus dihindari

- Dialog konfirmasi untuk keputusan yang bisa di-undo.
- Menyembunyikan kegagalan, catatan AI, atau "tidak bisa dinilai".
- Banner merah besar untuk info (hak cipta, catatan AI, status sistem yang bisa diperbaiki).
- Preview mengecil demi panel. Preview adalah prioritas.
- Mengubah komponen dasar design system demi satu fitur.
- Emoji sebagai ikon, istilah teknis internal (EDL, worker, migrasi) di teks utama tanpa penjelasan.

## 12. Yang diminta dari Claude Design

1. **Beranda** (dengan project contoh dan panel buat project empat jenis).
2. **Persiapan project Video** (unggah, pipeline, siap).
3. **Workspace Video** dalam tiga keadaan:
   - **a.** tab Usulan dengan usulan cut di timeline;
   - **b.** tab Prompt mode Cepat dengan riwayat perintah;
   - **c.** tab Prompt mode Kreatif dengan kartu versi.

   Sertakan properti kanan dan timeline penuh.
4. **Halaman brief Motion** dan **halaman brief Opinion Motion**.
5. **Workspace Motion** (versi aktif) dan **Workspace Opinion Motion** dalam keadaan:
   - **a.** riset aset berjalan;
   - **b.** menunggu pilihan, dengan panel Aset lengkap;
   - **c.** motion siap.
6. **Close-up Panel Aset** dengan semua status kartu sebutan.
7. **Spesifikasi komponen** dari bagian 6, masing-masing dengan state default/hover/focus/selected/disabled/loading/error.
8. **Catatan token:** token design system yang dipakai untuk status (sukses, peringatan, gagal, info), warna lane timeline, dan turunan baru bila ada.
