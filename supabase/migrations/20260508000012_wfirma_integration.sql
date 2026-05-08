-- =============================================================================
-- 20260508000012_wfirma_integration.sql
-- =============================================================================
-- TASK-31: интеграция с wFirma (PL bookkeeping).
--
-- Что делает миграция:
--   1) expenses.metadata jsonb — для wfirma_expense_id, wfirma_ksef_id,
--      vendor_nip и пары currency_original/original_amount_cents
--      (когда расход в EUR, wFirma сама конвертит в PLN — мы храним оба).
--   2) wfirma_sync_triggers — одноразовые токены для pg_cron → edge function
--      (по аналогии с booksy_sync_triggers, ADR-008).
--
-- Что миграция НЕ делает:
--   - не меняет salon_integrations: credentials jsonb достаточно для wFirma
--     (структура описана в ADR-011)
--   - не создаёт expense_categories — дефолтная «Импорт wFirma» категория
--     создаётся per-salon в edge function wfirma-proxy при первом sync
--   - не настраивает pg_cron — это в 20260508000013_wfirma_sync_cron.sql
-- =============================================================================

-- 1) expenses.metadata
alter table public.expenses
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Index для быстрого lookup по wfirma_expense_id внутри metadata
-- (используется при дедупликации в sync — UNIQUE constraint
-- (salon_id, source, external_id) делает основную работу, но
-- иногда удобнее искать по metadata напрямую).
create index if not exists idx_expenses_wfirma_id
  on public.expenses ((metadata ->> 'wfirma_expense_id'))
  where (metadata ->> 'wfirma_expense_id') is not null;

-- 2) wfirma_sync_triggers — одноразовые токены для cron-вызовов
create table if not exists public.wfirma_sync_triggers (
  token       uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.wfirma_sync_triggers enable row level security;
create policy "no public access to wfirma_sync_triggers" on public.wfirma_sync_triggers
  for all using (false) with check (false);
grant select, insert, update on public.wfirma_sync_triggers to service_role;

create index if not exists idx_wfirma_sync_triggers_expires
  on public.wfirma_sync_triggers(expires_at)
  where used_at is null;
