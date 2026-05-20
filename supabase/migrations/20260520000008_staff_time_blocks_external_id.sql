-- =============================================================================
-- 20260520000008_staff_time_blocks_external_id.sql
-- =============================================================================
-- Booksy reservation sync: импорт «Rezerwacja czasu» из Booksy /reservations
-- → public.staff_time_blocks (kind='reservation'). Чтобы избежать дублей
-- на повторных синках, добавляем external_source + external_id и unique
-- партиальный индекс по (salon_id, external_source, external_id).
-- =============================================================================

alter table public.staff_time_blocks
  add column if not exists external_source text,
  add column if not exists external_id text;

create unique index if not exists ux_staff_time_blocks_external
  on public.staff_time_blocks (salon_id, external_source, external_id)
  where external_id is not null;

comment on column public.staff_time_blocks.external_source is
  'Источник импорта блокировки (например, booksy). NULL для блоков, созданных в портале вручную.';
comment on column public.staff_time_blocks.external_id is
  'ID блокировки в external системе. Уникален в рамках (salon_id, external_source).';

-- =============================================================================
-- Бэкфилл duration_min на booksy-визитах
-- =============================================================================
-- До этого изменения syncVisits не записывал duration_min и UI рендерил
-- карточку по services.default_duration_min. Если в Booksy юзер бронировал
-- кастомную длительность (Manicure hybrydowy 2ч при дефолте 1ч), карточка
-- сжималась до 1ч (image #2 vs image #1).
--
-- NULL'им duration_min на всех booksy-визитах — следующий синк подтянет
-- корректное значение из (booked_till - booked_from). Ручные правки
-- длительности в портале для booksy-визитов до этого момента не поддер-
-- живались UI, так что edge case минимален.
update public.visits
set duration_min = null
where source = 'booksy';
