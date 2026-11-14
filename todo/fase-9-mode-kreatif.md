# Fase 9: Mode Kreatif (AI menulis kode Remotion)

Permintaan pengguna (28 Okt 2026): skill dari [remotion-dev/skills](https://github.com/remotion-dev/skills), [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft), dan [claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) harus bisa dipakai maksimal dari prompt. Mode cepat (Fase 8, operasi tertutup) hanya bisa memakai efek yang sudah diprogram. Hasilnya jauh di bawah menjalankan repo itu langsung, karena di sana agen **menulis kode baru** untuk tiap video.

Status: **9.0 sampai 9.3 selesai; 9.4 selesai di kode, menunggu uji klik di browser. Render MP4 tidak stabil di mesin ini karena memori, terpisah dari Fase 9.** Keempat keputusan di bawah disetujui pengguna pada 28 Okt 2026 ("Oke mulai").

## Ide inti
Mode Kreatif adalah mode KEDUA di kolom prompt, bukan pengganti:
- **Cepat** (yang sekarang): prompt -> operasi tertutup -> detik. Tetap ada.
- **Kreatif**: prompt -> Claude Code CLI dengan ketiga skill -> menulis komponen Remotion khusus project ini -> divalidasi kode kita -> tampil sebagai layer di atas video hasil EDL. Butuh beberapa menit.

Video tetap dibangun dari EDL dan gaya yang sudah ada. Mode Kreatif hanya MENAMBAH dua slot:
1. `CreativeOverlay`: layer layar-tetap di atas video, untuk tipografi kinetik, judul, lower third, grafis, highlight, dan transisi overlay. Bisa memilih menggantikan subtitle bawaan.
2. `CreativeVideo` (opsional): gerakan video seperti whip, shake, tilt, dan zoom. Bentuknya **fungsi murni** `(frame, data) => { transform, filter, opacity }`, bukan komponen pembungkus. Video tidak di-remount tiap frame, dan error di satu frame cukup ditangkap dengan try/catch. Subtitle dan overlay TIDAK terkena gerakan ini (aturan 4).

## Keputusan yang perlu disetujui pengguna
1. **Melonggarkan aturan "himpunan operasi tertutup"** khusus untuk Mode Kreatif. Batasnya tetap: kode AI tidak bisa memotong, tidak menyentuh EDL, dan tidak menyentuh file mentah. Aturan 1 dan 2 tetap utuh.
2. **Transkrip (kata + waktu) dikirim ke AI** di Mode Kreatif. Tanpa itu, tipografi tidak bisa sinkron dengan ucapan. Mode cepat tetap tidak mengirim transkrip.
3. **Provider: Claude Code CLI dulu.** Skill berformat Claude Code; Codex menyusul bila skill bisa dibaca setara.
4. Model bawaan Mode Kreatif: **Opus 5.5**. Lebih lambat dan lebih mahal kuota, tetapi kualitas kode motion jauh lebih baik.

## Cara kerja (desain)

### Satu jalur kode untuk pratinjau dan render
Kode AI disimpan sebagai **string TSX** (satu file, satu `export default`), lalu di-compile **saat runtime** di dalam komposisi (`sucrase`/`@babel/standalone`). Komposisi yang sama dipakai Player di browser dan renderer di worker. Akibatnya:
- Tidak perlu membangun ulang bundle Next.js atau bundle render per prompt.
- Pratinjau = hasil render (prinsip EDL tetap: satu sumber kebenaran).
- Pola ini harus dibuktikan dulu di 9.0 sebelum yang lain dikerjakan.

### Batas yang diberikan ke kode AI (scope tertutup)
- Hanya tersedia: `React`, API `remotion` yang di-whitelist (`useCurrentFrame`, `interpolate`, `spring`, `Easing`, `AbsoluteFill`, `Sequence`, `random`, dsb.), font yang sudah dimuat, dan props data project.
- Props data: kata + waktu di timeline HASIL (sesudah cut), halaman subtitle, durasi, fps, ukuran, warna gaya, kata kunci, dan waktu sambungan cut.
- Ditolak sebelum dijalankan: `import`/`require`, `fetch`, `XMLHttpRequest`, `eval`/`Function`, `window`/`document`/`localStorage`, `Math.random` (harus pakai `random()` Remotion agar deterministik), dan kode > 60 KB.
- Error saat render satu frame: layer kreatif dimatikan untuk frame itu (error boundary), video tetap jalan, dan error dilaporkan. Tidak pernah gagal diam-diam.

### Job `creative` di worker
1. Siapkan folder kerja sementara: salin skill ke `.claude/skills/` (`remotion-best-practices`, Shotcraft `SKILL.md` + `references/`, toolkit `lib/` + docs). Isi juga `brief.json` (data project), `contract.md` (props, slot, dan aturan scope), dan contoh komponen kosong.
2. Jalankan `claude -p` dengan model pilihan. Tool hanya Read/Write/Edit/Glob/Grep di folder kerja; tanpa Bash dan tanpa jaringan. Keluaran: `CreativeOverlay.tsx` (+ opsional `CreativeVideo.tsx`) dan `notes.md` (apa yang dibuat, skill/resep yang dipakai).
3. **Validasi oleh kode kita**:
   - pemeriksaan statis scope
   - compile
   - render 4 still (awal, tengah, sambungan cut, akhir) dengan renderer sungguhan
   - cek tidak ada error dan frame tidak kosong
4. Gagal: kirim error ke Claude untuk diperbaiki, maksimal 2 putaran. Masih gagal: laporkan dengan jujur, tidak ada yang diterapkan.
5. Lolos: simpan sebagai **versi baru** (belum aktif sampai pengguna melihatnya; lihat 9.4).

### Data
- Tabel baru `creative_versions`: `id, project_id, prompt, model, code_overlay, code_video, notes, stills[], status (draft|aktif|ditolak|gagal), error, duration_ms, created_at`.
- `projects.style.creativeId` menunjuk versi aktif. Render memakai versi yang tercatat di job render.
- Batal = aktifkan versi sebelumnya atau matikan Mode Kreatif. Versi lama tidak pernah dihapus otomatis.

## Langkah

### 9.0 Bukti konsep (selesai 28 Okt 2026: LAYAK)
- [x] Kode contoh tulisan tangan (`creative/sample.ts`: hook dari 3 arah, caption 3 kata dengan scale-pop, kata kunci berkotak menyapu, whip + blur di sambungan, punch-in di kata kunci) disimpan sebagai string, di-compile runtime dengan `sucrase` 3.35.0, dan tampil **identik** di Player browser (`/demo/creative?frame=N`, dipotret Chrome headless) dan `renderStill` worker pada frame 20/137/154. Font, posisi, kotak aksen, dan blur sama.
- [x] Ukuran: compile 16 ms per kode (sekali per versi, di-cache); render MP4 270 frame 7,5 dtk dengan kode kreatif vs 6,8 dtk tanpa (+~10%); `sucrase` ESM ~620 KB di disk sebelum minify (ukuran tambahan bundle web belum diukur dengan build produksi).
- [x] Error boundary: overlay yang sengaja melempar error di frame 150 hanya hilang di frame itu. Video tetap tampil, error tercatat di log render (`[kreatif] overlay: frame 150: sengaja`), frame lain normal. Fungsi video yang error di satu frame = tanpa efek di frame itu (tes).
- [x] Scope tertutup: 12 pola ditolak sebelum dijalankan (jaringan, DOM, storage, eval/Function, constructor, Math.random, modul selain react/remotion, API remotion di luar whitelist, timer, import dinamis, tanpa export default, >60 KB); nilai CSS `url(...)` dibuang (`apps/worker/test/creative.test.ts`).
- [x] Font yang dimuat disediakan ke kode lewat `data.fonts` (ditemukan saat uji: di browser font tidak termuat bila komposisi tidak mengimpor modul font).
- [x] Slot sudah tersambung di komposisi `Edited` (prop `creative`), tetapi **belum diuji dengan video sungguhan** (dikerjakan di 9.3).
- Alternatif bundle-per-versi tidak diperlukan.

### 9.1 Data dan kontrak (selesai 28 Okt 2026; migrasi sudah dijalankan pengguna, constraint `jobs_type_check` terverifikasi memuat 'creative')
- [x] Migrasi `supabase/migrations/20261028120000_fase9_kreatif.sql`: tabel `creative_versions` (kolom sesuai desain + `replaces_captions`), job type `creative`, satu versi `aktif` per project (indeks unik parsial), versi bisa dipakai wajib punya kode, versi `gagal` wajib punya alasan, batas kode di SQL = `CREATIVE.maxCodeBytes` (dijaga tes). `style.creativeId` tanpa kolom baru: `normalizeStyle` menyimpannya hanya bila uuid, dan kuncinya tidak muncul pada project lama.
- [x] Tipe `CreativeProps` (`contract.ts`) dan `CreativeVersionRow`/`CreativeStatus` (`@app/shared`). `contract.md` dibangun oleh `buildContract()` (`creative/contract-doc.ts`) dari konstanta yang sama dengan validator (daftar API remotion, daftar larangan, batas ukuran), jadi tidak bisa berbeda dari yang ditegakkan. File ditulis ke folder kerja di 9.2. Tes memastikan kedua contoh kode di dalamnya lolos validator dan semua field `CreativeData` tercantum.
- [x] Validator diperketat dan diuji (`apps/worker/test/creative-contract.test.ts`, 24 pola buruk, 6 pola sah): alias (`const w = window`, `const F = Function`, `const e = eval`), re-export / `import "x"` dari modul lain, `this`/`arguments`, `Reflect`/`Proxy`/`getPrototypeOf`, `Date.now`/`new Date`, penyusun string (`fromCharCode`, `atob`, escape `\x`/`\u`), akses properti lewat string literal. Literal array `["A", "B"]` dan CSS `top:` tetap lolos.
- **Batas yang diketahui**: ini pemeriksaan teks, bukan sandbox. Penyerang yang sengaja menyusun nama properti dari variabel (`const k = a + b; x[k]`) masih bisa lolos. Cukup untuk kode yang salah (halusinasi AI, kalimat ucapan yang menyusup ke prompt) pada pemakaian sendiri; **wajib diganti pemeriksaan berbasis AST atau iframe terisolasi sebelum Fase 7 (multi-user)**.
- Kata terlarang ditolak juga di komentar dan string (misalnya "Function", "window"). Disengaja, dan `contract.md` memberi tahu AI.

### 9.2 Worker (selesai 28 Okt 2026, termasuk uji ujung-ke-ujung)
- **Uji nyata** (project "Tes Fase 3", video sintetis 33 dtk, 2 cut, keluaran 9:16, Opus 5.5): lolos di putaran pertama dalam 178 dtk, versi `draft` + 4 still + `skill_refs` tersimpan. Still menunjukkan hook dari atas, caption scale-pop, kotak aksen, streak + blur whip di sambungan, subtitle bawaan disembunyikan (`replaces-captions`). AI mencatat resep Shotcraft `shot-transitions.md` (whip-pan) di notes.md. Kekurangan kualitas yang terlihat: caption 1 kata rata kiri (keputusan tata letak AI). Ini contoh kenapa versi tidak langsung aktif.
- Percobaan pertama gagal jujur (versi `gagal`, tidak ada yang diterapkan): folder kerja memakai nama pendek Windows (`AILAB~1`), sehingga izin `./**` tidak cocok dan agen tidak bisa membaca berkas di foldernya sendiri. Diperbaiki dengan `realpathSync.native` + tes regresi.
- Dari uji nyata juga diperbaiki: `brief.json` kini memakai bentuk `data` yang sama persis dengan props (sebelumnya `fonts` berupa array), dan still "sambungan" memilih sambungan di tengah video (sebelumnya sambungan di 0,13 dtk tertumpuk dengan animasi pembuka).
- [x] Folder kerja di temp OS (di luar repo, agar CLAUDE.md proyek tidak terbaca): `.claude/skills/{remotion-best-practices, video-shotcraft, video-toolkit}` + `brief.json` (prompt + kata/sambungan pada timeline hasil) + `contract.md` + komponen awal kosong (`apps/worker/src/creative/workdir.ts`). Sumber skill dipin ke commit di `CREATIVE.skills` (sama dengan `scripts/studio-reference.mjs`, dijaga tes); checkout yang hilang diunduh sparse, checkout beda commit TIDAK diubah (job gagal jelas). Commit dicatat per versi di kolom `skill_refs` (**migrasi `20261028140000_fase9_2_skill_refs.sql` perlu dijalankan**).
- [x] `runAgent` di `analyze/providers.ts`: Claude Code CLI dengan `--tools Read,Write,Edit,Glob,Grep,Skill`, semua tool berkas dibatasi `./**`, `--permission-mode dontAsk`, `--setting-sources project`, tanpa MCP/Chrome, env tanpa kunci Supabase/API key. **Diuji langsung dengan CLI 2.1.310 (Haiku)**: skill terbaca, Write di folder kerja jalan, Read/Write di luar folder ditolak, Bash tidak tersedia. Temuan: Grep TANPA batas path bisa membaca berkas di luar folder kerja, karena itu semua dibatasi `./**`. Codex: ditolak dengan pesan jelas (keputusan 3).
- [x] Putaran (`creative/loop.ts`): agen -> scope + compile + bentuk export + fungsi video tidak melempar -> 4 still dengan komposisi `Edited` sungguhan (awal, tengah, sambungan +3 frame, akhir; di tengah kata) -> error `[kreatif]` dari log browser = gagal -> layer tidak mengubah satu piksel pun di semua still = gagal "tidak terlihat". Gagal: error dikirim balik (maks 2 perbaikan). Lolos: versi `draft` + still disalin ke `projects/<id>/creative/<versi>/`. Gagal akhir: versi `gagal` dengan alasan dan kode terakhir. Tahap (`stage`, `stageLabel`, `round`) ditulis ke `jobs.payload` untuk UI.
- [x] Batas waktu total 10 menit (`CREATIVE.timeoutMs`) dan pembatalan: worker memeriksa `jobs.status = 'cancelled'` tiap 2 dtk lalu menghentikan CLI. `main.ts` tidak lagi menimpa status `cancelled` menjadi done/failed (berlaku semua jenis job). Tombol batal di UI = 9.4.
- Uji: `apps/worker/test/creative-worker.test.ts` (tanpa CLI/Chrome). Uji nyata: `npm run creative-smoke -w @app/worker -- <projectId> "<prompt>" [model]`.
- Catatan: kamera pada still memakai seed dari segmen; render final memakai seed EDL tersimpan, jadi gerak kamera di still bisa sedikit berbeda. Layer kreatif sendiri tidak ikut kamera, jadi tidak terpengaruh.

### 9.3 Komposisi (selesai 28 Okt 2026; pratinjau di browser belum diuji)
- [x] Slot `CreativeVideo` (di dalam MotionStage + FxStage, membungkus kamera) dan `CreativeOverlay` (di atas, di luar kamera). Posisi slot sudah dari 9.0. Yang baru: `buildEditedProps({ creative })` mengisi `props.creative` dengan kata pada timeline hasil (fungsi yang sama dengan `brief.json`), sehingga editor, halaman Review, dan worker membangun props dari satu fungsi. Tes: layer kreatif tidak mengubah props lain (EDL, kamera, subtitle, durasi).
- [x] Pilihan "overlay menggantikan subtitle bawaan" (`replaces_captions`, dari baris pertama notes.md). Bawaan: subtitle tetap tampil.
- [x] Error boundary per frame (dari 9.0) + laporan: editor menampilkan kotak peringatan di atas pratinjau (tidak menutup video, maks 5 pesan). Render MP4 menangkap `[kreatif]` dari log renderer ke `jobs.payload.creativeErrors`.
- [x] Satu pemuat versi `loadCreativeCode` (`@app/shared/creative-store`) untuk web (`GET /api/projects/[id]/creative/[versionId]`, hook `useCreativeCode` mengikuti `style.creativeId`) dan worker. Versi hilang, milik project lain, `gagal`, atau tanpa kode: pratinjau menampilkan pesan, render GAGAL dengan pesan (tidak diam-diam tanpa layer). Render memakai `creativeId` di gaya yang tercatat di job, dan mencatat `creativeVersionId` di payload.
- **Uji nyata MP4 penuh** (`npm run render-creative -w @app/worker -- <projectId> <versionId>`, tanpa menulis DB): versi draft dari 9.2 -> 1080x1920, 26,0 dtk (33,3 dtk dikurangi 2 cut), ada audio, 44 kata kreatif, 0 error kode kreatif. Frame MP4 menunjukkan hook + caption kreatif, subtitle bawaan tersembunyi. Hash file mentah sama dengan saat ingest.
- **Masalah render yang TIDAK terkait Mode Kreatif**: dari 9 percobaan render MP4 di mesin ini, 8 gagal di compositor Remotion (`Output changed`, lalu `memory allocation ... failed`, `EPIPE`). Skrip render lama tanpa kode kreatif (`render-smoke --full`) gagal dengan cara yang sama. Saat itu commit memori Windows 24,4 / 29,8 GB terpakai (CapCut, Chrome, dll.). Kandidat perbaikan terpisah: batasi `concurrency` dan cache OffthreadVideo di `renderMedia`.
- Belum: potret Chrome editor dengan versi aktif. Versi belum bisa diaktifkan tanpa mengubah project, dan itu keputusan pengguna (9.4).

### 9.4 Antarmuka (kode selesai 28 Okt 2026; klik Aktifkan dan perintah lanjutan belum diuji di browser)
- [x] Sakelar **Cepat / Kreatif** di tab Prompt (perkiraan waktu di tombol, model dipilih di kolom; tanda ● bila ada versi aktif). Tautan langsung `?mode=kreatif`. Panel: `editor/CreativePanel.tsx`.
- [x] Progres bertahap dari `jobs.payload.stage` (skill -> menulis -> validasi -> still -> simpan, plus "perbaikan ke-N") dan tombol **Batalkan** (`POST /api/projects/[id]/creative/cancel`).
- [x] Kartu versi (terbaru di atas): 4 still berlabel, catatan AI, status, model, durasi. Tombol **Aktifkan**, **Tolak**/**Pulihkan**, **Lanjutkan dari versi ini**, **Kembali ke versi N** (versi sah terbaru sebelum yang aktif), **Matikan Mode Kreatif**. Versi gagal menampilkan alasannya apa adanya. Versi tidak pernah dihapus.
- [x] Mengaktifkan = `updateStyle({ creativeId })` lewat penyimpanan gaya editor, jadi ikut undo/redo, pemeriksaan konflik, dan peringatan belum tersimpan. `PUT /style` menolak versi hilang/gagal/ditolak dan menyelaraskan status `aktif` (`syncActiveCreative`: turunkan dulu, baru naikkan; dites).
- [x] Perintah lanjutan: bawaan "Ubah versi aktif" (kotak centang). Worker menulis kode + catatan versi dasar ke folder kerja, AI diminta MENGUBAH dengan Edit. Hasil yang sama persis dengan versi dasar dianggap belum menerapkan permintaan (dikirim balik ke AI).
- [x] Tampilan kode baca saja (`GET .../creative/[versionId]/code`, semua status termasuk gagal). Still disajikan dari `GET .../still/[index]` (path diambil dari DB, dibatasi ke folder kreatif versi itu).
- **Uji pengguna pertama (Video-1, brief panjang, Opus): GAGAL `ENOSPC`.** AI sudah menulis kode + catatan lengkap (5 mnt 45 dtk), tetapi drive C: tinggal 30 MB: Remotion meninggalkan 63 bundel webpack (2,1 GB) + 139 folder aset salinan video (2,7 GB) di `%TEMP%`. Perbaikan: `apps/worker/src/temp-dir.ts` mengarahkan TEMP worker ke `H:\editing-video-tmp` (di luar repo dan drive sistem; ganti lewat `WORKER_TMP_DIR`), membersihkan sisa saat worker mulai dan tiap jam (hanya nama Remotion/folder kerja, hanya yang tua; dites). Sisa lama di C: dihapus pengguna.
- Juga dari uji pengguna: worker lama (dimulai sebelum Fase 9) tidak pernah mengambil job `creative` dan UI menunggu tanpa batas. Kini worker melaporkan `jobTypes`, panel menampilkan peringatan "mulai ulang aplikasi".
- Diperiksa dengan potret Chrome headless (1440×900 dan 1440×1400): panel, kartu, still, versi gagal. Di 900 px daftar versi sempit (dapat digulir), batas yang sama dengan panel Cepat.

### 9.5 Uji
- [ ] Tes otomatis: validator scope, compile, error boundary, pemetaan waktu kata melewati cut
- [ ] Uji nyata: brief panjang pengguna ("GAYA VISUAL… CAMERA MOVEMENT… TYPOGRAPHY…") pada video pengguna, dibandingkan dengan menjalankan repo langsung
- [ ] Uji gagal: prompt yang memancing kode terlarang; kode yang error di tengah video
- [ ] Render MP4 penuh dari versi aktif; hash file mentah tidak berubah

## Risiko yang sudah diketahui
- **Waktu dan kuota**: satu perintah kreatif bisa 2–8 menit dan memakai kuota Opus jauh lebih banyak dari mode cepat.
- **Hasil tidak selalu bagus**: validasi hanya menjamin tidak error, bukan indah. Karena itu versi baru tidak langsung aktif.
- **Keamanan**: kode AI berjalan di browser pengguna dan Chrome headless worker. Untuk pemakaian sendiri risikonya kecil; dengan scope + pemeriksaan statis ini cukup. **Wajib ditinjau ulang sebelum Fase 7 (multi-user).**
- **Lisensi**: Shotcraft Apache-2.0 dan toolkit MIT. Kode yang ditulis AI dari resep mereka perlu atribusi bila dijual (catat di Fase 7).
- **Speed ramp** (mengubah kecepatan video dan audio) tetap di luar Mode Kreatif tahap ini, karena memengaruhi pemetaan waktu EDL. Kandidat fase berikutnya.

## Selesai jika
Pengguna mengetik brief gaya bebas di mode Kreatif, melihat 4 still hasilnya dalam beberapa menit, mengaktifkannya, memutar pratinjau yang sama persis dengan hasil render MP4, dan bisa kembali ke versi sebelumnya. Semua itu tanpa membuka terminal, tanpa cut yang tidak disetujui, dan tanpa file mentah berubah.
