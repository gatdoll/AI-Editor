# Editing Video: aturan proyek

Baca [brief.md](brief.md) dulu. Rencana per fase ada di [todo.md](todo.md). Riset dan keputusan: [docs/fase-1-riset.md](docs/fase-1-riset.md).

## Arsitektur
Monorepo npm workspaces:
- `apps/web`: Next.js (UI, API ringan, Remotion Player). Tidak boleh mengimpor `@remotion/renderer`.
- `apps/worker`: Node di Docker (Coolify). Whisper, ffmpeg, render. Mengambil job dari tabel `render_jobs` di Supabase.
- `packages/remotion`: komposisi Remotion, dipakai Player dan renderer.
- `config`: konstanta gaya dan analisis. Satu-satunya tempat konstanta.

Analisis cut: lewat Claude Code CLI (`claude -p --json-schema`) atau Codex CLI (`codex exec --output-schema`) yang sudah login di worker, bukan API key. Pengguna memilih **Claude Code CLI atau Codex CLI** per analisis di UI; `ANALYZER_DEFAULT` hanya nilai awal. Provider yang dipakai dicatat di tiap hasil analisis. Output wajib divalidasi dengan skema sendiri.

Edit lewat prompt (Fase 8): kalimat pengguna -> job `prompt` di worker -> Claude/Codex menerjemahkan menjadi operasi dari himpunan TERTUTUP (`packages/shared/src/ops.ts`) -> kode kita memvalidasi dan menerapkannya (`apps/worker/src/prompt/effects.ts`). Perintah yang memotong HANYA membuat usulan `pending` (aturan 2). Transkrip tidak dikirim ke AI. Tiap perintah punya snapshot untuk pembatalan yang tidak menimpa keputusan pengguna (`prompt-undo.ts`). Semua pengaturan yang bisa diubah (teks, warna, efek, kamera) didefinisikan SATU kali di registri `packages/shared/src/params.ts`; katalognya otomatis dikirim ke AI dan menjadi panel "Pengaturan lanjutan". Menambah kemampuan = tambah entri di sana + hubungkan di `build-props.ts`. EDL dibangun dari SEMUA usulan yang disetujui di project (`edl-save.ts`).

Voice over motion (Fase 17): rekaman suara pengguna (`voice-profile/`, satu untuk semua project) + naskah -> job `voiceover` di worker -> Codex CLI menyiapkan naskah baca (divalidasi `packages/shared/src/voiceover.ts`; gagal = dibaca apa adanya dan dicatat) -> VoxCPM2 lokal meniru rekaman (`apps/worker/py/voiceover.py`, `npm run setup:voiceover`, butuh uv) -> waktu kata Whisper -> `projects/<id>/voiceover/`. Motion tetap Claude Code dan mengikuti `data.words`. Atau pengguna mengunggah voice over jadi (`voiceover/upload`, `payload.upload`): tanpa Codex dan VoxCPM2, hanya waktu kata Whisper.

Opinion Motion (Fase 19): project motion dengan penanda `style.motion.opini`. Voice over wajib -> job `assets`: Claude Code/Codex CLI dengan pencarian web mengusulkan sebutan + URL (divalidasi `packages/shared/src/opinion.ts`) -> kode kita mengunduh gambar dan memotret artikel (`apps/worker/src/opinion/`, chrome-headless-shell Remotion lewat CDP) -> pengguna MEMILIH tiap aset (tab Aset) -> aset terpilih jadi bahan dengan `cue` (waktu sebutan + sumber). Agen motion tetap tanpa internet. Status di `projects/<id>/opini/state.json`.

Aset sendiri (Fase 21): di project video, tab Aset. Gambar pengguna + keterangan (`materials/notes.json`) -> job `assets` dengan `payload.own` -> Claude Code/Codex CLI (tanpa internet, tanpa melihat gambar) mengusulkan rentang kata transkrip (divalidasi `packages/shared/src/own-assets.ts`) -> pengguna MEMUTUSKAN (pakai usulan / posisi playhead / tidak dipakai) -> aset dipakai membawa `cue` dalam detik video mentah, dipetakan ke timeline hasil oleh `mapAssetCues` (build-props) setiap kali props dibangun. Status di `projects/<id>/aset-sendiri/state.json`.

Referensi gaya (Fase 22): unggahan atau link satu video YouTube/Instagram/TikTok di semua kotak Kreatif/motion (`ReferencePicker`, `attachReference`) -> worker `sampleReference` (yt-dlp, 16 frame) -> folder kerja `reference/` -> agen wajib menulis `reference.md` dulu, meniru GAYA bukan isi. Gagal diambil = job gagal dengan alasan.

Safe area (Fase 23): `SAFE_AREA` di config (9:16 = UI Reels/TikTok: atas, bawah, kolom tombol kanan) adalah satu-satunya sumber untuk subtitle, judul, `data.safeArea` kode AI (kode 9:16 wajib memakainya), dan garis bantu pratinjau (`SafeAreaGuide`, tidak ikut render). Centang "Ikuti safe area" (param `bingkai.safeArea`, bawaan menyala) di editor dan motion: mati = `SAFE_AREA_OFF` (jarak tepi biasa) lewat `safeAreaOf`/`subtitleZone`, dan kode AI tidak diwajibkan memakai `data.safeArea`.

Talent dan font (Fase 24): job Kreatif menyiapkan talent bila prompt butuh (`npm run setup:talent`; RVM + YuNet di CPU -> `projects/<pid>/talent/`). Kode AI boleh `export function Behind` (di belakang talent) dan `export function faceBlur` (blur wajah); `data.faces` = posisi wajah. Font tambahan: pustaka Google Fonts (`npm run setup:fonts`) + unggahan, dipilih AI lewat `fonts.json`, dimuat komposisi dengan delayRender.

Rig karakter (Fase 25): centang "Rig karakter" di kotak Kreatif (`payload.rig`) -> `apps/worker/py/rig.py` (venv talent) -> `projects/<pid>/rig/<assetId>.json` (garis leher/pinggul, mata, mulut, topeng alfa data URL). Kode AI WAJIB menampilkan karakter ber-rig lewat `import { Character } from "character"` (gambar asli dipotong clip-path jadi kepala/badan/kaki; aksi idle/talk/walk/jump/cheer/nod/shake/shock/think). Rig ikut bahan lewat `withRigs`.

Transkrip (Nov 2026): Whisper `large-v3-turbo` + bahasa `id` di whisper.cpp 1.7.6 (env WHISPER_MODEL / WHISPER_LANGUAGE / WHISPER_CPP_VERSION menimpa), lalu koreksi AI salah dengar (`TRANSCRIPT_FIX`, bawaan Claude Opus 5.5, `apps/worker/src/transcript-fix.ts`): hanya teks, ragu = tidak diganti tetapi dicatat. Hasil mesin di `original_words`; ringkasan di payload job (tab Transkrip). Istilah pengguna di `MEDIA_DIR/glossary.txt` (petunjuk Whisper + ejaan untuk AI).

Hosting: VPS + Coolify, Supabase untuk Postgres dan Storage. Dipakai sendiri, bahasa Indonesia dengan istilah Inggris, video selalu ada suara bicara.

## Aturan yang tidak boleh dilanggar
1. File mentah tidak pernah diubah. Edit non-destruktif lewat EDL.
2. Tidak ada cut otomatis tanpa persetujuan pengguna. Sistem hanya mengusulkan.
3. Retake: default pertahankan take terakhir, tampilkan alasannya.
4. Subtitle di layer terpisah di atas kamera, tidak ikut bergerak.
5. Padding 0,1 detik di tiap sambungan cut.
6. Kunci API tidak pernah dikirim ke browser (tanpa `NEXT_PUBLIC_` untuk rahasia).
7. Bagian yang tidak bisa dinilai ditandai tidak bisa dinilai, bukan ditebak.
8. Semua konstanta gaya (warna, font, durasi, easing) di `config/`.

## Konvensi
- Semua paket `remotion` dan `@remotion/*` harus satu versi persis (sekarang 4.0.539). Pasang dengan `--save-exact`; jangan pakai `^`.
- EDL adalah satu-satunya sumber kebenaran untuk render.
- Jangan menulis kode fase berikutnya sebelum fase berjalan disetujui; ikuti `todo/`.
- Tes: `npm test` (141 tes), `npm run audit` (butuh build). Potret layar untuk memeriksa tampilan: Chrome `--headless=new --screenshot=... --virtual-time-budget=20000 <url>`.
- Perintah: `npm run dev` (web), `npm run studio` (Remotion Studio), `npm run render:sample`, `npm run typecheck`.
