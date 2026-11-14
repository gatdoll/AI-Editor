# Referensi video untuk prompt editing

Di panel **Prompt**, buka **＋ Referensi gaya**. Unggah satu video atau tempel link lalu klik **Pasang**. Pilih detik awal cuplikan, tulis aspek gaya yang ingin diadaptasi, lalu **Kirim**. Codex dipilih otomatis karena analisis visual versi ini memakai lampiran gambar Codex CLI. Prompt teks tanpa referensi tetap mendukung Claude maupun Codex.

Contoh:

> Tiru gerakan teks dan palet warna referensi ini. Buat kameranya lebih halus. Pertahankan isi subtitle, judul, rasio, cut, dan audio saya. Jangan render dulu.

Prompt kosong dengan lampiran berarti mengadaptasi gaya visual. URL yang hanya ditulis dalam teks prompt belum menjadi lampiran; gunakan kolom **Link video referensi**.

## Input dan batas

- Upload MP4, MOV, MKV, WebM, M4V: maksimal 150 MB. File dikirim secara streaming ke penyimpanan referensi, bukan ke aset video mentah.
- Tautan video publik: YouTube/watch/Shorts/youtu.be; Instagram `/reel/`, `/reels/`, `/p/`; TikTok `/@akun/video/`, `vm.tiktok.com`, `vt.tiktok.com`, dan `/t/`.
- Tautan profil, playlist, host lain, HTTP tanpa TLS, kredensial dalam URL, dan port custom ditolak. Query pelacakan dibuang.
- Unduhan tautan dibatasi 150 MB, video 20 menit, dan waktu pengunduhan 3 menit. Tidak mengambil cookie browser atau melewati login. Jika platform menolak akses, gunakan file yang diunggah sendiri.
- Analisis membaca hingga 16 frame berurutan dalam empat burst, pada cuplikan maksimal 30 detik mulai waktu pilihan. Frame dikirim ke Codex ketika **Kirim** ditekan, memakai akun CLI yang sudah login. Audio tidak dikirim/dianalisis. Gerakan/transisi di sela sampel, beat, easing presisi, dan semua detail video tidak dapat dipastikan.
- Hasil merupakan adaptasi ke kontrol editor yang tersedia. Bukan salinan persis komposisi, template, JSX, musik, isi subtitle, atau semua transisi referensi.

Situs sosial dapat berubah atau meminta login. Dukungan extractor tidak menjamin semua link berhasil; lihat [daftar dukungan yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).

## Cara kerja

1. Referensi tersimpan di `data/media/projects/<projectId>/references/<referenceId>/`, atau direktori `MEDIA_DIR` yang dikonfigurasi. Metadata hanya dibaca melalui pasangan project/id yang divalidasi UUID. Video upload disimpan agar referensi tetap tersedia; melepaskan lampiran di composer hanya membatalkan pemakaiannya untuk prompt tersebut.
2. Request prompt menyimpan ID referensi dan detik awal di payload job. Tidak membutuhkan migrasi database baru.
3. Worker mengunduh link publik bila diperlukan, memeriksa metadata, dan membuat frame PNG dengan FFmpeg. PNG menghindari masalah encoder JPEG pada input YUV video sosial. Durasi stream video digunakan agar sampel akhir tidak masuk ke ekor audio yang lebih panjang.
4. Analisis visual menghasilkan ringkasan, keterbatasan, dan pengaturan gaya tervalidasi. Hanya `set_style` tanpa perubahan rasio dan `set_param` yang bisa berasal dari referensi. Teks/instruksi di dalam gambar tidak boleh dieksekusi. Tool shell dan web Codex dinonaktifkan untuk analisis gambar.
5. Prompt pengguna diterjemahkan terpisah, tanpa teks/gambar referensi. Pengaturan eksplisit pengguna berjalan setelah dasar referensi. Eksekusi memakai jalur validasi dan undo yang sama seperti prompt biasa. Jika pengambilan/analisis referensi gagal, proses berhenti sebelum gaya/cut diubah.
6. Riwayat menampilkan sumber, jumlah frame, rentang waktu, observasi, keterbatasan, dan hasil operasi aktual. Unduhan sementara dan frame analisis dibersihkan setelah proses; upload referensi dan metadata riwayat disimpan.

## Menyiapkan worker baru

```powershell
python -m pip install -r scripts/reference-requirements.txt
```

Python + yt-dlp hanya diperlukan untuk tautan. Set `REFERENCE_PYTHON` ke path executable Python bila perintah `python` tidak tersedia di PATH. FFmpeg/ffprobe menggunakan paket Remotion yang sudah ada. Unduhan memeriksa alamat publik pada koneksi/DNS termasuk pengalihan, mematikan plugin/config/cookie browser, dan memiliki batas waktu/ukuran. Tidak mengunduh video live.

## Verifikasi

- Tes URL, batas sampel, isolasi project, whitelist operasi, dan pelestarian judul/rasio/cut: `node apps/worker/test/reference.test.ts`.
- Regresi codec: `node apps/worker/test/reference-media.test.ts` menghasilkan video YUV 15 fps dengan audio lebih panjang, lalu memverifikasi 16 PNG, penolakan video rusak, dan waktu di luar durasi.
- Tes tujuan jaringan lokal/private/multicast: `python scripts/test-reference-network.py`.
- Uji integrasi upload melalui API pada proyek sintetis: 16 frame dari 18 detik, 17 operasi gaya, tanpa perubahan EDL, keputusan cut, judul, atau rasio. Tombol file chooser browser terhalang izin file URL ekstensi otomasi; upload diuji melalui endpoint streaming. Tautan YouTube diuji melalui UI dan worker. Instagram/TikTok divalidasi formatnya; belum ada uji langsung link pengguna pada kedua platform itu.
