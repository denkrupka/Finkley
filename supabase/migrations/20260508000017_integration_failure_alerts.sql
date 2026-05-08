-- =============================================================================
-- 20260508000017_integration_failure_alerts.sql
-- =============================================================================
-- Tracking подряд-идущих неудачных sync'ов интеграций (Booksy/wFirma) для
-- Telegram-алерта владельцу. Если 3+ fail подряд — шлём в bug-чат.
-- =============================================================================

alter table public.salon_integrations
  add column if not exists consecutive_failures int not null default 0,
  add column if not exists last_failure_alert_at timestamptz;

comment on column public.salon_integrations.consecutive_failures is
  'Счётчик подряд-идущих fail-sync. Сбрасывается в 0 при успешном sync. При >=3 эдж-функция шлёт telegram-алерт.';

comment on column public.salon_integrations.last_failure_alert_at is
  'Когда последний раз отправили алерт владельцу. Чтобы не спамить, новый алерт можно слать не чаще раза в 24 часа.';
