-- =============================================================================
-- KSeF cron re-schedule + safer error handling. Owner-feedback 04.06 13:58:
-- через час после ручного sync cron не сработал, last_sync_at не обновился.
-- Миграция 20260604000002 переписала функцию, но pg_cron job мог застрять
-- на старом снапшоте SQL. Делаем явный unschedule + reschedule.
--
-- Дополнительно: оборачиваем всё тело cron в exception handler с
-- `raise notice` — без этого ошибка внутри loop тихо прерывает всю
-- функцию и cron вообще не двигает sync.
-- =============================================================================

-- 1. Жёсткий unschedule (на случай если pg_cron хранит ID job'а а не его текст).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ksef-auto-sync') then
    perform cron.unschedule('ksef-auto-sync');
  end if;
end$$;

-- 2. Версия функции с try/catch на каждом интеграционном цикле — если
--    одна интеграция упадёт (network / pg_net hiccup), остальные продолжат.
create or replace function public.cron_run_ksef_syncs()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration record;
  v_count int := 0;
  v_url text := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/ksef-proxy';
  v_token uuid;
  v_service_key text;
  v_loop_err text;
begin
  begin
    select decrypted_secret into v_service_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  exception when others then
    v_service_key := null;
  end;

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
    begin
      insert into public.ksef_sync_triggers (salon_id)
        values (v_integration.salon_id)
        returning token into v_token;

      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(v_service_key, '')
        ),
        body := jsonb_build_object(
          'action', 'cron_sync_one',
          'salon_id', v_integration.salon_id::text,
          'token', v_token::text
        )
      );
      v_count := v_count + 1;
    exception when others then
      get stacked diagnostics v_loop_err = message_text;
      raise notice 'ksef cron iter failed salon=% : %', v_integration.salon_id, v_loop_err;
    end;
  end loop;

  delete from public.ksef_sync_triggers
   where (used_at is not null and used_at < now() - interval '1 hour')
      or (expires_at < now() - interval '1 hour');

  return v_count;
end;
$$;

revoke all on function public.cron_run_ksef_syncs() from public;
grant execute on function public.cron_run_ksef_syncs() to service_role;

-- 3. Reschedule cron job. Pg_cron хранит вызов как text — после REPLACE
--    FUNCTION существующий job продолжит дёргать новую версию, но если
--    job завис на старом плане (например после unschedule в той же
--    миграции), переставляем явно.
select cron.schedule(
  'ksef-auto-sync',
  '*/2 * * * *',
  $$ select public.cron_run_ksef_syncs(); $$
);
