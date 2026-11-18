# Fase 27: Prof. AI, karakter tetap yang bisa bergerak (project Animasi)

Permintaan pengguna (16 Nov 2026): maskot "Prof. AI" (chibi profesor, rambut putih, kacamata bulat, jas putih) bisa bergerak di bagian animasi. **Hanya di project Animasi** (project motion dengan `style.motion.animasi`), tidak di project video atau motion biasa.

Status: **disetujui (16 Nov 2026). Tahap 1 selesai:** rig (`npm run setup:prof-ai`, `check.png`), komponen `ProfAI` di modul `character`, `data.profAi` di kontrak, dan video peraga (`node --env-file=.env apps/worker/src/render-prof-ai.ts` -> `out/prof-ai/`). Menunggu tinjauan pengguna.
**Revisi 16 Nov 2026 (pengguna: "jelek, harus bisa ditekuk, jalan biasa"):** rig potong-putar diganti rig tulang + mesh di canvas: lengan bahu->siku->tangan, kaki pinggul->lutut->kaki (jaring segitiga, bobot halus di sendi), siklus jalan di tampak 3/4 (paha berayun, lutut menekuk saat ayun, lengan berlawanan, badan memantul, maju sejauh langkah). Tampak samping tidak dipakai untuk jalan (kaki menumpuk). think = garuk kepala (lengan chibi tidak sampai dagu).
**Revisi 17 Nov 2026 (pengguna: "tetap kayak wayang, pakai mesh-avatar-studio, keluarkan semua kemampuannya"):** tampak depan memakai avatar mesh dari mesh-avatar-studio (runtime npm `mesh-avatar@0.8.0`, MIT, WebGL) dari gambar baru `front-arms-down.png`: kepala menoleh 3D, rambut ber-fisika, napas, kedip/lirik, alis, mulut ikut vokal, 9 ekspresi (termasuk sedih/marah/malu/kedip sebelah), lengan berayun + siku, kaki memindah berat badan. Runtime dijalankan `manual` dengan angka acak ber-seed: simulasi maju satu tick per frame (mundur = ulang dari 0), jadi pratinjau = render. `ProfAI` memilih otomatis: tampak depan + idle/talk/explain/nod/shake/think/shock/jump = mesh; wave/point/present/cheer/walk dan tampak lain = rig tulang. Batas mesh (dari dokumentasinya): lengan tidak bisa diangkat, tidak bisa jalan. Rambut putih = warna jas, jadi masker rambut dibuat skrip sendiri. Bahan: `data/media/karakter/prof-ai/mesh-src/`.
**Belum:** centang "Pakai Prof. AI" di kotak Kreatif, `profAiInstruction`/`profAiErrors` di job, rute pratinjau `/api/karakter/prof-ai/<berkas>`, tes khusus fase 27.

## Bahan (sudah ada, 16 Nov 2026)
`data/media/karakter/prof-ai/` (di luar git, satu tingkat dengan `voice-profile/`). Semua PNG 1086x1086, alfa asli, tinggi badan sama (y39-1044).

| Berkas | Isi |
|---|---|
| `front-tpose.png` | Tampak depan, tangan terentang. Dasar untuk semua varian wajah. |
| `front-blink.png`, `mouth-closed/small/wide/o.png`, `expr-happy/surprised/thinking/serious.png` | Varian wajah. **Sejajar piksel** dengan `front-tpose.png`: beda hanya di kotak wajah (y~245-445, x~425-670). |
| `threequarter-tpose.png` | Tampak 3/4 menghadap kiri, tangan terentang. Gambar baru, wajahnya tidak sejajar dengan varian di atas. |
| `side-arms-down.png` | Samping menghadap kiri, tangan turun (untuk jalan). Hadap kanan = cermin. |
| `side-tpose.png` | Samping, tangan ke arah kamera. Disimpan, belum dipakai. |
| `back-tpose.png` | Tampak belakang. |

## Cara kerja

### 1. Rig sekali, diperiksa pengguna (`karakter/prof-ai/character.json`)
- Skrip sekali jalan (`npm run setup:prof-ai`, venv talent, logika dari `rig.py`) mengusulkan titik sendi per tampak: leher, bahu kiri/kanan, ujung tangan, pinggul, pemisah kaki, dan kotak wajah. Hasilnya ditulis ke `character.json` dan divalidasi skema (`packages/shared/src/prof-ai.ts`).
- Lembar periksa (PNG berisi titik sendi + still tiap aksi) dibuat bersamaan. **Pengguna menyetujui sekali.** Titik bisa disunting tangan di JSON lalu skrip dijalankan ulang. Tidak ada deteksi ulang per job (aturan 7: yang meragukan dikoreksi manusia, bukan ditebak tiap kali).
- Gambar asli tidak diubah (aturan 1). Bagian tubuh dipotong saat tampil dengan clip-path dan topeng alfa, sama seperti Fase 25.

### 2. Komponen `ProfAI` (`packages/remotion/src/creative/prof-ai.ts`, modul `"character"`)
```tsx
import { ProfAI } from "character";
<ProfAI view="front" action="explain" expression="happy" talking height={900} />
```
- **Bagian tubuh:** kepala, badan, lengan kiri, lengan kanan, kaki kiri, kaki kanan. Lengan berputar di bahu dan digambar di belakang badan agar sambungan bahu tertutup. Lengan satu potong, tanpa siku.
- **Pose diam:** tangan turun (lengan diputar dari T-pose). T-pose tidak pernah tampil kecuali diminta.
- **Aksi:** `idle`, `talk`, `explain` (gestur tangan bergantian), `wave`, `point` (`dir: "left" | "right"`), `present` (satu tangan terbuka ke samping), `cheer` (dua tangan ke atas), `jump`, `nod`, `shake`, `shock`, `think`, `walk` (otomatis memakai tampak samping), `turn` (pindah tampak dengan squash cepat ala kartun).
- **Wajah (tampak depan):** tempel potongan kotak wajah dari varian yang sejajar. Kedip memakai `front-blink`. `expression`: neutral, happy, surprised, thinking, serious. `shock` dan `think` otomatis memakai ekspresi yang cocok.
- **Mulut mengikuti suara:** `talking` membaca `data.words` (voice over). Di antara kata, mulut tertutup. Selama kata diucapkan, bentuk mulut dipilih dari huruf vokal yang sedang dibaca: a/e → `wide`, o/u → `o`, i → `small`. Tanpa `data.words` = ganti bentuk berkala seperti Fase 25.
- **Tampak 3/4 dan samping:** lengan dan kaki bergerak; mulut memakai bentuk sederhana Fase 25 (wajahnya tidak sejajar dengan varian). Belakang: tanpa wajah.
- Semua dari frame (deterministik, pratinjau = render). Konstanta gerak di `PROF_AI` di config (aturan 8).

### 3. Penyajian gambar
- Pratinjau: rute `GET /api/karakter/prof-ai/<berkas>` (hanya berkas di daftar, menolak path lain).
- Render dan still di worker: `srcFor` ke berkas lokal, pola yang sama dengan `sfx-props.ts`.

### 4. Job Kreatif di project Animasi
- Kotak Kreatif project Animasi mendapat centang **"Pakai Prof. AI"** (`payload.profAi`), **bawaan menyala**. Tidak muncul di project video atau motion biasa.
- Menyala: `profAiInstruction` menambah ke `animasiInstruction`: Prof. AI adalah tokoh utama (hero), daftar aksi/ekspresi/tampak, gaya latar menyesuaikan ilustrasi chibi, dan `talking` saat voice over berjalan.
- `profAiErrors`: kode wajib memakai `<ProfAI>` minimal sekali, dan tidak boleh menampilkan berkas Prof. AI sebagai `<Img>` diam. Gagal = agen memperbaiki di loop yang sama.
- `brief.json` hanya memuat ringkasan (tampak, aksi, durasi), tanpa gambar.

## Tes
- Fungsi pose murni (sudut lengan, langkah, lompat) dan pemilihan bentuk mulut dari `data.words`.
- Validasi skema `character.json`.
- `profAiErrors` dan `profAiInstruction` (hanya project Animasi, hanya bila dicentang).
- Still render tiap aksi dan tampak, dicek dengan mata dan dilampirkan ke lembar periksa.

## Deploy
- `data/media/karakter/` disalin ke volume media di VPS (tidak ikut git atau image Docker).

## Batas yang diketahui
- Tidak ada siku dan jari: gestur sebatas putaran lengan utuh dari bahu.
- Ekspresi dan mulut lengkap hanya di tampak depan.
- Hanya Prof. AI. Karakter tetap lain bisa ditambah kemudian dengan pola folder yang sama.
