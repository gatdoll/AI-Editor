# Fase 21: Aset sendiri di video bicara (keterangan + usulan waktu dari transkrip)

Permintaan pengguna (12 Nov 2026): saat mengedit video take sendiri, pengguna menambahkan aset miliknya (foto, screenshot, grafik). Aset diberi **keterangan** saat diunggah, lalu AI membaca transkrip dan menentukan di kalimat mana tiap aset paling cocok muncul, seperti Opinion Motion tetapi asetnya dari pengguna, bukan dari internet.

Status: **kode selesai (12 Nov 2026).** Tes otomatis lulus, pencocokan nyata dengan Claude Code dan Codex terbukti. Menunggu: mulai ulang worker, lalu uji dari browser sampai Ekspor MP4. **Tanpa migrasi** (memakai jenis job `assets` dengan `payload.own`).

## Keputusan pengguna (12 Nov 2026)
1. **Usulkan waktu dulu, baru dipakai.** AI mencocokkan keterangan dengan transkrip lalu mengusulkan waktu tiap aset. Pengguna menyetujui, menggeser, atau membuang usulan itu di panel Aset. Baru setelah itu Mode Kreatif membuat animasinya tepat di waktu tersebut. Ini sama dengan Opinion Motion: tidak ada aset yang masuk tanpa dipilih.

## Prinsip
- **Keterangan adalah kunci.** Diisi saat unggah, dan bisa diubah kapan saja. Tanpa keterangan, AI hanya punya nama berkas, dan panel menandai aset itu "keterangan kosong, penempatan bisa meleset".
- **AI tidak melihat gambarnya untuk menentukan waktu.** Yang dikirim hanya keterangan, nama berkas, dan jenis (gambar/logo). Transkrip dikirim sebagai daftar kata berindeks, sama seperti riset Opinion Motion. Tanpa internet.
- **Waktu disimpan dalam detik video mentah**, bukan detik timeline. Jadi usulan tetap benar walau cut diubah sesudahnya. Saat pratinjau, still, dan render, waktu itu dipetakan ke timeline hasil lewat EDL. Bila kata-kata itu sudah terpotong, aset ditandai "kalimatnya terpotong" dan tidak dipaksa tampil di tempat lain (aturan 7).
- **Tidak cocok di mana pun = ditandai dengan alasan**, bukan ditebak (aturan 7). Satu aset boleh diusulkan maksimal 1 tempat utama + alternatif.
- File mentah tidak disentuh (aturan 1). Aset tetap bahan project biasa (`assets` kind `material`).
- Konstanta (panjang keterangan, durasi tampil minimum, jumlah alternatif) di `config/` (`OWN_ASSETS`).

## Alur
```
Editor video -> tab Aset (baru, juga dari lampiran prompt Kreatif)
  -> unggah gambar + isi keterangan ("foto produk botol hijau, dipakai saat bahas harga")
  -> tombol "Cocokkan dengan transkrip" (pilih Claude Code / Codex)
  -> job assets (payload.own): AI membaca daftar kata + keterangan -> JSON {aset, cocok, utama{wordStart,wordEnd,alasan}, alternatif[]}
       divalidasi skema sendiri (indeks dalam rentang, aset dikenal, tidak dijawab = ditandai)
  -> panel: per aset tampil kalimat + detik usulan + alasan
       Pakai usulan / Pakai alternatif / Pakai di posisi playhead / Tidak dipakai / Cocokkan ulang
  -> Mode Kreatif (prompt biasa): aset yang disetujui membawa cue {start,end,label,keterangan}
       + instruksi "tampilkan saat disebut" + validasi kode wajib memakai .cue (dipakai ulang dari Fase 19)
```

## Pekerjaan
1. **Keterangan aset**: kolom isian di kartu aset tab Aset (langsung aktif sesudah unggah) dan bisa diubah kapan saja; API unggah juga menerima `note`. Disimpan di file samping `projects/<id>/materials/notes.json` (mengikuti pola `roles.json`, tanpa migrasi).
2. **Job `assets` dengan `payload.own`** (worker): prompt + skema JSON + validasi di `packages/shared/src/own-assets.ts`. Status di `projects/<id>/aset-sendiri/state.json`. Provider dipilih per job dan dicatat.
3. **Panel Aset di editor video**: daftar aset, keterangan, usulan waktu, tombol keputusan, peringatan bila transkrip/cut berubah.
4. **Mode Kreatif video**: `prepareVideo` dan `buildEditedProps` memetakan cue dari detik mentah ke timeline (`mapAssetCues`). Instruksi + pemeriksaan kode sendiri (`ownAssetsInstruction`, `ownAssetErrors`), tanpa kredit sumber.
5. **Tanpa migrasi**: memakai jenis job `assets` yang sudah ada dengan penanda `payload.own` (satu job `assets` aktif per project, sama dengan Opinion Motion).
6. **Tes**: validasi keluaran AI, pemetaan ke timeline (termasuk kalimat terpotong), prompt (transkrip = data, bukan instruksi), rute keterangan.

## Peta kode
| Bagian | Berkas |
| --- | --- |
| Konstanta | `config/index.ts` (`OWN_ASSETS`) |
| Tipe, skema JSON AI, validasi, posisi playhead, isyarat | `packages/shared/src/own-assets.ts` |
| Status (`projects/<id>/aset-sendiri/state.json`), isyarat per bahan | `packages/shared/src/own-assets-store.ts` |
| Keterangan bahan (`projects/<id>/materials/notes.json`) | `packages/shared/src/material-notes.ts` |
| Job (dipanggil dari `handleAssets` bila `payload.own`) | `apps/worker/src/own-assets/handler.ts`, `prompt.ts`, uji CLI `smoke.ts` (`npm run own-assets-smoke -w @app/worker -- claude\|codex`) |
| Waktu ke timeline hasil | `mapAssetCues` / `assetsOnTimeline` di `packages/remotion/src/build-props.ts` (dipakai pratinjau, still, render) |
| Mode Kreatif | `ownAssetsInstruction` / `ownAssetErrors` (`creative/loop.ts`), `prepareVideo` (`creative/handler.ts`), isyarat di `creative/materials.ts`, kontrak (`contract-doc.ts`) |
| API | `api/projects/[id]/aset-sendiri` (GET status, POST cocokkan, PATCH batal), `aset-sendiri/[mid]` (PATCH pakai / di-sini / tidak-dipakai / ulang), `materials` (keterangan + isyarat), `materials/[mid]` (PATCH `note`) |
| UI | `editor/OwnAssetPanel.tsx` (tab Aset), `editor/page.tsx` |

## Keputusan teknis
- **Waktu disimpan dalam detik video mentah** (bukan indeks kata): tetap benar walau typo transkrip dikoreksi. Isyarat dipetakan ke timeline hasil SETIAP kali props dibangun (pemetaan sama dengan sorotan kata), jadi aset ikut bergeser bila cut berubah tanpa membuat ulang kode kreatif. Kalimat terpotong = isyarat dibuang dan panel memberi peringatan.
- Multi-video (Fase 16): transkrip video utama sudah berisi kata semua video pada sumbu reel (`transcribeReel`), jadi tidak perlu penanganan khusus.
- Pencocokan default hanya untuk aset yang belum diputuskan; keputusan pengguna tidak ditimpa. Per aset ada "Cocokkan ulang".
- Klip akhir (Fase 18) tidak membawa isyarat aset (tidak ada transkrip di sana).

## Verifikasi (12 Nov 2026)
- `npm test` lulus, termasuk `fase21.test.ts` (validasi keluaran AI, posisi playhead, isyarat, pemetaan ke timeline termasuk kalimat terpotong, buildEditedProps, prompt, instruksi + pemeriksaan kode, kontrak). `npm run typecheck` bersih.
- Uji CLI nyata (`own-assets-smoke`), naskah 4 aset: Claude Code (Sonnet, 5 dtk) dan Codex (12 dtk) menempatkan tumbler, grafik omzet, dan foto ruko di kalimat yang tepat; aset tanpa keterangan ditandai tidak bisa dinilai, bukan ditebak.
- Tab Aset dipotret di server dev (keadaan kosong). Rute `aset-sendiri` menjawab.

## Belum diuji / batas
- Belum diuji dari browser dengan worker baru: unggah + keterangan, cocokkan, putuskan, Mode Kreatif, Ekspor MP4. Kartu aset yang terisi belum dipotret.
- Hanya gambar; video pendek (B-roll) belum.
- Versi kreatif yang dibuat SEBELUM aset diputuskan tidak memakai `cue`: buat versi baru di Prompt → Kreatif.
