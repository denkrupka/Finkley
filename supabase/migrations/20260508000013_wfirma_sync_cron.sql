-- =============================================================================
-- 20260508000013_wfirma_sync_cron.sql
-- =============================================================================
-- TASK-31: pg_cron → wfirma-proxy для авто-синка расходов из wFirma.
--
-- Архитектура (rendezvous-token, копия Booksy auto-sync):
--   1) pg_cron каждые 10 минут вызывает cron_run_wfirma_syncs()
--      (10 минут — wFirma расходы не настолько горячие, как Booksy визиты;
--       минимальный per-salon интервал у нас всё равно 60 минут)
--   2) Функция выбирает все salon_integrations.provider='wfirma' с истёкшим
--      sync_interval_minutes
--   3) Для каждой due integration создаёт одноразовый токен в
--      wfirma_sync_triggers и шлёт async POST на wfirma-proxy
--      {action:'cron_sync_one', salon_id, token}
--   4) Edge function валидирует токен → запускает sync для этого салона
--
-- Дефолтный интервал для wFirma — 60 минут (`docs/09_INTEGRATIONS.md` называл
-- «cron раз в час»). sync_interval_minutes уже добавлен в schema через
-- 20260507000018_booksy_sync_cron.sql, переиспользуем.
-- =============================================================================

-- pg_net уже включён, но идемпотентно
create extension if not exists pg_net with schema extensions;

-- =============================================================================
-- cron_run_wfirma_syncs — для каждой due wFirma integration кикает edge func
-- =============================================================================
create or replace function public.cron_run_wfirma_syncs()
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
  delete from public.wfirma_sync_triggers
  where expires_at < now() - interval '1 hour';

  for v_integration in
    select id, salon_id, sync_interval_minutes
    from public.salon_integrations
    where provider = 'wfirma'
      and status = 'connected'
      and (
        last_sync_at is null
        or last_sync_at < now() - (sync_interval_minutes || ' minutes')::interval
      )
  loop
    insert into public.wfirma_sync_triggers(salon_id)
    values (v_integration.salon_id)
    returning token into v_token;

    perform net.http_post(
      url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/wfirma-proxy',
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

revoke all on function public.cron_run_wfirma_syncs() from public;
grant execute on function public.cron_run_wfirma_syncs() to service_role;

-- =============================================================================
-- Cron: каждые 10 минут
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'wfirma-auto-sync') then
    perform cron.unschedule('wfirma-auto-sync');
  end if;
end$$;

select cron.schedule(
  'wfirma-auto-sync',
  '*/10 * * * *',
  $$ select public.cron_run_wfirma_syncs(); $$
);
