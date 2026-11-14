-- Fase 19: job 'assets' (riset aset Opinion Motion: AI mencari foto tokoh/artikel berita di web, kode kita mengunduh dan memotret).
-- Status riset dan kandidat disimpan sebagai file di folder media project; project Opinion Motion = project motion dengan
-- penanda style.motion.opini. Jadi hanya jenis job yang berubah.
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('ingest','transcribe','analyze','render','prompt','creative','preview','denoise','voiceover','assets'));
