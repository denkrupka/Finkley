-- Auto-sync для KSeF интеграций.
--
-- Юзер 02.06: 'в ksef как настроен импорт? делай крон, период сделай на
-- выбор клиента — на плитке КСеФ как в букси'. UI dropdown интервала уже
-- использует sync_interval_minutes — этот cron каждые 2 минуты выбирает
-- интеграции которые пора синкать (last_sync_at < now() - interval).

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
  v_service_key text;
begin
  -- Cleanup expired триггеров (если когда-нибудь добавим)
  perform 1;

  -- Service role key из vault. Если недоступен — fallback на anon (KSeF-proxy
  -- сам проверит auth).
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
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(v_service_key, '')
      ),
      body := jsonb_build_object(
        'action', 'sync',
        'salon_id', v_integration.salon_id::text
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.cron_run_ksef_syncs() from public;
grant execute on function public.cron_run_ksef_syncs() to service_role;

-- Каждые 2 минуты — KSeF возвращает быстро (только список фактур), cost OK.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ksef-auto-sync') then
    perform cron.unschedule('ksef-auto-sync');
  end if;
end$$;

select cron.schedule(
  'ksef-auto-sync',
  '*/2 * * * *',
  $$ select public.cron_run_ksef_syncs(); $$
);
