# Fase 19: Opinion Motion (motion + aset dari internet)

Permintaan pengguna (10 Nov 2026): konten motion yang memakai aset dari internet, bukan 100% digambar dari nol. Contoh: saat nama public figure disebut, fotonya muncul; saat berita dibahas, screenshot artikelnya muncul.

Status: **kode selesai (10 Nov 2026).** Tes otomatis lulus, dan riset nyata (CLI + internet, tanpa database) terbukti. Menunggu langkah pengguna: migrasi `20261110100000_fase19_opinion_motion.sql`, mulai ulang aplikasi (worker baru mengenal job `assets`), lalu uji dari browser sampai Ekspor MP4.

## Keputusan pengguna (10 Nov 2026)
1. **Kategori baru ke-4: Opinion Motion**, terpisah dari Video, Motion, dan Animasi, supaya fungsinya jelas dan instruksi AI tidak tercampur.
2. **Foto tokoh dari pencarian web umum**, bukan Wikimedia saja. Risiko hak cipta diterima pengguna. Sumber setiap aset tetap dicatat.
3. **Berita dicari AI sendiri**, lalu di-screenshot sesuai instruksi (fokus judul, kutipan yang disorot, atau bagian atas halaman).
4. **Voice over wajib** (dari naskah atau unggah rekaman jadi), karena waktu munculnya aset mengikuti kata yang diucapkan.
5. **Kredit sumber di layar menyala secara bawaan**, bisa dimatikan per project.

## Prinsip
- **Agen penulis kode motion tetap tanpa internet** (Fase 9/13). Pencarian aset adalah job terpisah sebelumnya, dan hasilnya masuk sebagai bahan project biasa (`data.assets`).
- **Tidak ada aset yang dipakai tanpa dipilih pengguna** (semangat aturan 2). Tombol "Buat motion" baru aktif setelah tiap sebutan diputuskan.
- **Tidak ketemu = ditandai dengan alasan**, bukan diganti tebakan (aturan 7). Kutipan yang tidak ada di halaman tidak disorot di tempat lain. Judul yang dicatat adalah judul di halaman, bukan klaim AI.
- File unduhan diperlakukan sebagai data tak tepercaya: anti-SSRF di tiap redirect, hanya gambar (dicek dari tanda tangan berkas), encode ulang ffmpeg, ukuran dibatasi, SVG berskrip ditolak.
- Semua batas dan gaya di `OPINION` (`config/index.ts`).

## Alur
```
Beranda -> Opinion Motion -> brief (arahan visual) + voice over (wajib) + pilih AI riset (Claude Code / Codex)
  -> job voiceover -> waktu kata
  -> job assets (otomatis): AI + WebSearch/WebFetch -> JSON (divalidasi checkResearch)
       tokoh/brand/tempat: unduh kandidat gambar (Wikimedia: thumbnail 1920px dulu)
       berita: screenshot Chrome headless sesuai fokus, kutipan disorot bila ditemukan persis
  -> tab 🖼 Aset: per sebutan Pilih / Cari ulang (petunjuk) / Unggah sendiri / Tidak dipakai / Instruksi screenshot
  -> Buat motion: job creative biasa; aset terpilih membawa cue {start,end,label,type,source}
       + instruksi Opinion Motion + validasi (kode wajib memakai .cue, dan .source bila kredit menyala)
```

## Peta kode
| Bagian | Berkas |
| --- | --- |
| Konstanta | `config/index.ts` (`OPINION`) |
| Tipe, skema JSON AI, validasi, isyarat | `packages/shared/src/opinion.ts` |
| Status (file samping `projects/<id>/opini/state.json`), pilih/lepas bahan | `packages/shared/src/opinion-store.ts` |
| Anti-SSRF (dipakai juga link knowledge) | `packages/shared/src/safe-url.ts` |
| Job `assets` | `apps/worker/src/opinion/handler.ts`, `research.ts` (prompt), `fetch-image.ts`, `screenshot.ts`, `browser.ts` (CDP ke chrome-headless-shell Remotion) |
| CLI dengan pencarian web | `runResearch` di `apps/worker/src/analyze/providers.ts` |
| Motion | `opinionInstruction`/`opinionErrors` (`creative/loop.ts`), cue di `prepareMotion` + rute bahan web, `data.opini` di `motion-props.ts`/`Motion.tsx`/kontrak |
| API | `api/projects/[id]/opini` (GET status, POST riset, PATCH batal), `opini/[mid]` (PATCH keputusan, POST unggah), `opini/file` |
| UI | `motion/AssetPanel.tsx`, `motion/page.tsx`, beranda |
| Migrasi | `supabase/migrations/20261110100000_fase19_opinion_motion.sql` (hanya jenis job) |

## Verifikasi (10 Nov 2026)
- `npm test` lulus, termasuk `fase19.test.ts` (validasi keluaran AI, skema ketat Codex, isyarat, props/kontrak, pemeriksaan kode, prompt, path traversal, thumbnail Wikimedia) dan `fase19-media.test.ts` (server lokal: redirect, bukan-gambar, terlalu kecil, SVG berskrip, blokir alamat lokal; screenshot kutipan ditemukan/tidak, halaman terblokir). `npm run typecheck` bersih.
- Uji CLI: Claude Code 2.1.310 (`--tools WebSearch,WebFetch`) dan Codex 0.163.0 (`web_search="live"`) sama-sama mengembalikan JSON sesuai skema.
- Riset nyata (`npm run opinion-smoke -w @app/worker -- --riset "<naskah>"`), naskah 5 sebutan, 48 dtk: 2 screenshot berita (kutipan Kontan ditemukan dan disorot), 2 foto Purbaya, logo Gojek (SVG). Foto Prabowo gagal karena berkas asli Wikimedia lebih dari 15 MB, lalu diperbaiki: thumbnail resmi dulu, batas dinaikkan ke 25 MB. AI menandai keraguannya di catatan, misalnya berita PHK Gojek terbaru tidak ditemukan sehingga tidak dibuat entrinya.
- Temuan saat uji: ffmpeg bawaan Remotion tidak mengenali gambar tanpa ekstensi, jadi berkas sementara kini diberi ekstensi sesuai tanda tangan berkas.
- Rute API baru dan beranda dicek di server dev, dan beranda dipotret.

## Belum diuji / batas
- **Belum diuji dari browser dengan database**: brief, lalu voice over, riset otomatis, panel Aset, motion, dan ekspor. Belum ada project Opinion Motion yang dibuat.
- Pemakaian aset oleh kode AI dicek statis (`.cue` / `.source` dipakai). Belum ada pengecekan bahwa SETIAP aset terpilih benar-benar tampil di frame.
- Hak cipta: kredit bukan izin. Situs berita besar bisa memblokir browser otomatis (gagal dengan alasan; ada Ambil ulang dengan link lain atau Unggah sendiri).
- Voice over diganti sesudah riset: isyarat waktu dimatikan dan UI meminta riset ulang.
- Pemilihan aset dikunci selama job riset berjalan (agar tidak tertimpa).
