-- =============================================================================
-- 20260521000022_broadcast_prefs.sql
-- =============================================================================
-- Per-salon настройки рассылок: какие типы (marketing / visit_reminder /
-- review_request) идут по каким каналам (email / sms).
--
-- Используется в:
--   - client-overdue-push  (kind='visit_reminder')
--   - send-review-request  (kind='review_request')
--   - будущие маркетинговые рассылки (kind='marketing')
--
-- Default: всё включено (текущее поведение — никаких регрессий).
-- UI: /marketing → Рассылки → таблица с чекбоксами.
-- =============================================================================

alter table public.salons
  add column if not exists broadcast_prefs jsonb not null default jsonb_build_object(
    'marketing',       jsonb_build_object('email', true, 'sms', true),
    'visit_reminder',  jsonb_build_object('email', true, 'sms', true),
    'review_request',  jsonb_build_object('email', true, 'sms', true)
  );

comment on column public.salons.broadcast_prefs is
  'Per-broadcast-type канальные настройки. Структура: { <kind>: { email: bool, sms: bool } }. '
  'Kinds: marketing | visit_reminder | review_request. Default — всё включено.';

-- Существующие салоны: default уже проставился ALTER'ом. На случай если кто-то
-- проставил вручную NULL — нормализуем.
update public.salons
   set broadcast_prefs = jsonb_build_object(
     'marketing',      jsonb_build_object('email', true, 'sms', true),
     'visit_reminder', jsonb_build_object('email', true, 'sms', true),
     'review_request', jsonb_build_object('email', true, 'sms', true)
   )
 where broadcast_prefs is null;
