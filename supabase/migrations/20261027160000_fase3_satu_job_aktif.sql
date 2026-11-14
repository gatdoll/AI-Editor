-- Fase 3 (perbaikan): satu project hanya boleh punya SATU job aktif per jenis.
-- Pengecekan "sudah ada yang berjalan" di API tidak atomik, sehingga dua permintaan bersamaan
-- bisa sama-sama lolos. Indeks unik parsial ini menutupnya di level database.
-- Aman dijalankan ulang.

-- Bersihkan duplikat aktif yang mungkin sudah terlanjur ada (sisakan yang paling lama)
with ranked as (
  select id,
         row_number() over (partition by project_id, type order by created_at) as rn
  from public.jobs
  where status in ('queued','running')
)
update public.jobs j
   set status = 'cancelled', finished_at = now(), error = 'Dibatalkan: duplikat'
  from ranked r
 where j.id = r.id and r.rn > 1;

create unique index if not exists jobs_one_active_per_type
  on public.jobs (project_id, type)
  where status in ('queued','running');
