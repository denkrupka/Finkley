-- salon_integrations.meta jsonb — persistent state per integration.
--
-- Используется booksy-proxy syncClients для clients_resume_page (pagination
-- resume cursor). Без этой колонки sync преждевременно прерывался на
-- ~1700 клиентах из 2500+, потому что обновление {meta: ...} падало
-- silent (колонка не существовала).
--
-- Отдельно от credentials (encrypted) и config (user settings).

alter table public.salon_integrations
  add column if not exists meta jsonb default '{}'::jsonb;

comment on column public.salon_integrations.meta is
  'Per-integration persistent state — resume-pages, last cursors, sync-progress. Не для credentials (см. credentials колонка), не для user settings (см. config).';
