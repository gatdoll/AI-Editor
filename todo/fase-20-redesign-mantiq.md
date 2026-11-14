# Fase 20: Desain ulang Mantiq Editor

Permintaan pengguna (10 Nov 2026): terapkan desain UI/UX dari Claude Design (`docs/mantiq-editor-uiux.zip`, brief di `docs/brief-uiux-mantiq-editor.md`) ke seluruh aplikasi, dengan nama **Mantiq Editor**.

Status: **disetujui (10 Nov 2026). 20.1 selesai.** Berikutnya 20.2.

### 20.1 Fondasi (selesai 10 Nov 2026)
- Token tema gelap Mantiq di `config/ui.css` (nama `--ui-*` lama dipetakan, ditambah `--ui-brand`, `--ui-text-2`, `--ui-inset`, `--ui-stage`, `--ui-focus`, token lane timeline).
- `globals.css`: elemen dasar, ring fokus 3px, `.display` (Michroma), `.eyebrow`, kelas pola `btn`/`chip`/`seg`/`card`/`dot`.
- `layout.tsx`: Inter + Michroma lewat `next/font` (di-host sendiri), judul "Mantiq Editor".
- `Icon.tsx` memakai `lucide-react@1.61.0` (nama ikon lama dipertahankan, ditambah `news`).
- Nama "Editing Studio" diganti "Mantiq Editor"; isian tombol primary editor memakai biru brand.
- Alat potret: `npm run ui-shot -w @app/worker -- <url> <out.png>` (chrome-headless-shell; Chrome sistem menggantung saat headless di mesin ini).
- Verifikasi: typecheck, `npm test`, `next build` lulus. Beranda, Workspace Video, dan Workspace Motion dipotret: tema konsisten, tidak ada yang rusak.
- `npm run audit`: 30/32. Dua yang gagal tidak berasal dari tahap ini: aturan 8 menunjuk `CreativeProof.tsx`, aturan 1 mendaftar puluhan berkas lama yang menulis ke folder project (berkas Fase 19 ikut terdaftar dengan pola yang sama). Perlu dibahas terpisah: pemeriksaannya yang terlalu luas, atau ada yang perlu diperbaiki.

## Isi zip (15 board, design system "Mantiq")
| Board | Layar |
| --- | --- |
| Main | Beranda: header global (logo, breadcrumb, Status sistem, Demo), kartu buat project 4 jenis, filter + grid project, hapus inline |
| Persiapan | Project Video: stepper Unggah → Memproses → Siap, daftar file per video (status, progres, gagal + "Coba ulang dari tahap ini", "Keluarkan dari project") |
| WorkspaceVideo (+ WV-Cepat, WV-Kreatif) | Workspace Video: tab Usulan, Prompt Cepat (riwayat perintah), Prompt Kreatif (pipeline + kartu versi), Klip akhir, timeline |
| BriefMotion (+ BriefOpinion) | Halaman brief Motion/Animasi/Opinion: stepper 3 tahap, voice over 3 pilihan, pengaturan, bahan, aset internet |
| WorkspaceMotion (+ OM-Riset, OM-Pilih, OM-Siap) | Workspace Motion & Opinion Motion: versi, preview, panel kanan, layar tahap |
| PanelAset, MentionCard | Panel Aset dan semua status kartu sebutan |
| Komponen | Job status (3 varian), kartu status sistem, catatan AI (info/peringatan/gagal), toast + Undo, lampiran, tabel state per komponen |
| Token | Tema gelap turunan Mantiq + kontras |

## Token (dari board Token)
- Permukaan: `#111827` (ground), `#171f35` (panel/kartu), `#1d2742` (tombol sekunder/chip), `#0c1220` (input, lane), `#0b1020` (stage preview); garis `#2a3555` / `#3d4f7c`.
- Teks: `#ffffff`, `#b4bedd`, `#8a9bc9`.
- Brand: isian `#1e3fc2` (hover `#1428a0`); garis/link/outline terpilih `#7b91f0`; wash `rgba(30,63,194,.22)`; fokus `rgba(123,145,240,.5)` 3px.
- Status: sukses `#1f9d6b`, peringatan `#c7871b`, gagal `#e0735f` (teks) / `#c4442e` (isian).
- Font: Michroma (display, judul besar), Inter (UI). Radius 12px (tombol/input), 16px (kartu). Ikon garis gaya Lucide.

## Rencana bertahap (tiap tahap bisa dipakai sendiri)
1. **20.1 Fondasi.** Token tema gelap Mantiq di `globals.css` (menggantikan `--ui-*`; nama variabel lama dipetakan supaya halaman yang belum diubah ikut berganti warna), font Inter + Michroma lewat `next/font`, kelas dasar (btn, chip, seg, card, inp), ikon Lucide (paket `lucide-react`) menggantikan ikon buatan sendiri dan emoji, nama "Mantiq Editor" + slot logo.
2. **20.2 Header global + Status sistem.** Breadcrumb, indikator worker/Claude Code/Codex, kartu perbaikan dengan bahasa awam (menggantikan pesan nama file migrasi di tengah panel).
3. **20.3 Beranda + Persiapan.** Kartu 4 jenis, filter jenis, grid project; daftar file per video dengan status dan aksi.
4. **20.4 Workspace Video.** Header (rasio, Tersimpan, Ekspor dengan progres), tab kiri berikon, panel Usulan, Prompt (Cepat/Kreatif/Klip akhir), properti, timeline dengan warna lane baru. Paling besar: dikerjakan per panel, logika tidak diubah.
5. **20.5 Workspace Motion + brief.** Stepper tahap, halaman brief baru, panel kanan, layar tahap di preview, panel Aset sesuai MentionCard.
6. **20.6 Komponen bersama + rapikan.** Job status, catatan AI, toast + Undo, lampiran; sapaan "kamu" di seluruh aplikasi.

Tiap tahap: typecheck, `npm test`, `npm run audit`, potret layar dibandingkan dengan board.

## Prinsip implementasi
- Hanya tampilan dan teks. Logika, API, dan data tidak berubah. Aturan proyek 1–8 tetap.
- Konstanta gaya UI berada di CSS token (bukan `config/`, yang untuk gaya video).

## Yang ada di desain tetapi belum ada di aplikasi (perlu keputusan)
- Rasio **1:1** (aplikasi sekarang hanya 16:9, 9:16, 4:5; menyentuh render).
- Pilihan **"Tanpa voice over"** sebagai mode eksplisit di brief motion (sekarang: naskah dikosongkan).
- **Filter jenis project** dan **cari** di beranda (cari sudah ada).
- Aksi **"Keluarkan dari project"** untuk video gagal di Persiapan, dan **Batalkan** pemrosesan per file.
- Teks status sistem menyebut `npm run worker`; di mesin ini worker jalan lewat **Mulai Aplikasi.bat**.
- Logo PNG versi terang (reversed) untuk header: belum ada di zip.

## Catatan
- Board di zip bergantung pada runtime Claude Design (`support.js`) yang tidak ikut, jadi tidak bisa dibuka langsung di browser. Implementasi membaca markup dan gaya inline-nya. Potret PNG tiap board dari Claude Design akan membantu pencocokan visual.
