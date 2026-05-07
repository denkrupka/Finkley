-- =============================================================================
-- Auto-sync для Booksy интеграций.
--
-- Архитектура (rendezvous-token, как у weekly-digest):
--   1) pg_cron каждые 2 минуты вызывает cron_run_booksy_syncs()
--   2) Функция выбирает все salon_integrations с истёкшим интервалом
--      (last_sync_at IS NULL OR last_sync_at < now() - sync_interval)
--   3) Для каждой due integration создаёт одноразовый токен и шлёт async POST
--      на booksy-proxy с {action:'cron_sync_one', salon_id, token}
--   4) Edge function валидирует токен → запускает sync для этого салона
-- =============================================================================

-- Колонка интервала (минуты). Default 60 — раз в час, баланс между
-- актуальностью и rate-limit Booksy. Минимум 2 (cron-tick), максимум 1440 (сутки).
alter table public.salon_integrations
  add column if not exists sync_interval_minutes int not null default 60;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_sync_interval_range'
  ) then
    alter table public.salon_integrations
      add constraint chk_sync_interval_range
      check (sync_interval_minutes >= 2 and sync_interval_minutes <= 1440);
  end if;
end$$;

-- Расширяем public view: UI должен показывать выбранный интервал
create or replace view public.salon_integrations_public as
  select id, salon_id, provider, status, last_sync_at, last_sync_stats,
         last_error, connected_at, updated_at, sync_interval_minutes
    from public.salon_integrations;

grant select on public.salon_integrations_public to authenticated;

-- Таблица одноразовых токенов для cron-вызовов
create table if not exists public.booksy_sync_triggers (
  token       uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.booksy_sync_triggers enable row level security;
create policy "no public access to booksy_sync_triggers" on public.booksy_sync_triggers
  for all using (false) with check (false);
grant select, insert, update on public.booksy_sync_triggers to service_role;

create index if not exists idx_booksy_sync_triggers_expires
  on public.booksy_sync_triggers(expires_at)
  where used_at is null;

-- pg_net уже включён, но идемпотентно
create extension if not exists pg_net with schema extensions;

-- =============================================================================
-- cron_run_booksy_syncs — для каждой due integration кикает edge function
-- =============================================================================
create or replace function public.cron_run_booksy_syncs()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration record;
  v_token uuid;
  v_count int := 0;
begin
  -- Чистим старые токены чтобы таблица не росла
  delete from public.booksy_sync_triggers
  where expires_at < now() - interval '1 hour';

  -- Перебираем все Booksy integrations с истёкшим интервалом
  for v_integration in
    select id, salon_id, sync_interval_minutes
    from public.salon_integrations
    where provider = 'booksy'
      and status = 'connected'
      and (
        last_sync_at is null
        or last_sync_at < now() - (sync_interval_minutes || ' minutes')::interval
      )
  loop
    insert into public.booksy_sync_triggers(salon_id)
    values (v_integration.salon_id)
    returning token into v_token;

    perform net.http_post(
      url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/booksy-proxy',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'action', 'cron_sync_one',
        'salon_id', v_integration.salon_id::text,
        'token', v_token::text
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.cron_run_booksy_syncs() from public;
grant execute on function public.cron_run_booksy_syncs() to service_role;

-- =============================================================================
-- Cron: каждые 2 минуты (минимальный интервал, который может выбрать юзер)
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'booksy-auto-sync') then
    perform cron.unschedule('booksy-auto-sync');
  end if;
end$$;

select cron.schedule(
  'booksy-auto-sync',
  '*/2 * * * *',
  $$ select public.cron_run_booksy_syncs(); $$
);
