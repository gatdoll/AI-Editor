-- Fase 17: job 'voiceover' (naskah pengguna -> arahan Codex CLI -> suara Supertonic-3 -> waktu kata Whisper).
-- Hasilnya disimpan sebagai file di folder media project, jadi hanya jenis job yang berubah.
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check
  check (type in ('ingest','transcribe','analyze','render','prompt','creative','preview','denoise','voiceover'));
