-- =============================================================================
-- 20260520000009_staff_time_blocks_external_unique_drop_partial.sql
-- =============================================================================
-- Прошлая миграция (000008) создавала partial unique index с
-- WHERE external_id IS NOT NULL. Это ломает Supabase upsert по
-- onConflict='salon_id,external_source,external_id' — Postgres не может
-- использовать partial index как conflict target без матчинга WHERE в
-- INSERT, поэтому 100+ резервов из Booksy падали с ошибкой
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- Делаем индекс non-partial. В Postgres NULL != NULL для unique-семантики,
-- так что строки с external_id=NULL (ручные блоки в портале) друг другу
-- не мешают.
-- =============================================================================

drop index if exists public.ux_staff_time_blocks_external;

create unique index if not exists ux_staff_time_blocks_external
  on public.staff_time_blocks (salon_id, external_source, external_id);
