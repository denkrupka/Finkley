-- I2 — Унификация unread-счётчика уведомлений.
-- Раньше derive-источники (insights/budgets/upcoming) считали unread по
-- localStorage `finkley:notif-last-seen:<salon>` — это давало per-device
-- счётчик (другой ноутбук видел все нотификации как непрочитанные).
-- Переносим last-seen в profiles, чтобы счётчик был cross-device.
--
-- in_app остаётся с read_at jsonb как было (per-message read_at).
-- last_seen — это "до этой точки времени derive-source nothing-new".

alter table public.profiles
  add column if not exists notifications_last_seen_at timestamptz;

comment on column public.profiles.notifications_last_seen_at is
  'Cross-device last-seen для derive-source notifications (insights/budgets/upcoming). I2.';
