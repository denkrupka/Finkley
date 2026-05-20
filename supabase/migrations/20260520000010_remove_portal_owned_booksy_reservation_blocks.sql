-- =============================================================================
-- 20260520000010_remove_portal_owned_booksy_reservation_blocks.sql
-- =============================================================================
-- До этого фикса при создании визита в портале мы:
--   1. Создавали reservation в Booksy через POST /reservations/
--   2. Сохраняли её reservation_id в visits.external_reservation_id
--   3. На следующем sync эта reservation приходила обратно через /calendar
--      и записывалась в staff_time_blocks как обычный booksy-резерв
--      → визуальное наложение штрихованного блока поверх визита (Image #20).
--
-- Чистим уже существующие дубли: удаляем staff_time_blocks с
-- external_source='booksy' и external_id='res:{id}', где этот id совпадает
-- с visits.external_reservation_id того же салона.
-- =============================================================================

delete from public.staff_time_blocks b
using public.visits v
where b.salon_id = v.salon_id
  and b.external_source = 'booksy'
  and b.external_id is not null
  and v.external_reservation_id is not null
  and v.deleted_at is null
  -- external_id формата 'res:{id}' или 'res:{id}:{stafferExt}' — берём
  -- числовую часть до первого ':' (после префикса 'res:')
  and split_part(replace(b.external_id, 'res:', ''), ':', 1) = v.external_reservation_id;
