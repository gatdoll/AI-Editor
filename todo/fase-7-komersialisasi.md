# Fase 7: Komersialisasi (Opsional)

Hanya dikerjakan setelah MVP stabil dan keputusan menjual sudah diambil.

## Lisensi (kerjakan dulu)
- [ ] Baca ulang lisensi Remotion (berubah di v5.0)
- [ ] Hitung headcount gabungan; kalau 4+ orang, urus Company License / opsi Automators
- [ ] Pastikan model produk: user merender dari template milik kita, bukan upload kode Remotion sendiri
- [ ] Cek lisensi Editor Starter jika dipakai
- [ ] Cek lisensi repo pihak ketiga yang kodenya dipakai
- [ ] Cek lisensi aset (musik, font, stok, logo)

## Akun dan multi-user
- [ ] Login (Supabase Auth)
- [ ] Isolasi data per user (RLS di semua tabel)
- [ ] Kebijakan penyimpanan dan penghapusan file user

## Kuota dan biaya
- [ ] Hitung biaya nyata per render dan per menit transkrip/analisis
- [ ] Tentukan harga dan kuota render
- [ ] Penghitung kuota + pembatasan saat habis
- [ ] Antrean render adil antar user

## Pembayaran
- [ ] Pilih penyedia pembayaran
- [ ] Alur langganan / top-up
- [ ] Webhook pembayaran + penanganan gagal bayar

## Legal
- [ ] Syarat layanan dan kebijakan privasi
- [ ] Penanganan data video pengguna

## Selesai jika
- Pengguna asing bisa daftar, membayar, dan merender dalam kuota, tanpa pelanggaran lisensi.
