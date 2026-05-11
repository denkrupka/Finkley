-- =============================================================================
-- 20260510000007_ksef_sync_cron.sql
-- =============================================================================
-- TASK-46: pg_cron → ksef-proxy для авто-синка фактур из КСеФ.
--
-- Архитектура (rendezvous-token, копия wFirma auto-sync):
--   1) pg_cron каждые 15 минут вызывает cron_run_ksef_syncs()
--   2) Функция выбирает все salon_integrations.provider='ksef' с истёкшим
--      sync_interval_minutes (дефолт — 60 минут per salon)
--   3) Для каждой due integration создаёт одноразовый токен и шлёт async POST
--      на ksef-proxy {action:'cron_sync_one', salon_id, token}
--   4) Edge function валидирует токен → запускает sync для этого салона
--
-- 15 минут tick — фактуры в КСеФ не появляются «горячо», достаточно чтобы
-- к концу часа гарантированно подтянуть. Минимальный per-salon интервал
-- 60 минут защищает от rate-limit КСеФ-API.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.cron_run_ksef_syncs()
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
  delete from public.ksef_sync_triggers
  where expires_at < now() - interval '1 hour';

  for v_integration in
    select id, salon_id, sync_interval_minutes
    from public.salon_integrations
    where provider = 'ksef'
      and status = 'connected'
      and (
        last_sync_at is null
        or last_sync_at < now() - (sync_interval_minutes || ' minutes')::interval
      )
  loop
    insert into public.ksef_sync_triggers(salon_id)
    values (v_integration.salon_id)
    returning token into v_token;

    perform net.http_post(
      url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/ksef-proxy',
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

revoke all on function public.cron_run_ksef_syncs() from public;
grant execute on function public.cron_run_ksef_syncs() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ksef-auto-sync') then
    perform cron.unschedule('ksef-auto-sync');
  end if;
end$$;

select cron.schedule(
  'ksef-auto-sync',
  '*/15 * * * *',
  $$ select public.cron_run_ksef_syncs(); $$
);
