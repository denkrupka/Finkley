-- =============================================================================
-- 20260521000023_broadcast_prefs_default_off.sql
-- =============================================================================
-- Изменение дефолта broadcast_prefs: теперь все каналы по умолчанию ВЫКЛЮЧЕНЫ.
-- Владелец должен явно включить email/sms для каждого типа рассылки в
-- /marketing → Рассылки. Это безопасный дефолт — клиенты не получают
-- ничего автоматом без явного согласия владельца.
--
-- BREAKING: текущие салоны с дефолтом all-true перезаписываем на all-false.
-- Если у кого-то были включены — нужно вручную включить заново.
-- =============================================================================

-- 1. Новый дефолт колонки — all-false
alter table public.salons
  alter column broadcast_prefs set default jsonb_build_object(
    'marketing',       jsonb_build_object('email', false, 'sms', false),
    'visit_reminder',  jsonb_build_object('email', false, 'sms', false),
    'review_request',  jsonb_build_object('email', false, 'sms', false)
  );

-- 2. Backfill: все существующие салоны → all-false (явный consent владельца).
update public.salons
   set broadcast_prefs = jsonb_build_object(
     'marketing',      jsonb_build_object('email', false, 'sms', false),
     'visit_reminder', jsonb_build_object('email', false, 'sms', false),
     'review_request', jsonb_build_object('email', false, 'sms', false)
   );

comment on column public.salons.broadcast_prefs is
  'Per-broadcast-type канальные настройки. Структура: { <kind>: { email: bool, sms: bool } }. '
  'Kinds: marketing | visit_reminder | review_request. Default — всё ВЫКЛЮЧЕНО '
  '(safe-by-default); владелец явно включает каналы в /marketing UI.';
