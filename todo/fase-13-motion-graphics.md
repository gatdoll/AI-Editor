# Fase 13: Motion graphics berdiri sendiri

Permintaan pengguna (29 Okt 2026): membuat motion graphics seperti di Claude Design, langsung di aplikasi ini, dengan hasil video. Claude Code CLI (Opus 5.5) menulis kode animasi Remotion dan kode kita merendernya menjadi MP4. Jalurnya sama dengan Mode Kreatif (Fase 9), tetapi tanpa rekaman.

Status: **13.1 dan 13.2 selesai di kode (29 Okt 2026).** Tes lulus dan render komposisi Motion terbukti (still + MP4 dengan logo, grafik, musik). Menunggu dua langkah pengguna: migrasi `20261029150000_fase13_motion.sql` dan mulai ulang aplikasi; setelah itu uji nyata dengan AI. 13.3 (sisipan ke video bicara) dikerjakan sesudah uji nyata.

## Keputusan pengguna (29 Okt 2026)
1. **Dua cara pakai:**
   - **video sendiri** (project motion graphics, ekspor MP4);
   - **disisipkan ke video bicara** sebagai intro, outro, atau sisipan di tengah (B-roll) di timeline workspace.
2. **Bahan yang bisa dipakai AI:**
   - teks dan brief;
   - **logo dan gambar yang diunggah**;
   - **musik/voice over**;
   - **data/angka** (dianimasikan menjadi grafik).

## Batas yang jujur
- Ini **motion graphics dari kode**: tipografi, bentuk, ikon, grafik/angka, gambar yang diunggah, transisi, dan warna. Bukan AI video generator: tidak ada rekaman realistis yang dibuat dari nol (orang, pemandangan, 3D fotorealistik).
- Kode AI tetap berada di scope tertutup Mode Kreatif: tanpa jaringan, tanpa `eval`/`window`, dan bahan hanya dari aset project.

## Desain

### 13.1 Project motion graphics
Alur yang ditetapkan pengguna (29 Okt 2026):
```
Buat project (nama) -> pilih jenis
  Video:  alur seperti sekarang (upload -> workspace)
  Motion: halaman brief dulu (prompt + rasio + durasi + bahan opsional) -> Buat -> langsung masuk workspace;
          hasil animasi muncul di workspace begitu selesai (progres terlihat di sana)
```
- Setelah nama project diisi, user memilih jenis **Video** atau **Motion** (bukan langsung ke halaman upload). Data: kolom baru `projects.kind` (`video` | `motion`) lewat migrasi; project lama = `video`.
- Motion: halaman pertama berisi brief (prompt), lalu langsung ke workspace. Revisi berikutnya dilakukan dari workspace.
- Workspace motion graphics:
  - kolom brief;
  - pilihan rasio (16:9 / 9:16 / 4:5), durasi (3–60 dtk, atau mengikuti panjang musik), dan fps;
  - panel bahan (unggah logo, gambar, musik, data);
  - daftar versi dengan potret per versi, Aktifkan, Lanjutkan revisi, dan Lihat kode;
  - pratinjau dan Ekspor MP4 (dengan "Simpan sebagai").
- Komposisi baru `Motion`: kanvas kosong seukuran rasio dengan durasi yang dipilih, berisi komponen buatan AI dan audio musik bila ada. Komposisi yang sama dipakai pratinjau dan render.
- Worker: job `creative` diberi mode `motion`:
  - folder kerja yang sama (skill Remotion, Shotcraft, dan toolkit; `contract.md`);
  - brief berisi ukuran, durasi, palet, dan daftar bahan;
  - putaran validasi dan perbaikan yang sama, potret di awal/tengah/akhir, dan versi tersimpan.

### 13.2 Bahan untuk AI
- Unggah ke `projects/<id>/assets/`. Tiap bahan dicatat (nama, jenis, ukuran/durasi) dan masuk kontrak sebagai `data.assets`.
- Gambar/logo: AI dapat **melihat** gambar di folder kerjanya (agar animasinya pas dengan bentuk dan warna logo). Di kode dipakai lewat `<Img src={data.assets[i].src}>`.
- Musik/voice over: diputar oleh komposisi (bukan kode AI). AI menerima durasi dan, bila memungkinkan, titik ketukan atau kalimat untuk sinkronisasi.
- Data/angka: tabel kecil (ketik atau CSV) masuk sebagai `data.table`, lalu AI menganimasikannya menjadi bar, counter, atau persentase.
- `Img` (dan `staticFile` tidak) ditambahkan ke daftar API yang diizinkan. Validator tetap menolak URL di luar `data.assets`.

### 13.3 Sisipkan ke video bicara
- Di workspace video bicara: **"＋ Motion graphics"** memilih versi dari project motion graphics, lalu menentukan cara sisip:
  - **Intro / Outro**: ditaruh sebelum/sesudah video dan menambah durasi;
  - **Sisipan (B-roll)**: menutupi video di rentang tertentu. Suara bicara tetap jalan, musik motion opsional dengan volume rendah.
- Data: `style.inserts` (waktu mentah untuk sisipan; posisi awal/akhir untuk intro/outro). Track baru "Sisipan" di timeline (pilih, trim, geser, hapus), mengikuti pola klip Fase 10.
- Komposisi `Edited` diperluas: urutan **intro → segmen EDL → outro**, ditambah lapisan sisipan. Pemetaan waktu (subtitle, kamera, judul) digeser sebesar durasi intro. Ini bagian paling berisiko, jadi dikerjakan dan diuji terakhir.

### 13.4 Uji
- Tes otomatis:
  - kontrak `data.assets`/`data.table`;
  - validator menolak sumber di luar aset;
  - durasi mengikuti musik;
  - pergeseran waktu oleh intro;
  - sisipan tidak menggeser subtitle/kamera.
- Uji nyata:
  - brief "intro logo 5 detik" dengan logo yang diunggah;
  - grafik dari 4 angka;
  - motion dengan musik;
  - sisipkan sebagai intro dan B-roll ke "vid. otomasi 1 pekerjaan", lalu ekspor MP4.

## Yang sudah dibuat (29 Okt 2026)
- Data:
  - migrasi `projects.kind` (`video`/`motion`) dan aset `material` (+ `label`, `mime`);
  - `style.motion` (durasi, musik, ikuti musik, CSV) dinormalisasi di `build-props.ts`.
- Kontrak dan validator:
  - `CreativeData` mendapat `mode`, `assets`, `table`; `contract.md` punya bagian Motion (hanya untuk project motion);
  - `Img` diizinkan;
  - URL internet ditolak (namespace SVG `www.w3.org` tetap boleh).
- Remotion:
  - `motion-props.ts` (`buildMotionProps`, `motionCreativeData`, `parseTable`);
  - komposisi `Motion` (kanvas + kode AI + musik), terdaftar di Root.
- Worker:
  - `handleCreative` bercabang (`prepareMotion` / `prepareVideo`); bahan disalin ke `assets/` di folder kerja agar AI bisa melihatnya;
  - still memakai `renderMotionStill` (server lokal untuk bahan);
  - render MP4: job `render` dengan `mode: "motion"` (`creative/motion-render.ts`).
- Web:
  - beranda: nama, lalu tombol **Video** / **Motion**;
  - rute `materials` (unggah, daftar, hapus) dan `motion/render`;
  - halaman `projects/[id]/motion`:
    - pertama kali tampil brief (prompt, contoh, rasio, durasi, bahan, musik, CSV);
    - sesudahnya workspace: CreativePanel untuk versi dan revisi, pratinjau Player komposisi Motion (versi baru otomatis tampil), pengaturan, Ekspor MP4 dengan "Simpan sebagai", dan daftar hasil;
  - halaman project/editor video mengalihkan project motion ke halaman motion.
- Uji:
  - `fase13.test.ts` + 18 berkas `npm test` lulus, typecheck bersih;
  - render sungguhan komposisi Motion: logo SVG lewat `Img`, grafik dari CSV, font Montserrat, musik. Still 1080×1920 benar; MP4 3,01 dtk, ada audio, 0 error kreatif.

## Tambahan (29 Okt 2026): knowledge dari PDF/dokumen/link
Permintaan pengguna: AI menganalisis knowledge dulu, baru membuat motion, agar pesannya tepat sasaran.
- Bahan baru:
  - PDF, TXT, atau MD diunggah;
  - **link** diambil server kita, bukan agen AI yang memang tanpa jaringan (`apps/web/lib/fetch-knowledge.ts`), lalu disimpan sebagai Markdown, atau PDF bila link-nya PDF.
- Pengaman SSRF: hanya http(s) port 80/443, tanpa kredensial, semua alamat DNS diperiksa (tolak lokal, privat, link-local, CGNAT, ULA), redirect diperiksa ulang (maks. 3), batas 15 dtk dan 3 MB (PDF 30 MB). Halaman yang hampir tanpa teks (butuh JS/login) ditolak dengan saran unggah PDF/TXT.
- Worker:
  - knowledge disalin ke `knowledge/` di folder kerja;
  - instruksi sistem: baca semua knowledge (PDF lewat Read), tulis `knowledge.md` (pesan utama, audiens, poin kunci, angka/fakta dengan sumber, istilah yang harus tepat, CTA), lalu buat motion yang menyampaikannya tanpa mengarang fakta;
  - isi dokumen = data, bukan instruksi;
  - `knowledge.md` disimpan di Catatan AI versi ("## Analisis knowledge") agar pengguna bisa memeriksa tangkapan AI.
- UI: tombol unggah menerima dokumen; kolom "Tempel link knowledge" + Tambah; ikon 📄/🔗.
- Uji:
  - `fase13.test.ts`: 11 alamat internal ditolak, 6 URL buruk ditolak, HTML jadi teks (judul, ##, daftar; skrip/gaya/navigasi dibuang);
  - link sungguhan (remotion.dev/docs) terambil bersih.

## Urutan pengerjaan
13.1 → 13.2 → uji nyata video sendiri → 13.3 → uji sisipan.

## Risiko yang sudah diketahui
- Render di mesin ini dibatasi memori (RAM ~0,5–1,3 GB bebas saat uji Fase 12). Motion graphics tanpa video sumber lebih ringan, tetapi sisipan menambah beban render video bicara.
- Kualitas sangat bergantung pada brief. Contoh brief siap pakai disediakan (intro logo, lower third, grafik angka, ajakan bertindak).
- Mode Kreatif untuk video bicara saat ini butuh transkrip untuk tipografi yang sinkron dengan ucapan. Motion graphics berdiri sendiri tidak butuh transkrip.
