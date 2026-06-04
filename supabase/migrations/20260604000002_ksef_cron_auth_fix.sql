-- =============================================================================
-- Фикс KSeF cron auth. Owner-feedback 04.06 12:49: 13 часов без sync.
--
-- Root cause: cron_run_ksef_syncs() из 20260603000010 вызывал edge function
-- с action='sync' + service-role-key в Bearer. handleSync в ksef-proxy
-- требует USER JWT (через userClient.auth.getUser()) — service-role key
-- даёт 401 invalid_token. Cron silently fail на каждом тике.
--
-- Правильный route — action='cron_sync_one' с rendezvous-token из
-- ksef_sync_triggers (та же схема что у Booksy/wFirma cron'ов). Cron
-- функция INSERT'ит token и шлёт его в body.
-- =============================================================================

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
begin
  -- Service role key из vault — для Authorization header (edge function
  -- его decode'ит только для лёгкой проверки origin; основная auth для
  -- cron_sync_one идёт через body.token).
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
    -- One-shot rendezvous token (expires_at = now() + 5min по default).
    -- Edge function потребит его в handleCronSyncOne.
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
  end loop;

  -- Cleanup expired/used токены — лишний housekeeping, чтобы таблица не
  -- разрасталась. Раз в каждый тик удаляем все used+истёкшие старше часа.
  delete from public.ksef_sync_triggers
   where (used_at is not null and used_at < now() - interval '1 hour')
      or (expires_at < now() - interval '1 hour');

  return v_count;
end;
$$;

revoke all on function public.cron_run_ksef_syncs() from public;
grant execute on function public.cron_run_ksef_syncs() to service_role;
