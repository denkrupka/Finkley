-- =============================================================================
-- 20260510000011_infakt_integration.sql
-- =============================================================================
-- TASK-50: интеграция с inFakt (PL bookkeeping). Cron + triggers.
-- Сама интеграция заблокирована партнёрским доступом — код едет в проде, но
-- юзеры подключают только когда получим API-ключи.
-- =============================================================================

create table if not exists public.infakt_sync_triggers (
  token       uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.infakt_sync_triggers enable row level security;
create policy "no public access to infakt_sync_triggers"
  on public.infakt_sync_triggers for all using (false) with check (false);
grant select, insert, update on public.infakt_sync_triggers to service_role;

create index if not exists idx_infakt_sync_triggers_expires
  on public.infakt_sync_triggers(expires_at)
  where used_at is null;

create extension if not exists pg_net with schema extensions;

create or replace function public.cron_run_infakt_syncs()
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
  delete from public.infakt_sync_triggers
  where expires_at < now() - interval '1 hour';

  for v_integration in
    select id, salon_id, sync_interval_minutes
    from public.salon_integrations
    where provider = 'infakt'
      and status = 'connected'
      and (
        last_sync_at is null
        or last_sync_at < now() - (sync_interval_minutes || ' minutes')::interval
      )
  loop
    insert into public.infakt_sync_triggers(salon_id)
    values (v_integration.salon_id)
    returning token into v_token;

    perform net.http_post(
      url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/infakt-proxy',
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

revoke all on function public.cron_run_infakt_syncs() from public;
grant execute on function public.cron_run_infakt_syncs() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'infakt-auto-sync') then
    perform cron.unschedule('infakt-auto-sync');
  end if;
end$$;

select cron.schedule(
  'infakt-auto-sync',
  '*/15 * * * *',
  $$ select public.cron_run_infakt_syncs(); $$
);
