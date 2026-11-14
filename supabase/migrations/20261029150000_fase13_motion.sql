-- Fase 13: project motion graphics (tanpa rekaman) + bahan yang diunggah (logo, gambar, musik, data).

-- 1) jenis project. Project lama = 'video'.
alter table public.projects add column if not exists kind text not null default 'video';
alter table public.projects drop constraint if exists projects_kind_check;
alter table public.projects add constraint projects_kind_check check (kind in ('video','motion'));

-- 2) bahan motion graphics sebagai aset 'material' (bukan file mentah; boleh dihapus pengguna)
alter table public.assets drop constraint if exists assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind in ('raw','audio','output','material'));
alter table public.assets add column if not exists label text;   -- nama tampilan, mis. "logo.png"
alter table public.assets add column if not exists mime text;    -- image/png, audio/mpeg, ...
