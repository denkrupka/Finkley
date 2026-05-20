-- =============================================================================
-- 20260520000005_booksy_cron_auth_header.sql
-- =============================================================================
-- Фикс: даже с verify_jwt=false платформа Supabase требует Authorization
-- header (или apikey). Cron вызывал booksy-proxy без auth → 401 от Cloudflare
-- gateway, до нашего кода не доходило. Добавляем Authorization Bearer с
-- anon-key — это публичный токен, безопасно хранить в SQL.
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
  v_tiers text[];
  v_now timestamptz := now();
  v_clients_interval interval := interval '20 minutes';
  v_catalog_interval interval := interval '60 minutes';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqaWhneWF1a3B4dHBsemV1Ym9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjc0NzYsImV4cCI6MjA5MzY0MzQ3Nn0.GhSQcG6XQhlU_by1YznBPzUcyp3i8Iu02t3u2TQQZjw';
begin
  delete from public.booksy_sync_triggers
  where expires_at < now() - interval '1 hour';

  for v_integration in
    select id, salon_id, sync_interval_minutes,
           last_sync_at, last_clients_sync_at, last_catalog_sync_at
    from public.salon_integrations
    where provider = 'booksy'
      and status = 'connected'
  loop
    v_tiers := array[]::text[];

    if v_integration.last_sync_at is null
       or v_integration.last_sync_at <
          v_now - (v_integration.sync_interval_minutes || ' minutes')::interval
    then
      v_tiers := array_append(v_tiers, 'visits');
    end if;

    if v_integration.last_clients_sync_at is null
       or v_integration.last_clients_sync_at < v_now - v_clients_interval
    then
      v_tiers := array_append(v_tiers, 'clients');
    end if;

    if v_integration.last_catalog_sync_at is null
       or v_integration.last_catalog_sync_at < v_now - v_catalog_interval
    then
      v_tiers := array_append(v_tiers, 'catalog');
    end if;

    if array_length(v_tiers, 1) is null then
      continue;
    end if;

    insert into public.booksy_sync_triggers(salon_id)
    values (v_integration.salon_id)
    returning token into v_token;

    -- Authorization: Bearer <anon-key> нужен Supabase gateway даже при
    -- verify_jwt=false. Anon-key публичен, безопасно в SQL.
    perform net.http_post(
      url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/booksy-proxy',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key
      ),
      body := jsonb_build_object(
        'action', 'cron_sync_one',
        'salon_id', v_integration.salon_id::text,
        'token', v_token::text,
        'tiers', to_jsonb(v_tiers)
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.cron_run_booksy_syncs() from public;
grant execute on function public.cron_run_booksy_syncs() to service_role;
