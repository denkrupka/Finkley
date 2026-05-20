-- =============================================================================
-- 20260520000002_booksy_tier_cron.sql
-- =============================================================================
-- ADR-017 §2: tier-aware cron для Booksy.
--
-- Один pg_cron job (booksy-auto-sync, каждые 2 мин — уже создан в
-- 20260507000018) вызывает cron_run_booksy_syncs(). Раньше функция
-- запускала full sync на каждый due salon. Теперь — внутри решает что
-- именно sync'ать, передаёт tiers[] в edge function:
--
--   visits   due ⇔ last_sync_at         истёк sync_interval_minutes
--   clients  due ⇔ last_clients_sync_at истёк 20 минут
--   catalog  due ⇔ last_catalog_sync_at истёк 60 минут
--
-- Кикаем edge function только если хотя бы один tier due. tiers[] передаётся
-- массивом строк в body POST.
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
  -- Tier intervals (постоянные)
  v_clients_interval interval := interval '20 minutes';
  v_catalog_interval interval := interval '60 minutes';
begin
  -- Чистим старые токены чтобы таблица не росла
  delete from public.booksy_sync_triggers
  where expires_at < now() - interval '1 hour';

  -- Перебираем все connected Booksy integrations и для каждой
  -- считаем массив due tiers. Кикаем функцию только если есть due.
  for v_integration in
    select id, salon_id, sync_interval_minutes,
           last_sync_at, last_clients_sync_at, last_catalog_sync_at
    from public.salon_integrations
    where provider = 'booksy'
      and status = 'connected'
  loop
    v_tiers := array[]::text[];

    -- visits tier: user-выбранный интервал (2..1440 мин)
    if v_integration.last_sync_at is null
       or v_integration.last_sync_at <
          v_now - (v_integration.sync_interval_minutes || ' minutes')::interval
    then
      v_tiers := array_append(v_tiers, 'visits');
    end if;

    -- clients tier: фиксировано 20 минут
    if v_integration.last_clients_sync_at is null
       or v_integration.last_clients_sync_at < v_now - v_clients_interval
    then
      v_tiers := array_append(v_tiers, 'clients');
    end if;

    -- catalog tier: фиксировано 60 минут. Сюда входят services, staff,
    -- salon hours, commission.
    if v_integration.last_catalog_sync_at is null
       or v_integration.last_catalog_sync_at < v_now - v_catalog_interval
    then
      v_tiers := array_append(v_tiers, 'catalog');
    end if;

    -- Ни один tier не due — пропускаем.
    if array_length(v_tiers, 1) is null then
      continue;
    end if;

    insert into public.booksy_sync_triggers(salon_id)
    values (v_integration.salon_id)
    returning token into v_token;

    perform net.http_post(
      url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/booksy-proxy',
      headers := jsonb_build_object('Content-Type', 'application/json'),
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

-- Cron уже расписан в 20260507000018 (каждые 2 минуты) — не пере-создаём.
