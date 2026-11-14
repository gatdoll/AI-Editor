# Fase 18: klip motion di akhir video (CTA)

Permintaan pengguna (9 Nov 2026): menambah klip tambahan di akhir video yang sedang diedit, misalnya CTA. Durasi dipilih, isi motion dari prompt.

Status: **kode selesai, menunggu uji pengguna (worker perlu dimulai ulang).**

## Desain
- Tab Prompt, mode **Klip akhir**: durasi (3–60 dtk), prompt, lalu Aktifkan versi yang cocok.
- Data: `style.endClip = { seconds, versionId }`, tersimpan bersama gaya dan EDL. Tanpa migrasi database.
- Versi klip ada di `creative_versions`, ditandai `skill_refs.target = "endClip"`, dan tidak tercampur dengan riwayat Mode Kreatif.
- Worker: job `creative` dengan `payload.endClipSeconds` memakai jalur motion (kanvas kosong, gambar bahan project, still, validasi).
- Komposisi `Edited`: `<Sequence>` sesudah semua segmen EDL. Durasi hasil = durasi video + klip.
- Segmen EDL, subtitle, kamera, dan judul tidak dihitung ulang karena klip berada sesudah semuanya.
- Audio: tanpa suara bicara selama klip; SFX buatan AI untuk klip ikut diputar.
- Versi hilang saat render = render gagal dengan pesan jelas (bukan diam-diam tanpa CTA).

## Batas
- Satu klip, hanya di akhir. Sisip di tengah atau intro belum ada.
- Mengubah durasi sesudah versi dibuat tidak menulis ulang animasi; minta revisi bila ritmenya tidak pas.
- Playhead tidak bisa ditarik masuk ke klip akhir; klik bloknya di timeline untuk melompat ke sana.

## Uji
- Otomatis: `apps/worker/test/fase18.test.ts` (normalisasi, durasi, video tidak berubah, SFX, gambar).
- Nyata (belum): buat klip CTA 5 dtk, Aktifkan, periksa pratinjau, Ekspor MP4.
