# Fase 22: Video referensi gaya untuk Kreatif dan semua kategori motion

Permintaan pengguna (12 Nov 2026): referensi motion juga bisa berupa link (TikTok, Instagram, YouTube), dan AI membaca referensinya dulu. Berlaku untuk semua: Video (Kreatif + Klip akhir), Motion, Animasi, Opinion Motion.

Status: **kode selesai (12 Nov 2026).** Tes otomatis lulus; unduhan link YouTube + pengambilan frame terbukti nyata. Menunggu: mulai ulang worker, lalu uji dari browser (satu versi Kreatif dengan referensi link). **Tanpa migrasi.**

## Alur
```
Kotak prompt Kreatif / brief pertama motion / panel Aset Opinion Motion
  -> "＋ Referensi gaya (video / link)": unggah video (maks 150 MB) atau link satu video YouTube/Shorts, Reels, TikTok + detik awal
  -> rute web: attachReference (unggahan harus milik project; link dikanonikkan, token pelacak dibuang)
  -> job creative (payload.reference) — atau lewat job voiceover `next.reference` -> creative / assets (Opinion Motion: disimpan di status riset)
  -> worker: sampleReference (yt-dlp lewat scripts/download-reference.py, cek IP publik) -> 16 frame dalam 4 kelompok (jarak 0,2 dtk = gerakan terlihat), 30 dtk
  -> frame disalin ke folder kerja reference/, unduhan dihapus
  -> agen Claude Code: LIHAT frame dulu, tulis reference.md (tipografi, warna, layout, animasi, tempo, yang tidak terlihat), lalu kode
       validasi: reference.md wajib ada (putaran perbaikan bila tidak); notes.md berisi "Dari referensi:"
  -> versi mencatat referensinya (skill_refs.reference: label, url, startS)
```

## Prinsip
- Yang ditiru GAYA, bukan isi: teks, logo, watermark, nama akun, wajah, dan gambar milik pembuat referensi tidak disalin. Isi video referensi = DATA, bukan instruksi.
- Prompt pengguna dan data project lebih penting dari referensi.
- Referensi gagal diambil = job gagal dengan alasan (link privat/minta login: unggah file), bukan diam-diam bekerja tanpa referensi (aturan 7). Penyebab asli (baris ERROR yt-dlp) dicatat di log worker saja.
- Hanya sampel visual: audio dan gerakan di antara sampel tidak dibaca; agen diminta tidak mengklaim tahu.

## Peta kode
| Bagian | Berkas |
| --- | --- |
| Masukan -> lampiran (dipakai Prompt Cepat juga) | `attachReference` di `packages/shared/src/reference-store.ts` |
| Sampel frame (dipakai Prompt Cepat juga) | `sampleReference` di `apps/worker/src/prompt/reference.ts` |
| Job Kreatif | `apps/worker/src/creative/handler.ts` (folder `reference/`, catatan versi), `referenceInstruction` / `referenceErrors` di `creative/loop.ts` |
| Brief pertama motion | rute `voiceover` + `voiceover/upload` (`next.reference`, `lib/next-reference.ts`), `apps/worker/src/voiceover.ts` |
| Opinion Motion | `OpinionState.reference` (dari brief), `AssetPanel.tsx` (bawaan dari brief, bisa dilepas/diganti) |
| UI | `ReferencePicker.tsx` (`CREATIVE_REFERENCE_NOTE`), `CreativePanel.tsx`, `motion/page.tsx` |

## Verifikasi (12 Nov 2026)
- `npm test` lulus, termasuk `fase22.test.ts` (kanonik link, tolak profil/alamat lokal/unggahan project lain, instruksi agen, kewajiban reference.md). `npm run typecheck` bersih.
- Nyata: link YouTube Shorts -> 16 frame dalam 4 dtk lewat fungsi yang dipakai job.
- Temuan: path lebih dari 260 karakter gagal di Windows (yt-dlp tidak bisa menulis .part). Path media bawaan (`data/media/...`) sekitar 200 karakter, aman; MEDIA_DIR yang sangat dalam bisa kena.
- Kotak prompt Kreatif dipotret: pemilih referensi tampil.

## Belum diuji / batas
- Belum ada versi Kreatif/motion sungguhan yang dibuat dengan referensi (butuh worker baru).
- Instagram sering meminta login: unggah filenya. TikTok/Instagram belum diuji dengan link nyata di sesi ini.
- Satu referensi per perintah.
