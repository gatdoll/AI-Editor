-- Fase 15 (perbaikan 30 Okt 2026): batas ukuran kode Mode Kreatif 60 KB -> 200 KB.
-- Revisi bertumpuk dari brief besar menembus 60 KB (60.300 byte) sehingga perintah gagal walau kodenya benar.
-- Harus sama dengan CREATIVE.maxCodeBytes di config/index.ts. Aman dijalankan ulang.
alter table public.creative_versions drop constraint if exists creative_versions_code_overlay_check;
alter table public.creative_versions drop constraint if exists creative_versions_code_video_check;
alter table public.creative_versions add constraint creative_versions_code_overlay_check
  check (code_overlay is null or octet_length(code_overlay) <= 200000);
alter table public.creative_versions add constraint creative_versions_code_video_check
  check (code_video is null or octet_length(code_video) <= 200000);
