# Fase 1: Riset dan Rekomendasi

Dibaca 27 Okt 2026 lewat WebFetch (ringkasan halaman, bukan membuka repo lokal). Status tiap klaim: **[Terbaca]** dari halaman, **[Belum terverifikasi]** belum bisa dipastikan.

## 1. Perbandingan

| | A. Recorder | B. Template Next.js | C. Editor Starter |
|---|---|---|---|
| Sumber | github.com/remotion-dev/recorder | `create-video --next` (repo `template-next-app-dir`) | remotion.dev/editor-starter |
| Isi | Template perekaman/editing video di JS; Whisper.cpp lokal otomatis, caption per kata (JSON, bisa dikoreksi), trim hening di awal/akhir take, layout, transisi, B-roll, musik [Terbaca, docs] | Next.js App Router + `@remotion/player` + `@remotion/lambda`; render lokal atau Lambda via `deploy.mjs` [Terbaca] | Timeline, canvas, font picker, upload aset, 80+ feature flag [Terbaca] |
| Status | Ada di daftar template resmi [Terbaca]; kondisi perawatan [Belum terverifikasi] | **Repo diarsipkan, README: "discontinued"** [Terbaca] | Ada di daftar template resmi |
| Multi-user | Tidak disebut; tampak alur satu pengguna [Belum terverifikasi] | Tidak ada auth/DB bawaan [Terbaca dari daftar file] | Tidak disebut |
| Potong retake | Tidak disebut (hanya hening awal/akhir) | Tidak ada | Tidak ada |
| Biaya | Gratis | Gratis | **$600** sekali beli per project |
| Lisensi | Lisensi Remotion (README tidak menyebut lisensi lain) | Lisensi Remotion | Remotion + lisensi Editor Starter sendiri |
| Catatan lisensi | Sama dengan Remotion | Sama dengan Remotion | Boleh komersial dan boleh diintegrasikan ke project untuk end user. **Dilarang** ditanam di project lain yang dijual sebagai produk mandiri, dan source tidak boleh didistribusikan ulang. Beli sekali per project. |

LICENSE.md Recorder di path `main/LICENSE.md` memberi 404; tidak dibaca langsung. Teks lisensi Remotion dibaca dari halaman LICENSE.md repo utama.

## 2. Temuan penting yang mengubah asumsi brief

1. **Template Next.js dari `create-video --next` sudah discontinued dan arsipnya read-only.** README menyuruh melihat remotion.dev/templates. Artinya opsi B di brief tidak bisa dipakai apa adanya sebagai fondasi jangka panjang.
2. Daftar template resmi sekarang memuat pengganti: **Next.js** (SaaS template untuk video generation), **Next.js (Vercel Sandbox)**, **React Router 7**, **Render Server (Express.js)**, **Prompt to Motion Graphics SaaS Starter Kit**. Belum dibuka satu per satu; deployment dan status perawatannya [Belum terverifikasi].
3. Recorder **tidak** punya deteksi retake/koreksi/filler. Yang bisa dipinjam hanya alur Whisper.cpp dan penyimpanan caption JSON. Deteksi tetap dibangun sendiri (Claude + ffmpeg).
4. Lisensi Remotion: gratis untuk individu dan for-profit sampai 3 karyawan; dilarang menyalin/memodifikasi kode Remotion untuk dijual/disewakan/dilisensikan ulang. Halaman **tidak membahas SaaS atau kode unggahan pengguna**; larangan upload kode sendiri dari brief tidak terkonfirmasi di sini. Lisensi akan berubah di Remotion 5.0.
5. Editor Starter $600 menambah beban lisensi tanpa memberi apa yang dibutuhkan MVP (deteksi cut, review). Frasa "dijual sebagai produk mandiri" perlu ditafsirkan jika kelak aplikasi dijual. Tanyakan ke Remotion sebelum membeli.

## 3. Rekomendasi

**Mulai dari template Next.js terbaru di remotion.dev/templates (bukan repo yang diarsipkan), dengan Recorder sebagai referensi Whisper.** Tidak membeli C.

Alasan:
- Kebutuhan MVP (upload, review cut, render) adalah aplikasi web biasa, dan template Next.js sudah membawa Player dan jalur render.
- Recorder dibangun untuk alur rekam sendiri; mengubahnya jadi aplikasi upload multi-project lebih berat daripada memulai bersih.
- C berbayar, berlisensi tambahan, dan fitur utamanya (timeline manual) di luar lingkup MVP.

Cara memilih template pengganti (tugas awal Fase 1 setelah persetujuan): buka README tiap kandidat (Next.js, Next.js Vercel Sandbox, React Router 7, Render Server). Syarat: dirawat, versi Remotion terbaru, ada jalur render yang tidak terikat Vercel jika hosting nanti VPS. Kalau tidak ada yang cocok, mulai dari Blank + Next.js sendiri; ini tidak banyak lebih berat karena kita tetap menulis UI sendiri.

Tingkat keyakinan: arah (bukan C, Recorder hanya referensi) **Likely**; pilihan template Next.js spesifik **belum diverifikasi**.

## 3b. Revisi setelah jawaban pengguna (hosting VPS + Coolify + Supabase)

Dibaca: halaman template Next.js, Render Server, dan docs Docker Remotion.

- Template Next.js terbaru (`template-next-app-dir-tailwind`) merender lewat **Lambda (AWS)**. Tidak cocok untuk VPS Coolify. Status perawatannya tidak dinyatakan di halaman.
- Template Render Server (Express) hanya dideskripsikan "start, track, cancel renders". Endpoint dan Dockerfile **belum terverifikasi** (repo `remotion-dev/template-render-server` belum dibuka).
- Docs Docker Remotion: base `node:22-bookworm-slim` (Debian, bukan Alpine), pasang library Chrome lewat apt, `npx remotion browser ensure`, set `enableMultiProcessOnLinux: true`, batasi CPU via `--cpus`. Tidak ada panduan memori.

**Keputusan yang diusulkan:** tidak memakai template. Buat `create-next-app` biasa, tambahkan paket Remotion sendiri, dan pisah jadi **dua service di Coolify**:
1. `web`: Next.js (UI, API ringan, Remotion Player). Tidak mengimpor `@remotion/renderer`.
2. `render-worker`: Node + Docker sesuai docs, mengambil job dari tabel `render_jobs` di Supabase, merender dengan `@remotion/renderer`, mengunggah MP4 ke Supabase Storage.

Alasan: sumber template yang dirawat tidak cocok dengan hosting Anda, UI tetap harus ditulis sendiri, dan memisahkan worker menjaga web tetap ringan serta render tidak mati bersama web. Antrean memakai Postgres (Supabase), tanpa Redis. Transkrip (Whisper.cpp) dan ffmpeg juga berjalan di worker, bukan di web.

Konsekuensi: struktur di bagian 4 jadi monorepo `apps/web` + `apps/worker` + `packages/remotion` (komposisi bersama) + `config/`. Lisensi: pemakaian sendiri oleh satu orang, gratis di bawah lisensi Remotion.

## 3c. Revisi: analisis cut lewat CLI, bukan API key

Keputusan pengguna: tidak memakai Anthropic API key; memakai Claude Code CLI dan Codex CLI. Terverifikasi di mesin lokal: `claude` 2.1.310 (login claude.ai) punya `-p/--print` dan `--json-schema`; `codex` 0.163.0 (login ChatGPT) punya `codex exec --output-schema` dan `--json`.

Konsekuensi:
- Worker memanggil CLI sebagai subproses; web tidak pernah memanggilnya (aturan 6 tetap terjaga).
- Di VPS, CLI harus login di dalam container worker dan kredensialnya disimpan di volume. Cara login non-interaktif di container **belum diuji**.
- Pemakaian dihitung ke langganan, jadi ada batas pemakaian dan latensi lebih tinggi daripada API. Belum diukur.
- Syarat layanan untuk memakai login langganan dari proses otomatis di server **belum saya verifikasi**; cek sebelum bergantung padanya.
- Skema JSON divalidasi sendiri di sisi kita; jangan percaya output CLI begitu saja.

### Pilihan provider (revisi lanjutan)
Kedua CLI harus tersedia sebagai pilihan pengguna, bukan satu dikunci lewat env. Perubahan skema yang diusulkan: tabel baru

```
analysis_runs  id, project_id, provider (claude|codex), model, status, raw_output jsonb,
               error, duration_ms, created_at
```

dan `cut_suggestions.run_id` menunjuk ke `analysis_runs`. Dengan begitu analisis ulang memakai provider lain tidak menimpa hasil sebelumnya, dan kualitas keduanya bisa dibandingkan pada video uji Fase 3.

## 4. Usulan struktur folder

```
editing-video/
  CLAUDE.md                 aturan tak boleh dilanggar (brief bagian 8)
  config/
    style.ts                SATU file konstanta gaya: warna, font, durasi, easing, preset kamera
    analysis.ts             ambang jeda, daftar filler, padding 0,1 s
  src/
    app/                    Next.js (halaman + API routes)
      projects/             daftar, detail, upload
      projects/[id]/review/ layar review cut
      projects/[id]/style/  pemilih kamera + subtitle
      api/                  upload, transcribe, analyze, render, status
    server/                 kode server-only (kunci API tidak keluar dari sini)
      ingest/               ffprobe, ekstrak audio
      transcribe/           Whisper adapter
      analyze/              silencedetect, filler, panggilan Claude, validasi JSON
      edl/                  bangun/validasi EDL
      render/               job queue + worker @remotion/renderer
      db/                   klien Supabase + query
    remotion/               komposisi (bisa jalan di Player dan renderer)
      Root.tsx
      compositions/Main.tsx membaca EDL
      camera/Camera.tsx + presets
      captions/WordCaptions.tsx
    components/             UI
  supabase/migrations/
  docs/                     brief, riset, log sesi
  todo/
```

Pemisahan `server/` vs `remotion/`: kode Remotion berjalan di browser, jadi tidak boleh mengimpor apa pun dari `server/` (aturan 6).

## 5. Usulan skema database

Mengikuti bagian 7 brief, dengan tambahan yang dibutuhkan agar alur jalan.

```
projects        id, name, status, created_at
assets          id, project_id, kind (raw|audio|output), storage_path, sha256,
                duration_s, width, height, fps, created_at
transcripts     id, asset_id, language, words jsonb [{text,start,end,confidence}],
                engine, created_at
cut_suggestions id, project_id, start_s, end_s, kind (retake|correction|filler|pause),
                reason, quote, source (claude|ffmpeg), status (pending|approved|rejected),
                unassessable bool
edl             id, project_id, version, segments jsonb [{start_s,end_s}],
                camera jsonb [{segment, preset, params}], subtitle_style jsonb,
                aspect, created_at
render_jobs     id, project_id, edl_id, status (queued|rendering|done|failed),
                output_asset_id, error, started_at, finished_at
```

Perubahan dari brief, perlu disetujui:
- `assets.sha256`: bukti bahwa file mentah tidak berubah (aturan 1).
- `edl` diberi `version` dan `render_jobs.edl_id`: render selalu menunjuk EDL tertentu sehingga bisa direproduksi.
- `cut_suggestions.source` dan `unassessable`: mendukung aturan 7.
- Nama kolom pakai bahasa Inggris agar konsisten dengan kode; tabel `edit_decision_list` diringkas jadi `edl`.

## 6. Pertanyaan yang memblokir langkah berikutnya

Dari bagian 14, yang harus dijawab sebelum build: **1** (suara bicara), **2** dan **3** (dipakai sendiri/dijual, jumlah orang, menentukan lisensi), **6** (hosting: menentukan template mana yang dipakai). Sisanya (4, 5) boleh menyusul sebelum Fase 4–5. Lihat `todo/pertanyaan-terbuka.md`.
