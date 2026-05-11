-- =============================================================================
-- 20260510000006_ksef_integration.sql
-- =============================================================================
-- TASK-46: прямой коннект к КСеФ (Krajowy System e-Faktur).
--
-- Что делает миграция:
--   1) ksef_sync_triggers — одноразовые токены для pg_cron → edge function
--      (по аналогии с booksy_sync_triggers / wfirma_sync_triggers).
--   2) Уникальный частичный индекс на expenses.metadata->>'ksef_id' —
--      детерминированная дедупликация фактур, пришедших из нескольких
--      порталов (КСеФ + wFirma + ...). См. ADR-013 §D.
--
-- Что миграция НЕ делает:
--   - не создаёт expense_categories — дефолтная «Импорт КСеФ» создаётся
--     в edge function ksef-proxy при первом sync (по аналогии с wFirma).
--   - не настраивает pg_cron — это в 20260510000007_ksef_sync_cron.sql
-- =============================================================================

-- 1) ksef_sync_triggers — одноразовые токены для cron-вызовов
create table if not exists public.ksef_sync_triggers (
  token       uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.ksef_sync_triggers enable row level security;
create policy "no public access to ksef_sync_triggers" on public.ksef_sync_triggers
  for all using (false) with check (false);
grant select, insert, update on public.ksef_sync_triggers to service_role;

create index if not exists idx_ksef_sync_triggers_expires
  on public.ksef_sync_triggers(expires_at)
  where used_at is null;

-- 2) Уникальный частичный индекс для дедупликации по NumerKSeF
--
-- В реестре КСеФ NumerKSeF уникален в масштабе всей Польши, но мы делаем
-- индекс per-salon (на metadata->>'ksef_id') чтобы:
--   - не блокировать тестовый/реальный импорт между разными салонами
--   - выловить дубль внутри салона (один и тот же КСеФ-id попал из КСеФ
--     direct + wFirma) и обработать UNIQUE_VIOLATION в sync-логике
--
-- Индекс частичный: только для строк, где ksef_id есть и расход не удалён.
-- Где-то 95% расходов будут без ksef_id (manual/ocr/booksy) — индекс остаётся
-- очень компактным.
create unique index if not exists idx_expenses_salon_ksef_id
  on public.expenses (salon_id, (metadata->>'ksef_id'))
  where metadata->>'ksef_id' is not null and deleted_at is null;
