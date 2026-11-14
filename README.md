# Editing Video

Aplikasi web untuk mengedit video bicara: unggah video mentah, sistem **mengusulkan** bagian yang sebaiknya dipotong (retake, salah ucap, filler, jeda), Anda **menyetujui** satu per satu, lalu sistem menambah gerakan kamera dan subtitle per kata dan merender MP4.

Semua berjalan di komputer Anda. Video tidak dikirim ke layanan lain; yang keluar hanya teks transkrip ke Claude Code CLI atau Codex CLI (akun Anda sendiri) untuk analisis.

> Status: MVP berjalan, **belum diuji pada video nyata**. Lihat bagian [Batasan](#batasan-yang-harus-anda-tahu).

## Memulai

### Sekali saja (persiapan)
1. **Node.js 22+** terpasang (nodejs.org).
2. Di folder ini jalankan `npm install` satu kali.
3. **Database Supabase.** Salin `.env.example` menjadi `.env`, isi `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (kunci *publishable*), dan `SUPABASE_SERVICE_ROLE_KEY` (kunci **secret**, `sb_secret_...`; jangan dibagikan).
4. Di Supabase, **SQL Editor**, jalankan file di `supabase/migrations/` **berurutan** (salin isi, tempel, Run):
   `20261027120000_...`, `20261027140000_...`, `20261027160000_...`, `20261027180000_...`, `20261028100000_...` (Fase 8, edit lewat prompt)
5. **Windows:** pasang *Microsoft Visual C++ Redistributable x64* (https://aka.ms/vs/17/release/vc_redist.x64.exe). Tanpanya Whisper tidak bisa berjalan.
6. Login **Claude Code CLI** (`claude`) dan/atau **Codex CLI** (`codex login`) di komputer ini. Cukup salah satu.

### Setiap kali memakai
Klik dua kali **`Mulai Aplikasi.bat`**. Ia memeriksa prasyarat, menyalakan web dan worker, lalu membuka http://localhost:3000. Tutup jendelanya untuk menghentikan.

## Editor dan perintah (disarankan)
Buka project, klik **▶ Buka editor** (`/projects/<id>/editor`). Tampilannya ala CapCut: pratinjau di tengah, **timeline** di bawah (jalur Video, Usulan, Kamera, Subtitle), gaya dan ekspor di kanan, dan di kiri tab **Perintah** serta **Usulan**.

**Perintah** diketik dalam bahasa sehari-hari, lalu diterjemahkan Claude Code CLI atau Codex CLI menjadi operasi yang dijalankan sistem:
- `potong semua jeda yang lebih dari 1 detik`
- `hapus kata eh dan anu` / `hapus kalimat yang ada kata diskon` / `potong dari detik 30 sampai 45`
- `zoom pas aku bilang harga`
- `ganti gayanya jadi tebal` / `matikan efek film` / `matikan subtitle`
- `ganti kata premier jadi Premiere`
- `render yang 9:16` / `batalkan`

Aturan perintah: yang **memotong hanya mengusulkan** (Anda setujui satu per satu atau lewat "✓ Setujui semua dari perintah ini"). Teks video **tidak dikirim ke AI** (hanya kalimat Anda dan ringkasan seperti durasi dan gaya). Operasi yang tidak dikenal ditolak; kata yang tidak ditemukan dilaporkan, tidak ditebak. Tiap perintah bisa **↶ Batalkan** tanpa menimpa keputusan Anda sesudahnya. "Render" hanya menerapkan potongan yang **sudah disetujui**.

## Cara memakai (halaman klasik)
1. **Buat project**, lalu **unggah** video (mp4, mov, mkv, webm, m4v). Tidak ada batas ukuran selain ruang disk. Kalau putus, pilih file yang sama lagi dan unggahan dilanjutkan.
2. Tunggu tahap **Periksa file** dan **Transkrip** selesai (lihat daftar status di atas halaman). Video 1 jam butuh waktu lama; angkanya belum diukur.
3. Baca **transkrip**. Klik dua kali kata untuk mengoreksi (kata yang digarisbawahi = mesin kurang yakin). Koreksi Anda tidak ditimpa.
4. Di **Analisis cut**, pilih **Claude Code CLI** atau **Codex CLI**, klik **Jalankan analisis**. Anda bisa menjalankan keduanya dan membandingkan.
5. **Review**: tiap usulan punya alasan dan kutipan. Klik **▶ Sebelum / ▶ Sesudah dipotong** untuk mendengar, lalu **✓ Setuju** atau **✕ Tolak**. Batas awal/akhir bisa digeser. Bagian "Tidak bisa dinilai" tidak bisa dipotong dari sini.
6. Di **Gaya video**, pilih rasio (16:9 atau 9:16), gaya, dan nyalakan/matikan kamera, subtitle, efek film. Pratinjau tampil di halaman.
7. **Simpan EDL**, lalu **Render MP4**. Hasil bisa diputar dan diunduh. File mentah tidak pernah diubah.

> **Menyetujui belum memotong file.** Potongan baru diterapkan saat render.

## Aturan yang dijaga
1. File mentah tidak pernah diubah (disimpan hanya-baca, ada checksum; database menolak perubahan).
2. Tidak ada cut tanpa persetujuan Anda.
3. Retake: take terakhir dipertahankan, alasan ditampilkan.
4. Subtitle di layer terpisah, tidak ikut gerakan kamera.
5. Padding 0,1 detik di sambungan (dibatasi agar tidak membawa serpihan kata yang dipotong).
6. Kunci rahasia tidak pernah sampai ke browser.
7. Yang tidak bisa dinilai ditandai, bukan ditebak.
8. Semua konstanta gaya di `config/index.ts`.

Aturan 1, 2, 6, 8 bisa diperiksa otomatis: `npm run build -w @app/web` lalu `npm run audit`.

## Batasan yang harus Anda tahu
- **Belum diuji pada video nyata.** Semua tes memakai video buatan (suara sintetis, bahasa Inggris, kasus yang jelas). Akurasi pada video Anda, bahasa Indonesia, dan bahasa campuran **belum diketahui**. Gunakan `npm run eval` (lihat bawah) untuk mengukurnya.
- **Subtitle bisa meleset dari suara** di dekat jeda (hingga ~0,8 dtk pada video uji): timestamp kata whisper.cpp tidak presisi. Belum ada forced alignment.
- **Gerakan kamera belum dilihat pada video wajah.** Hanya frame diam dan perhitungan yang diperiksa.
- **9:16 dari video 16:9** = potong tengah (tanpa face tracking). Sumber 1080p tampak agak lembut; 4K lebih tajam.
- **Waktu render:** ±1,6x durasi video (video 28 dtk = 45-58 dtk) di i5-10400. Video 1 jam diperkirakan ~1 jam lebih; **belum diukur**.
- **Ukuran file hasil:** efek film (grain) membuat file jauh lebih besar. Matikan "Efek film" bila ukuran penting.
- **Editor: klik di browser belum pernah diuji otomatis.** Tampilan dan alur prompt diuji lewat API dan potret layar; interaksi klik (setuju/tolak, seret, zoom timeline) belum. Timeline belum bisa memangkas dengan seret, belum ada waveform audio.
- **Hanya satu video mentah per project.** Hanya satu analisis dan satu render berjalan per project.
- **Hanya komputer lokal.** Belum ada Docker/VPS, login, atau pembayaran.
- Font subtitle diunduh dari Google saat pertama dipakai (butuh internet).
- Analisis memakai jatah langganan Claude/Codex Anda. Bila habis, muncul pesan "Batas pemakaian langganan tercapai" (deteksi ini belum teruji terhadap batas sungguhan, hanya terhadap contoh teks).

## Bila ada masalah
Pesan error di layar menjelaskan penyebab dan saran; **Detail teknis** bisa dibuka dan disalin.

| Gejala | Biasanya | Yang dilakukan |
|---|---|---|
| "Program transkrip (Whisper) tidak bisa berjalan" | VC++ Redistributable belum ada | Pasang (langkah 5) |
| "CLI belum login" | Sesi Claude/Codex habis | Jalankan `claude` atau `codex login` |
| "Batas pemakaian langganan tercapai" | Jatah habis | Tunggu, atau pakai provider satunya |
| "Ruang disk tidak cukup" | Disk penuh | Kosongkan drive (folder `data/media`) |
| Status "Worker tidak melapor" | Worker mati | Tutup dan buka lagi `Mulai Aplikasi.bat` |
| Transkrip/analisis tidak jalan | Tabel DB belum dibuat | Jalankan semua file di `supabase/migrations` |

Menghapus project dari aplikasi **tidak** menghapus file video (aturan 1). Hapus manual folder `data/media/projects/<id>` bila ingin mengosongkan ruang.

## Perintah untuk pengembang

Motion lewat prompt, batas operasi, sumber upstream, serta contoh prompt: [docs/motion-sources.md](docs/motion-sources.md).
Upload/link referensi gaya dan persiapan pengunduh: [docs/reference-editing.md](docs/reference-editing.md).
Editing manual, timeline, keyframe, undo/redo, dan hubungan dengan Concat: [docs/manual-editing.md](docs/manual-editing.md).
Jalankan contoh upstream dengan `npm run studio:shotcraft` (3003) atau `npm run studio:toolkit` (3002). Skill resmi Remotion tersedia di `.agents/skills/remotion-best-practices`.

```
npm run dev                  web saja            npm run worker     worker saja
npm run typecheck            semua paket         npm run studio     Remotion Studio
npm test                     141 tes logika (frasa, operasi, waktu, kamera, energi, parameter, efek prompt)
npm run audit                audit aturan 1/2/6/8 + batas unggahan + aturan prompt (butuh build + web menyala)
npm run eval -- <projectId> <labels.json>        ukur akurasi deteksi (lihat eval/contoh-labels.json)
npm run render-smoke -w @app/worker -- <projectId> [16:9|9:16] [bersih|tebal|lembut] [--full]
npm run smoke -w @app/worker -- <video>          uji ffprobe + Whisper tanpa database
```

Struktur: `apps/web` (Next.js), `apps/worker` (Whisper, analisis, render), `packages/remotion` (komposisi, rencana kamera, subtitle), `packages/shared` (tipe, EDL, error), `config` (semua konstanta), `supabase/migrations`, `scripts`, `eval`, `docs`, `todo`.

Dokumen: [brief.md](brief.md) · [todo.md](todo.md) · [docs/fase-1-riset.md](docs/fase-1-riset.md) · [CLAUDE.md](CLAUDE.md)
