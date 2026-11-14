-- Fase 2: project, asset, transkrip, antrean job.
-- Jalankan di Supabase Dashboard > SQL Editor (proyek yang sama dengan SUPABASE_URL di .env).
-- Aman dijalankan ulang (IF NOT EXISTS / CREATE OR REPLACE).
-- Akses data hanya lewat service role (server). RLS aktif tanpa policy = anon/authenticated ditolak.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- projects
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  status      text not null default 'created'
              check (status in ('created','uploading','ingesting','transcribing','ready','failed')),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ assets
create table if not exists public.assets (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  kind           text not null check (kind in ('raw','audio','output')),
  storage_bucket text not null default 'local',  -- 'local' = file di disk (MEDIA_DIR); storage_path relatif
  storage_path   text not null,
  size_bytes     bigint,
  sha256         text,                       -- bukti file mentah tidak berubah (aturan 1)
  duration_s     numeric,
  width          integer,
  height         integer,
  fps            numeric,
  created_at     timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);
create index if not exists assets_project_idx on public.assets(project_id, kind);

-- Aturan 1: aset 'raw' tidak boleh diubah lokasi, jenis, atau checksum-nya setelah checksum terisi.
create or replace function public.assets_protect_raw()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.kind = 'raw' then
    if new.kind is distinct from old.kind
       or new.storage_bucket is distinct from old.storage_bucket
       or new.storage_path is distinct from old.storage_path
       or (old.sha256 is not null and new.sha256 is distinct from old.sha256) then
      raise exception 'Aset mentah tidak boleh diubah (aturan 1)';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assets_protect_raw_trg on public.assets;
create trigger assets_protect_raw_trg
  before update on public.assets
  for each row execute function public.assets_protect_raw();

--------------------------------------------------------------- transcripts
create table if not exists public.transcripts (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references public.assets(id) on delete cascade,
  language       text,
  engine         text not null,              -- mis. 'whisper.cpp'
  model          text,                       -- mis. 'medium'
  words          jsonb not null default '[]'::jsonb,   -- [{text,start,end,confidence}] (detik)
  original_words jsonb,                      -- salinan hasil mesin, terisi saat koreksi pertama
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists transcripts_asset_idx on public.transcripts(asset_id);

-- -------------------------------------------------------------------- jobs
-- Antrean umum untuk worker. Fase 2: ingest, transcribe. Fase 3: analyze. Fase 4: render
-- (menggantikan tabel render_jobs di brief; satu antrean, satu pola status).
create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  type        text not null check (type in ('ingest','transcribe','analyze','render')),
  status      text not null default 'queued'
              check (status in ('queued','running','done','failed','cancelled')),
  progress    numeric not null default 0 check (progress >= 0 and progress <= 1),
  payload     jsonb not null default '{}'::jsonb,
  error       text,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index if not exists jobs_queue_idx on public.jobs(status, created_at) where status in ('queued','running');
create index if not exists jobs_project_idx on public.jobs(project_id, created_at desc);

-- Ambil satu job 'queued' secara atomik (aman untuk lebih dari satu worker).
create or replace function public.claim_next_job(p_types text[])
returns public.jobs
language plpgsql
set search_path = ''
as $$
declare
  j public.jobs;
begin
  select * into j
  from public.jobs
  where status = 'queued' and type = any(p_types)
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.jobs
     set status = 'running', started_at = now(), attempts = attempts + 1
   where id = j.id
   returning * into j;
  return j;
end;
$$;

-- Hanya service role yang boleh memanggil fungsi antrean.
revoke all on function public.claim_next_job(text[]) from public, anon, authenticated;
grant execute on function public.claim_next_job(text[]) to service_role;

-- --------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

drop trigger if exists transcripts_touch on public.transcripts;
create trigger transcripts_touch before update on public.transcripts
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------- RLS
alter table public.projects    enable row level security;
alter table public.assets      enable row level security;
alter table public.transcripts enable row level security;
alter table public.jobs        enable row level security;
-- Sengaja tanpa policy: hanya service role (bypass RLS) yang bisa membaca/menulis.

-- Catatan: video disimpan di disk lokal (folder data/media), BUKAN di Supabase Storage,
-- jadi tidak ada bucket dan tidak ada batas ukuran upload dari Supabase.
