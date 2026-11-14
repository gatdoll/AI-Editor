# Fase 3: Deteksi Cut dan Review

Tujuan: sistem mengusulkan cut, pengguna mereview, EDL tersimpan.

Legenda: [x] selesai dan diuji · [~] kode ditulis, belum diuji penuh · [ ] belum

## Deteksi
- [x] Deteksi jeda dengan `ffmpeg silencedetect` (ambang di config; filter ada di ffmpeg bawaan Remotion). TERUJI pada audio TTS sungguhan: 6 jeda terdeteksi, termasuk yang 2,9 dtk
- [x] Deteksi filler dari transkrip (daftar satu-kata di `config/index.ts`; frasa sengaja tidak otomatis). Teruji: "eh" dan "Anu" tertangkap
- [x] Adapter dua provider di worker, satu antarmuka: `claude -p --json-schema` dan `codex exec --output-schema`, tanpa API key. Keduanya teruji memanggil model sungguhan
- [x] Pemilih provider di UI (Claude Code CLI / Codex CLI), nonaktif bila CLI belum siap
- [x] Simpan provider dan model di tiap hasil analisis (`analysis_runs`); analisis ulang tidak menimpa hasil lama (teruji: 2 run, keputusan run pertama utuh)
- [x] Status ketersediaan CLI (terpasang, sudah login) ditulis worker ke `app_status`; pengecekan teruji (266 ms, tanpa kuota)
- [x] CLI dijalankan tanpa tool, tanpa MCP, tanpa slash command, di folder kosong: input turun dari 50.867 ke ~1.800-2.700 token
- [~] Timeout 5 menit, satu kali coba ulang bila keluaran tidak sesuai skema (retry belum pernah terpicu di uji). Penanganan batas pemakaian langganan BELUM ada
- [x] Prompt: transkrip bernomor + penanda jeda, keluaran JSON ketat; alasan tanpa nomor kata
- [x] Validasi keluaran dengan zod + kisaran kata; item di luar kisaran dibuang dan dihitung
- [x] Retake: pertahankan take terakhir, alasan ditampilkan (aturan 3). Teruji di kedua provider
- [x] "Tidak bisa dinilai" (aturan 7): dari LLM dan dari kata ber-confidence rendah (>=3 berurutan), jenis `unclear`, tidak bisa disetujui untuk dipotong
- [x] Transkrip panjang dipecah per 350 kata dengan overlap 50, hasil digabung. TERUJI di Claude pada transkrip sintetis 1.168 kata / 4 chunk: 3 dari 3 retake tepat, 0 positif palsu, duplikat dari overlap tergabung, kasus tepat di perbatasan chunk lolos. Belum diuji di Codex dan belum pada transkrip nyata
- [x] Batas potong dipasang di tengah celah antar kata (timestamp per kata Whisper tidak presisi)
- [x] Timestamp kata berdurasi nol dirapikan (perpanjang sampai kata berikut, maks 0,4 dtk)

## Hasil uji kualitas (transkrip sintetis dengan kunci jawaban, 1 chunk)
| Pemeriksaan | Claude Code CLI | Codex CLI |
|---|---|---|
| Retake sapaan (kata 0-6), take terakhir dipertahankan | benar | benar |
| Koreksi "Premiere eh maksud saya" | meleset satu kata di uji awal; **tepat 4/4 setelah prompt diperbaiki** (contoh prompt sengaja berbeda dari kasus uji) | benar |
| Retake "Ketiga" | benar | benar |
| Penekanan sengaja "sangat sangat" TIDAK dipotong | benar | benar |
| Filler "eh", "Anu" (aturan) | benar | benar |
| Waktu / token | ~5 dtk / ~3 ribu | ~10 dtk / ~17 ribu |

Uji audio sungguhan (TTS Inggris, 33 dtk): kedua provider menemukan retake, koreksi "Premiere. I mean," (tepat), dan tidak memotong "very, very". Catatan: semua ini transkrip buatan dengan kasus yang jelas. BUKAN pengukuran akurasi. Target akurasi baru ditetapkan setelah 5 video nyata berlabel (Fase 6).

## Database
- [x] Migrasi `20261027140000_fase3_analisis_cut.sql` dan `20261027160000_fase3_satu_job_aktif.sql` sudah dijalankan: `analysis_runs`, `cut_suggestions`, `edl`, `app_status`, status `analyzing`, satu job aktif per jenis per project
- [x] Semua usulan lahir `pending`; hanya PATCH pengguna yang membuatnya `approved` (aturan 2)

## Layar review
- [~] Daftar usulan dengan jenis, alasan, kutipan, sumber (AI / aturan / ffmpeg): API teruji; TAMPILAN belum dilihat
- [~] Setuju / tolak / kembalikan per usulan: API teruji; tombol belum dilihat
- [~] Geser batas awal/akhir (input detik), disimpan; menandai "digeser": API teruji (orig tetap, validasi awal<akhir dan batas durasi); input belum dilihat
- [~] Pemutar "Sebelum" dan "Sesudah dipotong" per usulan (konteks 1,5 dtk di tiap sisi)
- [~] Aksi massal per jenis (tetap eksplisit oleh pengguna): API teruji; tombol belum dilihat
- [~] Ringkasan: jumlah disetujui, durasi hasil; putar hasil akhir; lompati potongan saat memutar biasa
- [x] Padding 0,1 dtk di tiap sambungan (aturan 5): `buildEdl` teruji 11/11 (awal/akhir file, tumpang tindih, terlalu pendek, di luar batas)
- [x] Simpan keputusan ke EDL: versi baru tiap simpan (teruji v1, v2), hanya `approved` dan bukan `unclear`, pending/rejected tidak bocor

## Uji
- [x] Uji end-to-end lewat API dengan audio sungguhan, kedua provider: 27/27 pemeriksaan lolos (termasuk 2 permintaan bersamaan: 201 + 409)
- [ ] Uji tampilan layar review di browser (ekstensi Chrome tidak terhubung; belum dilihat siapa pun)
- [ ] Siapkan 5 video uji berlabel manual (retake yang disengaja)
- [ ] Ukur temuan vs label di kedua provider; catat angka nyata, jangan janjikan akurasi
- [ ] Uji pengulangan yang disengaja (penekanan) pada video nyata
- [ ] Uji transkrip panjang (>350 kata, beberapa chunk) dan batas pemakaian langganan

## Selesai jika
- Pengguna bisa mereview semua usulan dan EDL tersimpan; tidak ada cut tanpa persetujuan.
