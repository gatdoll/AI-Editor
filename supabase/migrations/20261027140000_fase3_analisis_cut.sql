-- Fase 3: analisis cut, usulan cut, EDL.
-- Jalankan di Supabase Dashboard > SQL Editor SETELAH migrasi Fase 2.
-- Aman dijalankan ulang. Akses hanya lewat service role (RLS aktif tanpa policy).

-- projects: tambah status 'analyzing'
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('created','uploading','ingesting','transcribing','ready','analyzing','failed'));

-- --------------------------------------------------------------- analysis_runs
-- Satu baris per analisis. Menjalankan ulang dengan provider lain TIDAK menimpa hasil lama.
create table if not exists public.analysis_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  asset_id    uuid not null references public.assets(id) on delete cascade,
  provider    text not null check (provider in ('claude','codex')),
  model       text,
  status      text not null default 'queued' check (status in ('queued','running','done','failed')),
  error       text,
  stats       jsonb not null default '{}'::jsonb,   -- jumlah usulan, potongan teks, token, dll.
  duration_ms integer,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists analysis_runs_project_idx on public.analysis_runs(project_id, created_at desc);

-- ------------------------------------------------------------- cut_suggestions
-- Semua usulan lahir 'pending'. Hanya tindakan pengguna yang mengubahnya (aturan 2).
create table if not exists public.cut_suggestions (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.analysis_runs(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  kind         text not null check (kind in ('retake','correction','filler','pause','unclear')),
  source       text not null check (source in ('llm','rule','silence')),
  start_s      numeric not null check (start_s >= 0),
  end_s        numeric not null,
  orig_start_s numeric not null,
  orig_end_s   numeric not null,
  start_word   integer,
  end_word     integer,
  reason       text not null,
  quote        text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_s > start_s)
);
create index if not exists cut_suggestions_run_idx on public.cut_suggestions(run_id, start_s);
create index if not exists cut_suggestions_project_idx on public.cut_suggestions(project_id);

-- ------------------------------------------------------------------------- edl
-- Daftar segmen yang DIPERTAHANKAN. Satu-satunya sumber kebenaran untuk render.
create table if not exists public.edl (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  run_id      uuid references public.analysis_runs(id) on delete set null,
  version     integer not null,
  segments    jsonb not null,            -- [{start,end}] detik, urut, tidak tumpang tindih
  params      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (project_id, version)
);

-- --------------------------------------------------------------- app_status
-- Status kecil yang ditulis worker (mis. ketersediaan Claude Code CLI / Codex CLI).
create table if not exists public.app_status (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------- updated_at
drop trigger if exists cut_suggestions_touch on public.cut_suggestions;
create trigger cut_suggestions_touch before update on public.cut_suggestions
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------- RLS
alter table public.analysis_runs   enable row level security;
alter table public.cut_suggestions enable row level security;
alter table public.edl             enable row level security;
alter table public.app_status      enable row level security;
-- Sengaja tanpa policy: hanya service role.
