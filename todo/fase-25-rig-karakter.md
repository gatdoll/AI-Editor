# Fase 25: Rig karakter (gambar karakter pengguna bisa bergerak)

Permintaan pengguna (13 Nov 2026), project "Tretan Muslim" (Animasi): hasil motion menampilkan karakter unggahan sebagai gambar diam yang hanya digeser. Pengguna meminta karakternya di-rig dulu agar bisa bergerak.

Status: **kode selesai (13 Nov 2026).** 7 karakter project Tretan Muslim sudah di-rig (3,5 detik). Uji render still lolos: jalan, lompat, kaget, angguk, kedip, dan mulut bicara terlihat. Tes `fase25.test.ts` lulus. Menunggu: restart worker, lalu satu versi Kreatif nyata.

## Cara kerja
1. **Rig** (`apps/worker/py/rig.py`, venv talent: OpenCV + YuNet; tanpa model baru):
   - Latar polos dibuang: piksel terang tak berwarna yang tersambung ke tepi gambar. Bayangan lantai ikut terbuang.
   - Leher = baris tersempit antara kepala dan bahu. Kolom leher dicatat agar sambungan tertutup saat kepala bergerak.
   - Pinggul = selangkangan di sumbu tengah. Kaki menyatu = `legs: null` (jalan memakai seluruh badan).
   - Mata, mulut, warna kulit dari YuNet. Mulut di luar wajah (mis. tangan di dagu) = `mouth: null`, bukan ditebak (aturan 7).
   - Topeng alfa PNG setengah resolusi sebagai data URL (±7 KB). Tidak ada berkas baru yang perlu disajikan ke pratinjau/render.
   - Hasil: `projects/<pid>/rig/<assetId>.json`. Gambar asli tidak disentuh (aturan 1).
2. **Komponen `Character`** (`packages/remotion/src/creative/character.ts`, modul `"character"` di kode kreatif):
   - Gambar asli digambar 4 kali dengan clip-path: kaki kiri, kaki kanan, badan, kepala. Tiap bagian punya titik putar sendiri.
   - Aksi: idle (napas, ayun kepala, kedip), talk, walk, jump, cheer, nod, shake, shock, think, ditambah `talking` (mulut).
   - Semua dari frame (deterministik, pratinjau = render). Konstanta gerak di `CHARACTER` (config).
   - Tanpa rig = gambar utuh dengan napas/ayun sederhana.
3. **Job Kreatif**:
   - Centang "Rig karakter dari bahan gambar" (`payload.rig`): bahan gambar non-logo yang belum di-rig diproses dulu. Bukan karakter = dilewati dengan alasan di aktivitas; tidak ada satu pun = job gagal dengan alasan.
   - Ada aset ber-rig: `characterInstruction` mewajibkan `<Character>`, dan `characterErrors` menolak kode yang menampilkan karakter ber-rig sebagai `<Img>` diam.
   - `brief.json` hanya memuat ringkasan rig (tanpa topeng base64).
4. **Bahan**: `withRigs` (`packages/shared/src/rig-store.ts`) dipakai rute bahan web, `prepareMotion`, dan `loadImageMaterials`, jadi pratinjau, still, dan render mendapat rig yang sama.

## Batas yang diketahui
- Lengan menyatu dengan badan (tangan di saku/bersedekap), jadi tidak ada gerak tangan. Aksi "wave" sengaja tidak dibuat.
- Mulut bicara = bentuk mulut terbuka digambar di atas mulut asli; cocok untuk gaya chibi, tidak untuk gambar realistis.
- Latar harus polos (putih/abu terang). Foto atau latar ramai ditolak dengan alasan.
