-- =============================================================================
-- 20260521000002_salon_notification_prefs.sql
-- =============================================================================
-- Настройки типов уведомлений на уровне салона.
-- Каналы (push/email/telegram) остаются раздельно (weekly_digest_channels,
-- daily_digest_channels, push subscriptions в таблице). Здесь — какие
-- ТИПЫ событий вообще включены.
--
-- Формат jsonb:
--   {
--     "weekly_digest": true,
--     "daily_digest": true,
--     "ai_insights": true,
--     "payment_due_2d": true,
--     "payment_due_1d": true,
--     "payment_due_today": true,
--     "payment_overdue": true,
--     "low_inventory": true,
--     "booksy_new_visits": true,
--     "calendar_conflicts": true
--   }
-- Отсутствие ключа = по умолчанию true (показывать).
-- =============================================================================

alter table public.salons
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.salons.notification_prefs is
  'Какие типы уведомлений включены (jsonb {type→boolean}). Отсутствие ключа = по умолчанию true.';
