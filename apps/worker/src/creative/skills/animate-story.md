---
name: animate-story
description: Motion yang BERCERITA atau punya KARAKTER — explainer bergambar, kisah singkat, sejarah, tokoh dengan wajah, gaya ilustrasi (cut paper, sketchbook, crosshatch, riso, pixel, isometric, math). Adaptasi skill "animate" (cth9191/animate, MIT) ke kontrak Remotion kita. Pakai bila brief meminta karakter, tokoh, maskot, storytelling, cerita, ilustrasi, animasi kartun/kertas/sketsa, atau "beda dari biasanya".
---

# Animate untuk Mode Kreatif (cerita dan karakter)

Skill asli (folder `animate/` di sebelah berkas ini) membuat video `<canvas>` procedural dengan alur interaktif dan tool shell.
Di sini kamu TIDAK punya shell, tidak bisa bertanya ke pengguna, dan menulis Remotion (`CreativeOverlay.tsx`) di bawah `contract.md`.
Jadi pakai ILMUNYA (cerita, frame, gaya, kit gambar), bukan alurnya. `contract.md` tetap menang bila bertentangan.

## Kapan dipakai
- Brief minta karakter/tokoh/maskot, cerita, storytelling, explainer bergambar, sejarah singkat, gaya ilustrasi, atau sesuatu yang "beda".
- Tidak perlu untuk tipografi kinetik biasa, lower third, atau judul: itu tetap skill lain.

## Yang dibaca (urut)
1. `animate/craft.md` — aturan inti: cerita, frame, motion, timing, kode.
2. `animate/grammar/FORMATS.md` — pilih SATU format cerita (mesin plot). F2 (kronologi/morph), F4 (misi), F5 (perjalanan hero tetap) yang terbukti; sebut di notes.md bila memilih yang lain.
3. `animate/grammar/STORY.md` dan `animate/grammar/FRAME.md` — aturan beat dan isi satu key frame.
4. `animate/styles/README.md`, lalu `STYLE.md` + `kit.js` dari SATU gaya yang cocok. Untuk karakter dengan wajah: `cut-paper` (fungsi `person`, `face`, `hand`, `cat`, `mug`, `plant`) atau `sketchbook`/`crosshatch`.
5. `animate/kit/core.js` (RNG, easing, garis tangan, wobble, hatch, grain, kamera) dan `animate/kit/morph.js` (era, push-in, jembatan morph) sebagai rujukan rumus.
6. Bila ragu bentuk utuhnya: `animate/examples/history-of-ai/`.

## Yang TIDAK berlaku di sini
- Check-in (story/look/storyboard) dan AskUserQuestion: ganti dengan rencana tertulis di `notes.md` (lihat bawah), lalu langsung buat.
- `tools/*.mjs`, `build.mjs`, `index.html`, Playwright, ffmpeg, `review.mjs`: tidak ada. Validasi kita sendiri yang merender still.
- `score.js` (musik sintetis): tidak ada audio dari kode. Efek suara lewat `sfx.json` (contract.md).
- Web search untuk fakta: tidak ada jaringan. Jangan menulis klaim faktual yang tidak ada di brief/knowledge; tandai di notes.md.
- Voice-over ElevenLabs/`voice.mjs`: suara sudah ada. Waktu kata = `data.words` (detik timeline hasil). "Suara adalah jam": beat dimulai ±0,3 dtk sesudah kalimat sebelumnya, momen besar jatuh pada kata yang menyebutnya.
- Font sistem (`HANDF` dsb.): pakai `data.fonts.*` saja.

## Cara memindahkan kit ke Remotion
- Waktu: `const frame = useCurrentFrame(); const { fps } = useVideoConfig(); const t = frame / fps;` Gaya "on 2s": `const TT = Math.floor(frame / 2) * 2 / fps;` dan boil `const B = Math.floor(frame / 2);`.
- Gambar dengan SVG (paling mudah dibaca validator) ATAU satu `<canvas width={data.width} height={data.height} style={{ width: "100%", height: "100%" }} ref={ref} />` yang digambar ulang PENUH tiap frame di `React.useLayoutEffect(() => { const ctx = ref.current?.getContext("2d"); ... }, [frame])`. Bersihkan kanvas tiap frame; tidak ada state yang terbawa antar frame.
- Salin fungsi yang kamu butuhkan ke berkasmu (bukan impor). `ctx` dijadikan parameter, bukan global. `W/H` = `data.width/data.height`.
- Acak hanya dari `RNG(...)` milik core.js (mulberry32 + hash, deterministik) atau `random(seed)` dari remotion. Dilarang `Math.random`, `this`, `window`, `document`, timer — kode yang menyalin kata-kata itu akan DITOLAK validator.
- Ukuran dan posisi relatif terhadap `data.width`/`data.height` (9:16, 4:5, 16:9). Hormati area aman: teks tidak di 12% bawah/atas pada 9:16.

## Project video (ada orang bicara) vs project motion
- **Project video:** overlay di atas rekaman. Cerita bergambar muncul sebagai SISIPAN di rentang tertentu (full-frame 2–6 dtk untuk ilustrasi poin penting, atau panel/kartu di sebagian layar) lalu kembali ke pembicara. Jangan menutup wajah pembicara sepanjang video. Karakter bisa "menemani" di sudut saat pembicara tampil.
- **Project motion:** `CreativeOverlay.tsx` adalah seluruh video; cerita penuh dari awal sampai akhir.
- Bila ada design system (`design-system/`), palet dan font-nya mengalahkan palet bawaan gaya; tetap pertahankan tekstur/garis gaya.

## Rencana wajib di notes.md (pengganti check-in)
Tulis SEBELUM kode:
1. Ide satu kalimat + "device" yang bisa diucapkan (mis. "tokoh membawa lampu yang makin terang tiap bab").
2. Format (dari FORMATS.md) dan gaya, beserta alasannya.
3. Tabel beat: detik mulai–selesai (dari `data.words`), apa yang terjadi, jembatan ke beat berikutnya, sfx bila ada.
4. Hero: satu tokoh sederhana dari awal sampai akhir, satu ciri identitas yang tetap (warna, mata, bentuk).
Setelah selesai: beat mana yang paling lemah dan apa yang tidak sempat dikerjakan.

## Aturan inti yang paling sering dilupakan (dari craft.md/STORY.md)
- Satu hal tetap yang bisa dipegang mata di tiap frame (hero, panggung, halaman).
- Tiap potongan/transisi punya alasan yang bisa diucapkan; jembatan (match-position, iris, morph bentuk) lebih baik daripada fade.
- Hidup kecil di frame diam: kedip, uap, goyang; gaya karakter butuh 3+ detail latar yang hidup.
- Tempo berubah sesuai makna: awal tenang, bagian perubahan cepat, pertemuan/payoff ditahan.
- Satu gaya per video; kit tidak dicampur.
