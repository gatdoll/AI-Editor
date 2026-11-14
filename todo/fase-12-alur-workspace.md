# Fase 12: Semua proses di workspace

Permintaan pengguna (29 Okt 2026): proses di depan saat upload ditiadakan. User langsung masuk workspace dan bebas memilih:
- potong sendiri, atau **auto cut**;
- subtitle sendiri, atau **auto subtitle**;
- **kurangi noise**;
- lalu edit keseluruhan dengan AI (mode Cepat/Kreatif).

Alasannya: user kesulitan membayangkan hasil rekomendasi cut bila hanya melihat daftar di halaman project.

Status: **kode selesai (29 Okt 2026); tes otomatis dan typecheck lulus. Uji ujung-ke-ujung di browser menunggu worker dimulai ulang** (worker yang berjalan masih kode lama dan akan tetap mengantrekan transkrip saat upload).

## Keputusan pengguna (29 Okt 2026)
1. **Transkrip (Whisper) dibuat hanya saat diminta di workspace**, yaitu saat pertama kali menekan Auto cut atau Auto subtitle. Setelah upload, yang berjalan hanya penyiapan video.
2. **Tanpa panduan langkah.** Semua fitur tersedia bebas di workspace, dan urutannya terserah user.

## Alur baru
```
Upload -> siapkan video (checksum, metadata, salinan pratinjau bila MOV/HEVC) -> langsung bisa dibuka di workspace
Workspace (bebas, tanpa urutan wajib):
  Potong:   tarik/trim/split/hapus klip sendiri   |  Auto cut  (transkrip bila belum ada -> analisis AI -> usulan)
  Subtitle: tambah/tulis subtitle sendiri          |  Auto subtitle (transkrip bila belum ada -> subtitle dari ucapan)
  Suara:    Kurangi noise
  Edit AI:  perintah Cepat / Kreatif (fitur yang butuh ucapan meminta transkrip dulu)
```

## Desain

### 12.1 Upload tanpa proses di depan
- Ingest tetap menghitung checksum dan metadata, lalu membuat salinan pratinjau bila perlu. Sesudahnya project langsung berstatus `ready`; transkrip tidak diantrekan lagi.
- Halaman project hanya berisi unggah, progres penyiapan, dan tombol **Buka workspace**. Bagian analisis dan review di halaman project dihapus, karena sudah pindah ke workspace.
- Project lama tidak berubah: transkrip, usulan, dan subtitle yang sudah ada tetap dipakai.

### 12.2 Workspace jalan tanpa transkrip
- Editor sekarang menunggu transkrip (`words.length > 0`). Syarat itu dibuang, sehingga video, timeline, potong manual, judul, kamera, noise, dan ekspor bisa dipakai tanpa transkrip.
- Fitur yang butuh ucapan menampilkan keterangan singkat bila transkrip belum ada: Auto cut, Auto subtitle, tab Transkrip, perintah yang menyebut kata, dan Mode Kreatif. Bila perlu, fitur itu memicu pembuatan transkrip sendiri.
- Job `transcribe` diberi lanjutan: `next: "analyze"` (auto cut) atau `next: "subtitle"` (auto subtitle). Tidak perlu jenis job baru. Progresnya tampil di workspace ("Membuat transkrip… → Menganalisis…").

### 12.3 Auto cut di workspace, dan hasilnya mudah dibayangkan
- Tombol **Auto cut** ada di tab Usulan dan di bar timeline. User memilih Claude Code CLI atau Codex CLI (aturan proyek), lalu rute analisis yang sudah ada dipakai.
- Agar hasilnya terbayang:
  - usulan tampil langsung di timeline sebagai blok berwarna di atas klip yang akan dipotong;
  - **"Putar hasil cut"**: memutar video seolah semua usulan disetujui (simulasi yang sudah ada, dibuat lebih menonjol), dengan durasi sebelum → sesudah;
  - **"Dengar"** per usulan: memutar 1 detik sebelum sampai 1 detik sesudah bagian yang dipotong, lalu versi setelah dipotong, jadi user bisa membandingkan;
  - setujui/tolak per usulan atau semuanya.
- Aturan 2 tetap berlaku: usulan tidak pernah diterapkan tanpa persetujuan.

### 12.4 Subtitle: sendiri atau otomatis
- Proyek baru: subtitle tidak tampil sampai user membuatnya.
- **Auto subtitle**: membuat transkrip bila belum ada, lalu subtitle otomatis dinyalakan. Klipnya bisa diedit seperti di Fase 10.
- **Subtitle sendiri**: tombol "＋ Subtitle" di playhead menambah klip baru (default 2 detik, teks diketik) di track Subtitle. Tidak butuh transkrip.
- Keduanya bisa dicampur. Tombol "Buat ulang dari transkrip" tetap ada.

### 12.5 Kurangi noise
- Pengaturan Fase 11 dibuat lebih mudah ditemukan: tombol cepat di bar timeline/inspector (Mati, Ringan, Sedang, Kuat) beserta statusnya. Tidak butuh transkrip.

### 12.6 Uji
- Tes otomatis:
  - ingest tanpa transkrip;
  - rantai `transcribe` → `analyze`/`subtitle`;
  - editor tanpa kata;
  - subtitle manual tanpa transkrip.
- Uji klik di browser:
  - upload video baru, langsung masuk workspace;
  - potong manual;
  - auto cut, lalu "Putar hasil cut" dan "Dengar";
  - auto subtitle dan subtitle manual;
  - noise;
  - perintah AI.

## Yang sudah dibuat (29 Okt 2026)
- Worker:
  - ingest tidak lagi mengantrekan transkrip; project langsung `ready`;
  - `transcribe` menerima `next: { type: "analyze", runId, provider }` dan melanjutkan ke analisis;
  - transkrip yang gagal tidak membuat project gagal (status kembali `ready`, run analisis ditandai gagal);
  - perintah mode Cepat berjalan tanpa transkrip; perintah yang menyebut kata diberi petunjuk.
- Web:
  - rute `analyze` membuat transkrip dulu bila belum ada;
  - rute baru `POST /api/projects/[id]/transcribe` (dipakai Auto subtitle);
  - project baru dibuat dengan `captions: false`.
- Workspace:
  - jalan tanpa transkrip (`ready` tidak lagi menunggu kata);
  - `AutoCutBox` di tab Usulan: pilih provider, progres transkrip → analisis, durasi sekarang → bila semua disetujui, tombol "Putar hasil cut";
  - tombol ▶ Sebelum / ▶ Sesudah per usulan;
  - track Subtitle kosong menampilkan "✦ Auto subtitle" dan "＋ Subtitle"; "＋ Subtitle" juga ada di bar timeline (`addClip`, tanpa transkrip);
  - tombol cepat Kurangi noise (Mati, Ringan, Sedang, Kuat) di inspector.
- Halaman project: unggah, progres penyiapan, dan "Buka workspace". Transkrip dan Review dihapus dari halaman ini.

## Lanjutan (29 Okt 2026): transkrip dari video yang sudah dipotong
Permintaan pengguna: banyak take yang salah, jadi transkrip dan auto subtitle dibuat SETELAH trim/cut, bukan dari seluruh rekaman.
- Rute `transcribe` dan `analyze` (bila transkrip belum ada) mengirim `segments`: bagian yang dipertahankan dari EDL yang dirender (`lib/kept-segments.ts`, cut disetujui + trim manual). Editor menyimpan edit dulu sebelum meminta transkrip.
- Worker:
  - audio 16 kHz dipotong per sampel di Node (`extractSegmentsWav`; ffmpeg bawaan Remotion tidak punya `aselect`), lalu Whisper;
  - waktu kata dipetakan kembali ke video mentah (`packages/shared/src/transcript-segments.ts`); kata yang melintasi sambungan dijepit ke segmen titik tengahnya;
  - transkrip menyimpan `segments` (cakupan).
- Bila bagian yang terpotong dipulihkan sesudah transkrip dibuat, workspace menampilkan "Perbarui transkrip". Worker hanya mentranskrip bagian yang belum tercakup lalu menggabungkannya. Kata lama dan koreksi pengguna tidak disentuh.
- Migrasi `20261029120000_fase12_transkrip_terpotong.sql` (kolom `transcripts.segments`). Tanpa migrasi, transkrip tetap disimpan tetapi dianggap mencakup seluruh video.
- Uji (`fase12.test.ts` + 17 berkas `npm test` lulus). Whisper sungguhan pada "vid. otomasi 1 pekerjaan", potongan 0–15 dan 30–50 dtk:
  - 52 kata, sama dengan acuan transkrip penuh di bagian yang sama;
  - selisih waktu rata-rata 0,24 dtk;
  - tidak ada kata di bagian yang dipotong;
  - 22 dtk untuk 35 dtk audio.

## Risiko yang sudah diketahui
- Mode Cepat dan Kreatif saat ini mengandalkan transkrip untuk perintah yang menyebut kata ("potong bagian saat aku bilang X") dan untuk tipografi kreatif. Tanpa transkrip, perintah semacam itu dijawab "buat transkrip dulu", dengan tombol untuk membuatnya.
- Auto cut pertama kali lebih lama (transkrip + analisis), karena transkrip tidak lagi dibuat saat upload. Progres ditampilkan per tahap.
