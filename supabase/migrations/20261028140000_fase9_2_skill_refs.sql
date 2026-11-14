-- Fase 9.2: commit skill yang dipakai dicatat per versi kreatif ({"remotion": sha, "shotcraft": sha, "toolkit": sha}).
-- Jalankan di Supabase Dashboard > SQL Editor SETELAH 20261028120000_fase9_kreatif.sql. Aman dijalankan ulang.
alter table public.creative_versions add column if not exists skill_refs jsonb not null default '{}'::jsonb;
