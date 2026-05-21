-- =============================================================================
-- 20260521000004_daily_notifications_cron.sql
-- =============================================================================
-- Ежедневный пробег для не-платежных типов уведомлений:
--   - low_inventory: позиции склада с current_stock <= min_stock
--   - calendar_conflicts: TODO в edge function — двойные брони
--   - booksy_new_visits: TODO — лучше real-time из booksy-proxy
--
-- Cron 08:30 UTC (после payment-reminders в 08:00, чтобы юзер получил
-- финансовые сначала, потом операционные). Rendezvous token pattern.
-- =============================================================================

create table if not exists public.daily_notifications_triggers (
  token       uuid primary key default gen_random_uuid(),
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.daily_notifications_triggers enable row level security;
create policy "no public access to daily_notifications_triggers"
  on public.daily_notifications_triggers
  for all using (false) with check (false);
grant select, insert, update on public.daily_notifications_triggers to service_role;

create index if not exists idx_daily_notif_triggers_expires
  on public.daily_notifications_triggers(expires_at)
  where used_at is null;

create extension if not exists pg_net with schema extensions;

create or replace function public.process_daily_notifications()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  delete from public.daily_notifications_triggers where expires_at < now() - interval '1 hour';
  insert into public.daily_notifications_triggers default values returning token into v_token;
  perform net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/daily-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('token', v_token::text, 'cron', true)
  );
  return 1;
end;
$$;

revoke all on function public.process_daily_notifications() from public;
grant execute on function public.process_daily_notifications() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-daily-notifications') then
    perform cron.unschedule('send-daily-notifications');
  end if;
end$$;

select cron.schedule(
  'send-daily-notifications',
  '30 8 * * *',
  $$ select public.process_daily_notifications(); $$
);
