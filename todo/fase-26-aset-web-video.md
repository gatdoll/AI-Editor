# Fase 26: Riset aset internet di video bicara (centang, seperti "Pisahkan talent")

Permintaan pengguna (12 Nov 2026): riset aset dari internet milik Opinion Motion (tokoh, berita, brand, tempat) juga tersedia di project **video**. Riset hanya berjalan bila dicentang, dengan pola yang sama seperti centang "Pisahkan talent" di kotak Kreatif. Kalau tidak dicentang, tidak ada riset.

Status: **konsep, menunggu persetujuan.** Belum ada kode.

## Inti
- Kotak Kreatif di editor video mendapat centang **"Cari aset dari internet (tokoh, berita, brand, tempat)"**. Bawaannya **mati**, dan centang ini tidak pernah ditebak dari kata-kata di prompt.
- Dicentang: sebelum agen motion menulis kode, worker menjalankan riset yang sama dengan Opinion Motion. Bedanya, yang dibaca adalah **transkrip video**, bukan naskah voice over. Hanya kata di bagian yang dipertahankan (EDL) yang dikirim.
- Tidak dicentang: alur Kreatif tetap seperti sekarang, hanya memakai aset sendiri (Fase 21) bila ada.

## Yang dipakai ulang (tanpa kode baru)
| Bagian | Dari |
|---|---|
| Prompt riset, jenis sebutan, target jumlah per durasi (`OPINION.density`) | `apps/worker/src/opinion/research.ts` |
| Validasi keluaran AI (`checkResearch`), kandidat, cue | `packages/shared/src/opinion.ts` |
| Unduh gambar, potret artikel (chrome-headless-shell) | `apps/worker/src/opinion/fetch-image.ts`, `screenshot.ts` |
| Kartu pilih kandidat, cari ulang, ambil ulang screenshot | `AssetPanel` (Opinion Motion) |
| Pemetaan cue dari detik video mentah ke timeline hasil | `mapAssetCues` (Fase 21) |
| Instruksi + pemeriksaan "tampil saat disebut" + kredit sumber | `creative/loop.ts` (Fase 19) |

## Yang baru
1. **Sumber kata**: `handleAssets` menerima project video bila `payload.web === true`. Kata diambil dari transkrip terbaru, disaring ke segmen yang dipertahankan, dan waktunya tetap dalam **detik video mentah**. Dengan begitu, mengubah cut sesudahnya tidak merusak cue; kalimat yang terpotong ditandai, bukan dipindah (aturan 7).
2. **Status** di `projects/<id>/aset-web/state.json`, terpisah dari aset sendiri (`aset-sendiri/`). Kedua jenis aset tampil di tab **Aset** dalam dua bagian: "Aset sendiri" dan "Dari internet".
3. **Kotak Kreatif**: centang + payload `webAssets: true`, lalu alur di bawah.
4. **Tanpa migrasi**: memakai jenis job `assets` dengan penanda `payload.web`. Aturan satu job `assets` aktif per project tetap berlaku.
5. **Kredit sumber**: tiap aset internet membawa `source`; kode AI wajib menampilkan kredit kecil (sama dengan Opinion Motion), dan kredit itu wajib berada di dalam safe area (Fase 23).
6. **Tes**: kata dari transkrip yang terpotong, payload tanpa centang tidak pernah memicu riset, validasi riset dengan kata transkrip.

## Alur (perlu keputusan pengguna, lihat bawah)
```
Kotak Kreatif: prompt + [x] Cari aset dari internet -> Kirim
  -> job assets (payload.web): AI + pencarian web membaca transkrip -> sebutan + URL
  -> kode kita mengunduh gambar / memotret artikel -> kandidat
  -> ??? (A) pengguna memilih di tab Aset, lalu klik "Lanjutkan versi Kreatif"
         (B) kandidat pertama yang berhasil dipakai otomatis, versi Kreatif langsung dibuat
  -> job creative: aset terpilih (internet + sendiri) membawa cue -> motion tampil saat disebut
```

## Keputusan pengguna (12 Nov 2026)
- **Pilih dulu (A).** Sama dengan Fase 19: tidak ada aset internet yang masuk video sebelum dipilih pengguna. Prompt Kreatif disimpan bersama job riset; sesudah memilih, pengguna klik "Lanjutkan versi Kreatif" dan job creative memakai prompt itu.
