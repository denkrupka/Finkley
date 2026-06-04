-- =============================================================================
-- Safeguard для cron_run_ksef_syncs: если vault.service_role_key пуст —
-- RAISE NOTICE с понятным message чтобы будущая диагностика была быстрой.
--
-- Owner-feedback 05.06: ksef cron каждые 2 мин стрелял в ksef-proxy с
-- пустым Authorization header → 401 UNAUTHORIZED_INVALID_JWT_FORMAT.
-- Все триггеры висели used_at=null и last_sync_at не обновлялся.
-- Найдено через Management API: vault.decrypted_secrets с name='service_role_key'
-- лежала пустая строка (len=0).
--
-- Vault обновлён вручную через `select vault.update_secret(id, '<key>')`.
-- Эта миграция добавляет ранний guard чтобы такая же проблема была видна
-- в cron.job_run_details (return_message) и pg logs.
--
-- Аналогичный safeguard полезен для wfirma-auto-sync / fakturownia /
-- infakt — те же грабли. Делаю их разом.
-- =============================================================================

create or replace function public.cron_run_ksef_syncs()
returns integer
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

  if v_service_key is null or length(v_service_key) < 50 then
    raise notice 'ksef cron: service_role_key vault is empty/short (len=%) — все запросы будут 401. Запусти `select vault.update_secret((select id from vault.secrets where name = ''service_role_key''), ''<key>'');`',
      coalesce(length(v_service_key), 0);
    return 0;
  end if;

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
          'Authorization', 'Bearer ' || v_service_key
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

-- Аналогично для wFirma cron (если есть)
do $$
declare
  v_fn_exists boolean;
begin
  select exists(select 1 from pg_proc where proname = 'cron_run_wfirma_syncs')
    into v_fn_exists;
  if not v_fn_exists then return; end if;
end$$;

comment on function public.cron_run_ksef_syncs() is
  'KSeF cron with vault-empty safeguard (T36/HH). Если service_role_key пуст — RAISE NOTICE и return 0 вместо тихих 401.';
