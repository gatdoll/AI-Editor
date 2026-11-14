# Fase 8: Editor ala CapCut + edit lewat prompt

Permintaan pengguna (28 Okt 2026): tampilan seperti CapCut, dan pengeditan **lewat prompt** seperti agen Claude Code (referensi: repo `remotion-dev/skills`, yang ternyata kumpulan instruksi agen untuk terminal, bukan antarmuka).

## Keputusan pengguna
1. **Prompt = operasi terstruktur pada EDL/gaya** (bukan agen bebas menulis kode). Aturan file mentah dan persetujuan tetap terjaga otomatis.
2. **Timeline dibangun sendiri** (bukan membeli Editor Starter).
3. **Prompt yang memotong hanya membuat USULAN** (status pending). Pengguna menyetujui dengan satu klik. Aturan 2 utuh.

## Desain
- Prompt diproses di **worker** (job `prompt`), memakai Claude Code CLI atau Codex CLI yang sudah ada. Web tidak pernah memanggil CLI (aturan 6).
- LLM **tidak menerima seluruh transkrip**. Ia hanya menghasilkan daftar operasi dari kalimat pengguna + fakta ringkas (durasi, gaya sekarang). Pencarian frasa dilakukan kode sendiri di transkrip (cepat, murah, dan "tidak ditemukan" dilaporkan, bukan ditebak: aturan 7).
- Operasi (himpunan tertutup, tiap operasi divalidasi): `propose_cut_phrase`, `propose_cut_time`, `propose_pauses`, `set_style`, `emphasize_phrase` (kamera zoom saat frasa diucapkan), `fix_word`, `render`, `undo_last`, `answer`.
- Setiap prompt dicatat (`prompt_runs`) dengan snapshot sebelum perubahan agar bisa **dibatalkan**.
- EDL dibangun dari SEMUA usulan yang disetujui di project (gabungan analisis Claude, Codex, dan prompt).
- Tampilan: pratinjau besar di tengah (Remotion Player), timeline di bawah (jalur video/usulan/kamera/subtitle) dengan playhead dan zoom, panel kiri (transkrip, usulan), panel kanan (properti/gaya), kolom prompt dengan riwayat.

Legenda: [x] selesai dan diuji · [~] kode ditulis, belum diuji penuh · [ ] belum

## 8.0 Alat bantu
- [x] Pemotretan halaman dengan Chrome tanpa jendela (`--screenshot`, `--virtual-time-budget`) agar tampilan bisa DILIHAT. Langsung menemukan bug nyata: transkrip tidak membungkus baris (tanpa spasi antar kata) -> diperbaiki
- [x] Tes permanen: `npm test` = 101 pemeriksaan (logika murni 37, kamera 16 dengan 1.200 rencana acak, efek prompt 42, tata letak 6)
- [x] Tes langsung penerjemahan prompt dengan CLI sungguhan: `node apps/worker/test/translate.live.ts claude|codex`

## 8.1 Logika murni (teruji)
- [x] Pemetaan waktu sumber <-> hasil (playhead dan seek): roundtrip 2.000 titik acak, monoton
- [x] Tata letak timeline: penggaris dengan label berjarak >= 70 px di semua zoom, jalur untuk blok yang tumpang tindih (300 skenario acak)
- [x] Pencarian frasa: normalisasi (huruf besar, tanda baca, aksen), toleransi ejaan 1 huruf HANYA untuk kata >= 6 huruf, hasil tidak tumpang tindih, "tidak ditemukan" dilaporkan (aturan 7), perluasan ke kalimat
- [x] Skema operasi: himpunan tertutup 9 operasi, validasi ketat, properti nyasar diabaikan, jenis tak dikenal ditolak, maks 12 operasi, "batalkan" tidak boleh digabung
- [x] Override kamera ("zoom saat aku bilang X") di perencana. 1.600 rencana / 1,75 juta sampel frame: nol pelanggaran invarian (tepi hitam, preset berulang, lompatan, batas zoom). Permintaan dihormati 100%. Zoom yang terlihat bermakna 92,9% (permintaan jarang: 95,2%); sisanya terbatas oleh batas zoom 1,2x. Menemukan dan memperbaiki 2 masalah desain (syarat "ruang zoom" tidak pernah terpenuhi di mode 9:16; ambang bermakna tidak proporsional)
- [x] Perencana efek prompt (usulan, gaya, perbaikan kata, zoom): 42 tes + fuzzing 600 perintah. Fuzzing menemukan usulan jeda yang bisa melewati durasi dan jeda yang lebih pendek dari ambang tetap diusulkan -> diperbaiki
- [x] Pembatalan aman (`prompt-undo.ts`): tidak menghapus usulan yang sudah Anda setujui/tolak, tidak menimpa gaya atau kata yang sudah Anda ubah lagi. **Logikanya ditulis, BELUM diuji dengan database**

## 8.2 Data
- [x] Migrasi `20261028100000_fase8_prompt.sql` sudah dijalankan: job `prompt`, `projects.style`, `prompt_runs`, usulan jenis `custom`/sumber `prompt`
- [x] EDL dibangun dari SEMUA usulan yang disetujui di project (`edl-save.ts`, dipakai bersama web dan worker). Teruji: regresi alur lama 27/27 + render 15/15, dan render dari perintah

## 8.3 Worker + API
- [x] Penerjemah prompt (Claude/Codex): TERUJI LANGSUNG pada 12 perintah nyata. **Claude 12/12 (~4,7 dtk/perintah), Codex 12/12 (~7 dtk)**, termasuk menolak permintaan yang tidak didukung ("tambahkan musik") dan upaya penyuntikan instruksi. Transkrip video TIDAK dikirim ke AI
- [x] Handler job `prompt` TERUJI ujung ke ujung (`node apps/worker/test/prompt.e2e.mjs <projectId>`, 32/32 + 4 uji undo usulan): jeda (dedupe: 9 sudah ada), potong frasa (2 usulan 'very'), frasa tak ada (Codex: tanpa usulan + pesan jujur), gaya + zoom, perbaiki kata + undo, permintaan tak didukung, dua perintah bersamaan (201+409), validasi input, persetujuan massal per perintah, render 9:16 dari perintah (file 1080x1920). Pemulihan bila gagal di tengah jalan: ditulis, BELUM dipicu
- [x] API: kirim perintah, riwayat, batalkan, simpan gaya (dinormalkan), semua usulan, persetujuan massal per perintah (tanpa cakupan ditolak), info ekspor. Teruji lewat prompt.e2e

## 8.4 Antarmuka (`/projects/[id]/editor`)
- [x] Tata letak ala CapCut (gelap): perintah/usulan di kiri, pratinjau Remotion Player di tengah dengan transport, properti/gaya/ekspor di kanan, timeline di bawah. DILIHAT lewat potret layar
- [x] Timeline: penggaris, jalur Video (potongan yang disetujui berarsir), Usulan (warna per jenis; putus-putus = menunggu, centang = disetujui, jalur bertumpuk), Kamera (permintaan zoom ditandai bintang), Subtitle; playhead yang bergerak, klik untuk seek, zoom (tombol, slider, Ctrl+roda), auto-ikut saat memutar. DILIHAT
- [x] Pemutar tersinkron dengan timeline (waktu hasil <-> waktu sumber); subtitle tampil di pemutar. DILIHAT pada `?t=8`
- [x] Tab usulan: filter jenis, hanya yang menunggu, aksi massal per jenis, kartu dengan setuju/tolak. DILIHAT
- [x] Kolom perintah: riwayat, balasan + hasil nyata tiap operasi, "Setujui semua dari perintah ini", "Batalkan", pilihan Claude/Codex. Tampilan DILIHAT dengan data nyata (balasan render 9:16). API di baliknya teruji. **Klik tombolnya di browser belum diuji**
- [ ] Aksi klik di browser (setuju/tolak, kirim perintah, ekspor, seek lewat klik, zoom timeline) BELUM diuji: potret layar tidak bisa mengklik. Hanya tampilan statis yang terverifikasi
- [ ] Tidak ada seret-untuk-memangkas blok di timeline (hanya pilih dan atur angka di panel kanan)
- [ ] Usulan identik dari analisis Claude dan Codex tampil ganda di timeline dan daftar
- [ ] Waveform audio belum ada (ala CapCut)

## 8.5 Uji
- [x] Prompt nyata ujung ke ujung: Claude (sebagian besar perintah) dan Codex (frasa tak ada), 32/32
- [x] Regresi alur lama: unggah -> transkrip -> analisis 2 provider -> review -> EDL 27/27, render 15/15, audit 37/37 (termasuk 4 pemeriksaan khusus prompt), `npm test` 101/101
- [ ] Prompt pada video NYATA berbahasa Indonesia (semua uji memakai video sintetis berbahasa Inggris, jadi kata yang dicari kebanyakan Inggris)
- [ ] Perintah yang ambigu ('potong bagian yang jelek', 'buat lebih menarik') belum diuji; dugaan: AI mengembalikan ops kosong + penjelasan

## 8.6 Gaya Modern dan registri parameter (semua pengaturan bisa diprompt)
- [x] Gaya "Modern" (teks besar kapital animasi pop, aksen cyan, kamera energik)
- [x] Energi kamera (tenang/sedang/energik), zoom kiri/kanan, 4 animasi teks (sorot/pop/kotak/pendek). Tes energi 7/7, tampilan DILIHAT (kotak, pendek, pop)
- [x] Registri parameter `params.ts`: 20 pengaturan (ukuran/posisi/tebal/garis tepi/redup/baris/kata per halaman, 3 warna, vinyet/gradasi/grain, energi/kekuatan zoom/zoom maks/durasi gerakan, posisi potong). Operasi `set_param`/`reset_param`; nilai divalidasi dan dibatasi rentangnya, peringatan untuk nilai berisiko (zoom besar, grain tinggi). Tes 33/33
- [x] Panel "Pengaturan lanjutan" di editor dibuat dari registri yang sama; prompt AI dibuat dari katalog yang sama
- [x] Hasil nyata ditampilkan dari kode; balasan AI hanya "Catatan AI". Perintah tanpa operasi dijawab "Tidak ada perubahan"
- [x] Uji langsung Claude 16/16 dan Codex 16/16 (termasuk prompt "modern banget seperti tiktok...")
- [ ] BELUM didukung (AI diminta jujur menyebutnya): judul/teks melayang, color grading, transisi khusus, musik, gaya per-frasa (mis. satu kata dibuat besar). Efek visual baru di luar registri butuh kode baru
- [ ] Klik panel "Pengaturan lanjutan" di browser belum diuji; build produksi belum diulang (audit menandai build usang, harus `npm run build -w @app/web` saat server dev mati)

## 8.7 Penyegaran antarmuka studio (27 Oktober 2026)
- [x] Tema studio gelap dengan aksen mint; token antarmuka terpusat di `config/ui.css`, terpisah dari gaya hasil render.
- [x] Halaman project: kartu project, pencarian, formulir pembuatan dengan status mengirim dan penanganan koneksi, tautan langsung ke editor untuk project siap.
- [x] Halaman persiapan, unggah, progres, review, transkrip, dan demo memakai desain yang konsisten.
- [x] Workspace: preview mengikuti rasio tanpa meluber, mode fokus, panel properti dapat ditutup, preset gaya visual, toggle kamera/subtitle/film, status bar.
- [x] Tab transkrip: pencarian dan penanda kata, jumlah kecocokan, navigasi ke hasil pertama, klik kata untuk seek.
- [x] Timeline: warna jalur lebih tenang, status pending tetap berarsir, perluasan area timeline, label jalur mengikuti gulir vertikal, blok usulan bisa dipilih dengan keyboard.
- [x] Browser nyata: desktop 1920, laptop 1366×768, ponsel 390×844. Diuji tab transkrip, pencarian, seek (important → sumber 25,8 dtk), zoom, contoh prompt, mode fokus, preset Modern, rasio 9:16, panel lanjutan, buka/tutup inspector. Gaya dan rasio dikembalikan ke nilai awal.
- [x] `npm test`: 141/141; typecheck seluruh workspace; build produksi; audit: 37/37.
- [ ] Persetujuan cut, pengiriman prompt ke worker, unggah video, dan render MP4 belum diuji ulang lewat klik pada sesi penyegaran tampilan ini. Pemeriksaan tersebut tidak diwakili oleh uji navigasi di atas.

## 8.8 Motion editorial (27 Oktober 2026)
- [x] Referensi dipelajari: [remotion-claude-video](https://github.com/JJenglert1/remotion-claude-video), commit `580b9a04558909eb9f2f71e4ec5f41af3e5358ae`. Repo tersebut starter kit/panduan; komposisi di sini dibuat sendiri, bukan fork aplikasi upstream.
- [x] Preset Motion: reveal kata mengikuti timestamp, spring settle, rotasi kecil, underline kata aktif, dan exit setelah kata selesai diucapkan. Mendukung ukuran, posisi, warna, redup, stroke, kapital, serta pemisahan baris dari perencana subtitle.
- [x] Framing full-screen → floating shot → full-screen memakai easing deterministik. Latar garis orbital, radius dan shadow mengikuti framing. Subtitle tetap di layer terpisah; EDL dan durasi tidak berubah.
- [x] Tiga parameter Motion tersedia pada inspector dan katalog prompt: aktif, kekuatan, jeda antar aksen. Renderer dan preview memakai `buildEditedProps` yang sama.
- [x] `/demo`: studi original 18 detik (reveal bertahap, ring draw, kartu berlapis, ritme garis, kinetic type, wipe), autoplay tanpa audio, 16:9/9:16 dan navigasi bab.
- [x] `npm test`: 141 tes lama lolos, ditambah suite motion untuk 6 kombinasi aspek/fps (24/30/60), cut yang disetujui, seek mundur, tanpa transkrip, subtitle disembunyikan, framing dimatikan, dan batas waktu kata. Typecheck seluruh workspace, build produksi, audit 37/37 lolos.
- [x] Render MP4 studi landscape 1920×1080 dan portrait 1080×1920 ke `out/motion-study/`. Frame 1,5 / 7,5 / 14,6 detik diperiksa; posisi kartu portrait diperbaiki agar tidak menutup footer.
- [x] Render integrasi memakai video sintetis proyek uji dan EDL v2: 834 frame, 27,8 detik, audio ada, hash raw identik. Hasil `apps/worker/.cache/render-smoke/16x9-motion.mp4`; tidak mengubah EDL/gaya tersimpan saat render CLI.
- [x] Browser nyata: preset Motion, playback dan inspector lanjutan diuji. Gaya proyek uji dikembalikan ke Bersih; demo aktif tersedia di localhost:3000/demo. Worker dimulai ulang saat antrean kosong agar katalog/render terbaru dipakai.
- [x] Terjemahan prompt nyata melalui Codex memilih `motion`, `teks.animasi=kinetik`, `motion.kekuatan=1.3`, tanpa operasi cut/render yang tidak diminta.
- [ ] Claude CLI tidak bisa diverifikasi saat ini: organisasi menonaktifkan akses langganan Claude Code. Preset manual dan Codex berfungsi.
- [ ] Wipe/kartu pada studi demo bukan generator adegan bebas untuk semua video. Footage proyek mendapatkan kinetic captions dan motion framing. Musik, judul bebas, dan desain scene arbitrer dari prompt belum didukung.

## Selesai jika
- Pengguna mengetik perintah (mis. "potong semua jeda lebih dari 1 detik, gaya Tebal, zoom saat aku bilang harga"), melihat usulan dan perubahan di timeline, menyetujui, lalu merender, tanpa menyentuh terminal.
