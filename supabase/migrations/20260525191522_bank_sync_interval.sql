-- =============================================================================
-- 20260525191522_bank_sync_interval.sql
-- =============================================================================
-- Per-connection sync_interval для банкинга — симметрично Booksy/wFirma
-- (sync_interval_minutes в salon_integrations).
--
-- Раньше cron `0 */6 * * *` тащил все bank_connections с status='connected'
-- каждые 6 часов, без учёта пользовательских настроек. ТЗ владельца:
-- «если раз на какой-то период — в интеграциях надо делать выбор по времени».
--
-- Теперь:
--   • bank_connections.sync_interval_minutes int (default 360 = 6h)
--   • cron тикает каждые 15 минут, выбирает только те, у которых
--     last_synced_at + interval <= now()
--   • UI в BankingSection даёт юзеру Select на 1h/3h/6h/12h/24h
--
-- Range 60..1440: меньше часа — превышает rate-limit Enable Banking, больше
-- суток — теряем смысл online-режима для отслеживания cash flow.
-- =============================================================================

alter table public.bank_connections
  add column if not exists sync_interval_minutes int not null default 360;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_bank_sync_interval_range'
  ) then
    alter table public.bank_connections
      add constraint chk_bank_sync_interval_range
      check (sync_interval_minutes >= 60 and sync_interval_minutes <= 1440);
  end if;
end$$;

comment on column public.bank_connections.sync_interval_minutes is
  'Период авто-синка в минутах. Cron-tick каждые 15 минут проверяет due. Range 60..1440.';

-- =============================================================================
-- Переписываем cron_run_banking_syncs — теперь учитывает sync_interval_minutes
-- =============================================================================
create or replace function public.cron_run_banking_syncs()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conn record;
  v_token uuid;
  v_count int := 0;
begin
  -- Чистим истёкшие токены
  delete from public.bank_sync_triggers
  where expires_at < now() - interval '1 hour';

  -- Также автоматически переводим в expired connection'ы у которых
  -- consent истёк. Юзер увидит баннер «переподключи банк» в UI и
  -- получит email-нотификацию (см. banking-expiry-notify cron).
  update public.bank_connections
     set status = 'expired',
         last_error = 'consent_expired'
   where status = 'connected'
     and valid_until is not null
     and valid_until < now();

  -- Выбираем только due connections: либо ни разу не синкались, либо
  -- last_synced_at + interval уже прошёл.
  for v_conn in
    select id, salon_id, sync_interval_minutes
      from public.bank_connections
     where status = 'connected'
       and (
         last_synced_at is null
         or last_synced_at < now() - (sync_interval_minutes || ' minutes')::interval
       )
  loop
    insert into public.bank_sync_triggers(connection_id)
    values (v_conn.id)
    returning token into v_token;

    perform net.http_post(
      url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/banking-sync',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'connection_id', v_conn.id::text,
        'cron_token', v_token::text
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- =============================================================================
-- Пере-расписываем cron на каждые 15 минут — минимально-разумный тик для
-- юзеров с sync_interval_minutes=60 (часовой режим).
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'banking-auto-sync') then
    perform cron.unschedule('banking-auto-sync');
  end if;
end$$;

select cron.schedule(
  'banking-auto-sync',
  '*/15 * * * *',
  $$ select public.cron_run_banking_syncs(); $$
);
