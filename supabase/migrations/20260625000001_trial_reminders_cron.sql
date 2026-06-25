-- =============================================================================
-- 20260625000001_trial_reminders_cron.sql
-- =============================================================================
-- Напоминания об окончании пробного периода. Закрывает дыру: шаблон
-- trial_ending раньше слался только по Stripe-событию trial_will_end, которого
-- у implicit-trial (демо 14 дней без карты, без строки в salon_subscriptions)
-- не бывает. Этот cron сканирует дедлайны и шлёт за 3/1 день + в день истечения.
--
-- Архитектура rendezvous-token — та же, что у payment-reminders/digest.
-- Cron-job 08:00 UTC генерит одноразовый token и дёргает edge function
-- trial-reminders через pg_net.http_post.
-- =============================================================================

-- Rendezvous-token для аутентификации вызова edge function ------------------
create table if not exists public.trial_reminder_triggers (
  token       uuid primary key default gen_random_uuid(),
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.trial_reminder_triggers enable row level security;
create policy "no public access to trial_reminder_triggers" on public.trial_reminder_triggers
  for all using (false) with check (false);
grant select, insert, update on public.trial_reminder_triggers to service_role;

create index if not exists idx_trial_reminder_triggers_expires
  on public.trial_reminder_triggers(expires_at)
  where used_at is null;

-- Леджер дедупликации: каждый bucket уходит максимум один раз на конкретный
-- дедлайн. deadline_date в ключе → при продлении триала (bonus/награда) новый
-- дедлайн открывает новую серию напоминаний, а не «съедает» bucket навсегда.
create table if not exists public.trial_reminder_log (
  id            uuid primary key default gen_random_uuid(),
  salon_id      uuid not null references public.salons(id) on delete cascade,
  user_id       uuid,
  kind          text not null check (kind in ('trial_3d', 'trial_1d', 'trial_expired')),
  deadline_date date not null,
  sent_at       timestamptz not null default now(),
  unique (salon_id, kind, deadline_date)
);

alter table public.trial_reminder_log enable row level security;
create policy "no public access to trial_reminder_log" on public.trial_reminder_log
  for all using (false) with check (false);
grant select, insert on public.trial_reminder_log to service_role;

create index if not exists idx_trial_reminder_log_salon on public.trial_reminder_log(salon_id);

create extension if not exists pg_net with schema extensions;

create or replace function public.process_trial_reminders()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  delete from public.trial_reminder_triggers where expires_at < now() - interval '1 hour';
  insert into public.trial_reminder_triggers default values returning token into v_token;
  perform net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/trial-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('token', v_token::text, 'cron', true)
  );
  return 1;
end;
$$;

revoke all on function public.process_trial_reminders() from public;
grant execute on function public.process_trial_reminders() to service_role;

-- =============================================================================
-- Cron: ежедневно в 08:00 UTC (10:00 Warsaw летом / 09:00 зимой)
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-trial-reminders') then
    perform cron.unschedule('send-trial-reminders');
  end if;
end$$;

select cron.schedule(
  'send-trial-reminders',
  '0 8 * * *',
  $$ select public.process_trial_reminders(); $$
);
