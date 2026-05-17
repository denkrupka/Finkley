-- ─────────────────────────────────────────────────────────────────────────────
-- 20260517000003_clients_socials.sql
--
-- Соцсети клиента — для связи в Instagram/Facebook/Telegram/etc. Хранится
-- jsonb-массив объектов {kind, handle}, где kind = 'instagram' | 'facebook'
-- | 'telegram' | 'custom' (свой тип), handle = логин / номер / ссылка.
--
-- Пример: [{"kind":"instagram","handle":"@anna_ko"},{"kind":"telegram","handle":"+48..."}]
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clients
  add column if not exists socials jsonb not null default '[]'::jsonb;

comment on column public.clients.socials is
  'Соцсети клиента: jsonb-массив {kind, label?, handle}. kind: instagram|facebook|telegram|custom.';
