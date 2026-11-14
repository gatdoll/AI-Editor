-- Fase 4: hasil render. Aset 'output' menunjuk ke EDL yang dipakai.
-- Jalankan di Supabase Dashboard > SQL Editor. Aman dijalankan ulang.
-- Antrean render memakai tabel `jobs` (type 'render'), satu job aktif per project
-- (indeks unik dari migrasi Fase 3).

alter table public.assets
  add column if not exists edl_id uuid references public.edl(id) on delete set null;

create index if not exists assets_edl_idx on public.assets(edl_id) where edl_id is not null;
