-- Fase 11: salinan pratinjau untuk video yang tidak bisa diputar browser (mis. MOV HEVC dari iPhone) dan reduksi noise.
-- File mentah tetap tidak disentuh (aturan 1): keduanya file turunan di folder media, render tetap dari file mentah.

-- 1) jenis job baru
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('ingest','transcribe','analyze','render','prompt','creative','preview','denoise'));

-- 2) status salinan pratinjau per aset mentah.
--    null = belum diperiksa; 'tidak_perlu' = browser bisa memutar file mentah; 'antre' | 'siap' | 'gagal'
alter table public.assets add column if not exists preview_status text
  check (preview_status in ('tidak_perlu','antre','siap','gagal'));
alter table public.assets add column if not exists preview_path text;   -- relatif ke MEDIA_DIR, terisi saat 'siap'
alter table public.assets add column if not exists preview_error text;
