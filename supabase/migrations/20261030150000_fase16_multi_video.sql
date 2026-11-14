-- Fase 16: banyak video dalam satu project.
-- 1) Posisi tiap video mentah pada sumbu waktu "reel" project (detik). Diisi worker saat ingest dan tidak pernah berubah,
--    jadi semua data yang memakai waktu video mentah (kata, cut, subtitle, judul, kamera, SFX) tetap benar.
--    Project lama (satu video) = offset 0.
-- 2) Satu job aktif per jenis per project sekarang per VIDEO untuk job yang membawa assetId (ingest, pratinjau, noise),
--    agar beberapa video bisa diproses tanpa saling menolak. Job tanpa assetId tetap satu per project.
-- Aman dijalankan ulang.
alter table public.assets add column if not exists reel_offset_s numeric;
update public.assets set reel_offset_s = 0 where kind = 'raw' and reel_offset_s is null and duration_s is not null;

drop index if exists public.jobs_one_active_per_type;
create unique index if not exists jobs_one_active_per_type_asset
  on public.jobs (project_id, type, (coalesce(payload->>'assetId', '')))
  where status in ('queued','running');
