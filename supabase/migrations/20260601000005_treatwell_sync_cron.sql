-- Auto-sync для Treatwell интеграций (аналог booksy_sync_cron).
--
-- Архитектура (rendezvous-token, как у Booksy/weekly-digest):
--   1) pg_cron каждые 5 минут вызывает cron_run_treatwell_syncs()
--   2) Функция выбирает все salon_integrations с provider='treatwell',
--      status='connected', last_sync_at < now() - sync_interval
--   3) Async POST на treatwell-proxy с {action:'sync', salon_id, token}
--   4) Edge function валидирует токен → запускает sync для этого салона.
--
-- Token проверяется в treatwell-proxy (см. изменение в functions/treatwell-proxy).

create table if not exists public.treatwell_sync_triggers (
  token       uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.treatwell_sync_triggers enable row level security;
create policy "no public access to treatwell_sync_triggers"
  on public.treatwell_sync_triggers
  for all using (false) with check (false);
grant select, insert, update on public.treatwell_sync_triggers to service_role;

create index if not exists idx_treatwell_sync_triggers_expires
  on public.treatwell_sync_triggers(expires_at)
  where used_at is null;

create or replace function public.cron_run_treatwell_syncs()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration record;
  v_token uuid;
  v_count int := 0;
  v_url text;
begin
  delete from public.treatwell_sync_triggers
  where expires_at < now() - interval '1 hour';

  -- URL берём из vault или env. Тот же project, что и booksy.
  v_url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/treatwell-proxy';

  for v_integration in
    select id, salon_id, sync_interval_minutes
    from public.salon_integrations
    where provider = 'treatwell'
      and status = 'connected'
      and (
        last_sync_at is null
        or last_sync_at < now() - (sync_interval_minutes || ' minutes')::interval
      )
  loop
    insert into public.treatwell_sync_triggers(salon_id)
    values (v_integration.salon_id)
    returning token into v_token;

    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'action', 'sync',
        'salon_id', v_integration.salon_id::text,
        'token', v_token::text,
        'days', 7
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.cron_run_treatwell_syncs() from public;
grant execute on function public.cron_run_treatwell_syncs() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'treatwell-auto-sync') then
    perform cron.unschedule('treatwell-auto-sync');
  end if;
end$$;

select cron.schedule(
  'treatwell-auto-sync',
  '*/5 * * * *',
  $$ select public.cron_run_treatwell_syncs(); $$
);
