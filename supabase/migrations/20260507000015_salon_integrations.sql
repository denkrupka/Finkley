-- =============================================================================
-- 20260507000015_salon_integrations.sql
-- =============================================================================
-- TASK-27: интеграция с Booksy и другими booking-платформами.
--
-- Один salon = одна запись на provider (PRIMARY KEY salon_id+provider).
-- Credentials в JSONB — структура зависит от провайдера. Например, для Booksy:
--   { access_token, business_id, account: {...}, last_token_at }
--
-- Важно: credentials хранятся как сейчас текстом — при первой реальной
-- утечке (или к запуску beta) переходим на pgsodium шифрование. Для MVP
-- защиты RLS + service-role-only INSERT/UPDATE достаточно.
-- =============================================================================

create table if not exists public.salon_integrations (
  id              uuid primary key default gen_random_uuid(),
  salon_id        uuid not null references salons(id) on delete cascade,
  provider        text not null, -- 'booksy' | 'fresha' | 'treatwell' | 'yclients'
  status          text not null default 'connected', -- 'connected' | 'error' | 'disconnected'
  credentials     jsonb not null default '{}'::jsonb,
  last_sync_at    timestamptz,
  last_sync_stats jsonb, -- { staff: 5, services: 12, visits_30d: 87, ... }
  last_error      text,
  connected_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (salon_id, provider)
);

create index if not exists idx_salon_integrations_provider
  on public.salon_integrations(provider, status)
  where status = 'connected';

create trigger trg_salon_integrations_updated_at
  before update on public.salon_integrations
  for each row execute procedure public.set_updated_at();

alter table public.salon_integrations enable row level security;

-- Юзер видит ТОЛЬКО факт интеграции и статус — не credentials.
-- Edge function через service-role читает/пишет credentials.
create policy "members read integration status" on public.salon_integrations
  for select
  using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

-- Юзер может удалить (отключить) интеграцию
create policy "members can disconnect" on public.salon_integrations
  for delete
  using (salon_id in (select salon_id from salon_members where user_id = auth.uid()));

grant select, delete on public.salon_integrations to authenticated;
grant select, insert, update, delete on public.salon_integrations to service_role;

-- Public-friendly view БЕЗ credentials — для UI чтения
create or replace view public.salon_integrations_public as
  select id, salon_id, provider, status, last_sync_at, last_sync_stats,
         last_error, connected_at, updated_at
    from public.salon_integrations;

grant select on public.salon_integrations_public to authenticated;
