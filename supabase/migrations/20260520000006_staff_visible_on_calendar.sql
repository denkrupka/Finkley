-- =============================================================================
-- 20260520000006_staff_visible_on_calendar.sql
-- =============================================================================
-- staff.visible_on_calendar — флаг для скрытия мастера из главного календаря
-- без отключения is_active. Источник: Booksy `/me/resources/{id}.visible_on_calendar`.
-- В Finkley доступен в dropdown'е по клику на мастера + в StaffEditSheet.
-- =============================================================================

alter table public.staff
  add column if not exists visible_on_calendar boolean not null default true;

comment on column public.staff.visible_on_calendar is
  'Показывать мастера в календаре. Source: Booksy resource.visible_on_calendar (если синканут). Юзер может переопределить.';
