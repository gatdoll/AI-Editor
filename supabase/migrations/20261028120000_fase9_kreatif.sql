-- Fase 9.1: Mode Kreatif (AI menulis kode Remotion).
-- Jalankan di Supabase Dashboard > SQL Editor SETELAH migrasi sebelumnya. Aman dijalankan ulang.

-- 1) job baru: 'creative' (satu job aktif per project sudah dijamin indeks jobs_one_active_per_type)
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('ingest','transcribe','analyze','render','prompt','creative'));

-- 2) versi kode kreatif. Versi lama tidak pernah dihapus otomatis; membatalkan = mengaktifkan versi lain.
--    Versi baru berstatus 'draft' dan baru dipakai setelah pengguna mengaktifkannya (9.4).
create table if not exists public.creative_versions (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  prompt            text not null check (length(trim(prompt)) > 0 and length(prompt) <= 8000),
  model             text not null,
  code_overlay      text check (code_overlay is null or octet_length(code_overlay) <= 60000),  -- = CREATIVE.maxCodeBytes
  code_video        text check (code_video is null or octet_length(code_video) <= 60000),
  replaces_captions boolean not null default false,
  notes             text,                                  -- catatan AI: apa yang dibuat, resep/skill yang dipakai
  stills            text[] not null default '{}',          -- path storage 4 still pratinjau
  status            text not null default 'draft' check (status in ('draft','aktif','ditolak','gagal')),
  error             text,
  duration_ms       integer,
  created_at        timestamptz not null default now(),
  -- versi yang bisa dipakai wajib punya kode; versi 'gagal' dan 'ditolak' boleh tanpa kode
  constraint creative_versions_has_code
    check (status in ('gagal','ditolak') or code_overlay is not null or code_video is not null),
  -- 'gagal' wajib menyimpan alasannya (aturan 7: tidak ada yang gagal diam-diam)
  constraint creative_versions_failed_has_error
    check (status <> 'gagal' or (error is not null and length(trim(error)) > 0))
);
create index if not exists creative_versions_project_idx on public.creative_versions(project_id, created_at desc);
-- paling banyak satu versi aktif per project
create unique index if not exists creative_versions_one_active on public.creative_versions(project_id) where status = 'aktif';
alter table public.creative_versions enable row level security;   -- tanpa policy: hanya service role

-- 3) projects.style.creativeId (jsonb, tanpa kolom baru): uuid versi aktif, atau tidak ada = Mode Kreatif mati.
--    Render memakai versi yang tercatat di payload job render, bukan yang aktif saat ini.
