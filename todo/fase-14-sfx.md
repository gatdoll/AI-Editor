# Fase 14: SFX dari prompt kreatif

Permintaan pengguna (30 Okt 2026): saat memberi prompt Kreatif/Motion, AI bisa menambahkan suara SFX (whoosh, pop, ding, impact, dll.). Sumber suara: **paket bawaan + unggahan sendiri** (pilihan 3).

Status: **selesai (30 Okt 2026)**, menunggu uji pengguna. Tambahan permintaan: SFX juga bisa dari perintah Mode Cepat.

## Prinsip
- Kode AI tetap **tidak memutar audio** (scope tertutup Fase 9). AI hanya menulis **daftar isyarat SFX** (`sfx.json`): nama suara, waktu, volume. Kode kita yang memvalidasi dan memutarnya.
- Suara bicara tetap dominan: volume SFX dibatasi dan diatur oleh satu pengaturan master.
- Pratinjau = render: isyarat diputar oleh komposisi yang sama (Edited untuk video bicara, Motion untuk motion graphics).
- Waktu isyarat di video bicara disimpan dalam **waktu video mentah** (seperti kata, cut, dan judul), jadi tetap pas walaupun potongan berubah.

## Sumber suara
1. **Paket bawaan**, berlisensi bebas untuk komersial, disimpan bersama aplikasi beserta berkas lisensinya:
   - Kenney *Interface Sounds* (100 suara, **CC0**, kenney.nl/assets/interface-sounds) dan Kenney *Impact Sounds* (130 suara, **CC0**, kenney.nl/assets/impact-sounds). Dipilih sekitar 20 yang paling berguna untuk video (click, pop, select, ding/konfirmasi, notifikasi, impact ringan/berat, typing), lalu diberi nama dan tag yang jelas.
   - **Whoosh, swoosh, riser, dan downlifter dibuat sendiri** oleh skrip kita (sintesis noise + filter + envelope), karena paket whoosh CC0 yang terverifikasi tidak ditemukan. Karena buatan sendiri, tidak ada masalah lisensi.
2. **Unggahan sendiri**: pustaka SFX global (dipakai semua project), berisi file MP3/WAV/OGG/M4A dengan nama dan tag. AI boleh memilih dari pustaka ini dan paket bawaan.

## Desain
- Data (migrasi):
  - tabel `sfx_library` (nama, tag, durasi, path, sumber `bawaan`/`unggahan`, lisensi);
  - kolom `creative_versions.sfx` (isyarat hasil AI);
  - `style.sfx` untuk isyarat yang sudah diedit pengguna (pola sama dengan subtitle beku Fase 10).
- Kontrak AI:
  - brief berisi daftar pustaka (`nama`, `tag`, `durasi`) dan aturan pakai (sedikit dan bermakna, mis. di judul masuk, kata kunci, angka, zoom penegasan; jangan menumpuk; jangan menutupi ucapan);
  - AI menulis `sfx.json`;
  - validator kita memeriksa nama ada di pustaka, waktu di dalam durasi, volume 0–1, maks. ~40 isyarat, dan jarak minimum antar isyarat.
- Komposisi: tiap isyarat diputar sebagai `<Audio>` pendek di frame yang tepat. Volume = volume isyarat × pengaturan master `audio.sfx` (registri parameter, jadi muncul di panel dan katalog mode Cepat).
- Timeline:
  - track **SFX** berisi penanda isyarat;
  - klik = dengar dan pilih; tarik = geser; Delete = hapus;
  - "＋ SFX" di playhead untuk menambah dari pustaka secara manual.
- Panel pustaka: daftar suara bawaan dan unggahan, putar contoh, unggah, beri nama/tag, hapus (hanya unggahan).

## Langkah
- 14.1 Pustaka: unduh paket Kenney (izin pengguna), kurasi, buat whoosh/riser, tabel `sfx_library`, unggah dan daftar.
- 14.2 AI: kontrak + `sfx.json` + validator + simpan di versi.
- 14.3 Pemutaran: komposisi Edited dan Motion, pengaturan master, pemetaan waktu melewati cut.
- 14.4 Timeline: track SFX (dengar, geser, hapus, tambah).
- 14.5 Uji: tes otomatis (validator, pemetaan waktu, volume) + uji nyata pada project video dan motion + ekspor MP4.

## Risiko
- Selera SFX sangat subjektif. Dibuat mudah diedit dan dimatikan (pengaturan master 0 = tanpa SFX).
- Ekspor dengan banyak isyarat audio sedikit menambah beban render (masalah memori di mesin ini).

## Hasil (30 Okt 2026)
Perbedaan dari rencana: **tanpa migrasi database**. Pustaka berbasis file (`data/media/sfx/bawaan/manifest.json` dari `npm run setup:sfx`, `sfx/unggahan/library.json`), isyarat versi kreatif di `projects/<id>/creative/<versi>/sfx.json`.

- [x] 14.1 Pustaka: 16 suara Kenney CC0 (Interface + Impact, lisensi ikut disalin) + 7 suara sintetis buatan sendiri (`scripts/sfx-synth.py`: whoosh, whoosh-cepat, swoosh-tinggi, whoosh-turun, riser, downlifter, sub-drop). Rute `GET/POST /api/sfx`, `GET /api/sfx/[id]/file`, `DELETE /api/sfx/[id]` (bawaan tidak bisa dihapus). `packages/shared/src/sfx.ts` (normalisasi, cari, `parseSfxFile`), `sfx-library.ts` (Node).
- [x] 14.2 AI Kreatif/Motion: `brief.json` berisi `sfxLibrary`; `contract.md` bagian `sfx.json`; suara tak dikenal / JSON rusak dikembalikan ke AI di putaran perbaikan; di luar durasi / terlalu rapat dibuang dan dicatat di notes. Revisi memakai `sfx.json` versi dasar; perubahan yang hanya SFX tetap dihitung perubahan.
- [x] **Mode Cepat** (permintaan tambahan): operasi `add_sfx` (sound + phrase ATAU startS + volume) dan `clear_sfx`; pustaka masuk prompt terjemahan; volume master lewat `set_param audio.sfx`.
- [x] 14.3 Pemutaran: `buildSfxProps` (`packages/remotion/src/sfx-props.ts`) + `SfxTrack` di komposisi Edited dan Motion. Isyarat edit waktu mentah (yang jatuh di bagian terpotong tidak bunyi), isyarat kreatif waktu hasil. Render worker menyajikan file SFX lewat server lokal.
- [x] 14.4 Timeline: track SFX (kotak sepanjang suara, geser, klik pilih, Delete hapus; SFX kreatif bergaris putus-putus, klik = salin ke edit), tombol ♪ SFX, panel Manual → SFX (pustaka, dengar, tambah di playhead, volume per isyarat, volume master, unggah/hapus unggahan, nyala/mati SFX kreatif). Workspace motion: tab ♪ SFX di panel kanan.
- [x] 14.5 Uji: `apps/worker/test/fase14.test.ts` (masuk `npm test`), typecheck, render MP4 nyata `apps/worker/src/render-sfx-smoke.ts` (whoosh tepat di 0,3 dtk dan impact di 1,2 dtk, hening di luar itu), rute web unggah/putar/hapus diuji ke server dev.
- [ ] Uji pengguna: prompt Kreatif dengan SFX pada project video dan motion, lalu ekspor.
