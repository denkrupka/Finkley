-- =============================================================================
-- 20260520000004_drop_salon_working_hours.sql
-- =============================================================================
-- Удаляем избыточные salons.working_hours + working_hours_external_snapshot,
-- которые я добавил в 20260520000001 не заметив, что уже существует
-- salons.opening_hours (с миграции 20260515000011) с активным UI
-- (SalonHoursCard). Booksy sync будет писать в opening_hours.
--
-- Безопасно: working_hours был только что добавлен в той же ветке релиза,
-- никаких данных в нём пока нет (был default за миллисекунды до этой
-- миграции). Snapshot перевешиваем на opening_hours_external_snapshot
-- для консистентности (для будущего anti-overwrite).
-- =============================================================================

alter table public.salons
  drop column if exists working_hours,
  drop column if exists working_hours_external_snapshot,
  add column if not exists opening_hours_external_snapshot jsonb;

comment on column public.salons.opening_hours_external_snapshot is
  'Snapshot последнего значения opening_hours из внешней системы (Booksy /shifts/opening_hours). Для anti-overwrite (ADR-017 §4).';
