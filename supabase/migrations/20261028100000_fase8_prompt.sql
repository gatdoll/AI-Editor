-- Fase 8: edit lewat prompt.
-- Jalankan di Supabase Dashboard > SQL Editor SETELAH migrasi sebelumnya. Aman dijalankan ulang.

-- 1) job baru: 'prompt' (satu job aktif per project sudah dijamin indeks jobs_one_active_per_type)
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('ingest','transcribe','analyze','render','prompt'));

-- 2) gaya video tersimpan di project (sumber kebenaran antara perintah prompt dan layar editor)
alter table public.projects add column if not exists style jsonb not null default '{}'::jsonb;

-- 3) riwayat prompt
create table if not exists public.prompt_runs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  prompt      text not null check (length(trim(prompt)) > 0 and length(prompt) <= 2000),
  provider    text not null check (provider in ('claude','codex')),
  status      text not null default 'queued' check (status in ('queued','running','done','failed')),
  reply       text,                                   -- ringkasan dari AI
  ops         jsonb not null default '[]'::jsonb,     -- operasi yang tervalidasi dan dijalankan
  rejected    jsonb not null default '[]'::jsonb,     -- operasi yang ditolak beserta alasannya
  messages    jsonb not null default '[]'::jsonb,     -- hasil nyata tiap operasi (ditulis kode kita, bukan AI)
  undo        jsonb not null default '{}'::jsonb,     -- snapshot untuk membatalkan: usulan dibuat, gaya lama, kata lama
  undone      boolean not null default false,
  error       text,
  duration_ms integer,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists prompt_runs_project_idx on public.prompt_runs(project_id, created_at desc);
alter table public.prompt_runs enable row level security;   -- tanpa policy: hanya service role

-- 4) usulan dari prompt: jenis 'custom', sumber 'prompt'; tidak harus punya analysis_run
alter table public.cut_suggestions alter column run_id drop not null;
alter table public.cut_suggestions add column if not exists prompt_run_id uuid references public.prompt_runs(id) on delete cascade;

alter table public.cut_suggestions drop constraint if exists cut_suggestions_kind_check;
alter table public.cut_suggestions add constraint cut_suggestions_kind_check
  check (kind in ('retake','correction','filler','pause','unclear','custom'));

alter table public.cut_suggestions drop constraint if exists cut_suggestions_source_check;
alter table public.cut_suggestions add constraint cut_suggestions_source_check
  check (source in ('llm','rule','silence','prompt'));

alter table public.cut_suggestions drop constraint if exists cut_suggestions_has_origin;
alter table public.cut_suggestions add constraint cut_suggestions_has_origin
  check (run_id is not null or prompt_run_id is not null);

create index if not exists cut_suggestions_prompt_idx on public.cut_suggestions(prompt_run_id) where prompt_run_id is not null;
