# Fase 23: Safe area platform (Reels / TikTok / Shorts)

Permintaan pengguna (12 Nov 2026): video 9:16 yang diunggah ke Instagram tertutup tombol like/komentar/share, caption, nama akun, dll. Motion dan video harus punya safe area.

Status: **kode selesai (12 Nov 2026).** Tes lulus, garis bantu dipotret di editor. Menunggu: restart worker, lalu buat satu versi Kreatif/motion 9:16 dan cek hasilnya.

## Keputusan
- Satu konstanta `SAFE_AREA` (pecahan) per rasio di `config/index.ts`. 9:16: atas 12% (nama akun, tab Reels), bawah 24% (caption, nama, audio, follow), kanan 14% (kolom like/komentar/share/simpan), kiri 6%. 4:5 dan 16:9: jarak tepi biasa.
- Dipakai oleh: subtitle biasa + kinetik (kanan lebih lebar dari kiri: tidak tertimpa kolom tombol), judul hook/kinetik (lebar dibatasi; judul "atas" tidak masuk safe area atas), `data.safeArea` (piksel) untuk kode AI, garis bantu pratinjau.
- Kode AI (Video Kreatif, Klip akhir, Motion, Animasi, Opinion Motion): instruksi safe area di system prompt + bagian "Safe area" di contract.md. Kode 9:16 yang tidak memakai `data.safeArea` ditolak dan diperbaiki agen (`safeAreaErrors`). Latar/dekorasi boleh sampai tepi.
- Garis bantu (`SafeAreaGuide`) hanya overlay di atas Player: tidak ikut still/render. Bawaan tampil untuk 9:16, pilihan diingat per browser.

## Peta kode
| Bagian | Berkas |
| --- | --- |
| Konstanta | `SAFE_AREA`, `SUBTITLE.safeZone` (diturunkan) di `config/index.ts` |
| Data AI | `safeAreaPx`, `CreativeData.safeArea` (`packages/remotion/src/creative/contract.ts`); diisi di Edited, Motion, CreativeProof, motionCreativeData, prepareVideo |
| Instruksi/validasi | `safeAreaInstruction`, `safeAreaErrors`, `subtitleZoneInstruction` (`apps/worker/src/creative/loop.ts`), contract-doc |
| Subtitle/judul | `Subtitles.tsx`, `KineticCaptions.tsx`, `TitleOverlays.tsx`, `titleBottom` (`title-plan.ts`) |
| UI | `app/components/SafeAreaGuide.tsx`, editor (tombol ▣ Safe area), motion (centang Safe area) |

## Verifikasi
- `npm test` lulus termasuk `fase23.test.ts`; `npm run typecheck` bersih. Tes menangkap satu bug nyata (regex `\b` rusak saat penyuntingan) sebelum dipakai.
- Garis bantu dipotret di editor video 9:16.

## Batas
- Versi kreatif/motion LAMA tidak otomatis menghindari safe area (kode dibekukan per versi): buat versi baru.
- Pemeriksaan kode AI hanya memastikan `data.safeArea` dipakai, bukan bahwa SETIAP elemen ada di dalamnya; cek dengan garis bantu.
- Ukuran UI platform berubah-ubah per aplikasi/perangkat; angka di `SAFE_AREA` bisa disesuaikan di satu tempat.
- Posisi subtitle manual (`textBottom`) yang diturunkan pengguna tetap dihormati walau masuk safe area.
