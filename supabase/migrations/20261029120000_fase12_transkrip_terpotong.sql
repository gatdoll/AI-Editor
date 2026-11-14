-- Fase 12: transkrip dibuat dari video yang SUDAH dipotong (trim/cut yang berlaku saat itu), bukan dari seluruh rekaman.
-- segments = rentang video mentah (detik) yang ditranskrip, [{start,end}]. null = seluruh video (transkrip lama).
alter table public.transcripts add column if not exists segments jsonb;
