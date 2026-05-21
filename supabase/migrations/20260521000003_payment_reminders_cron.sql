-- =============================================================================
-- 20260521000003_payment_reminders_cron.sql
-- =============================================================================
-- Ежедневная рассылка напоминаний о приближающихся / просроченных платежах
-- (scheduled_payments). Архитектура rendezvous-token та же, что у дайджестов.
--
-- Cron-job запускается раз в день в 08:00 UTC (= 10:00 Warsaw летом),
-- генерирует одноразовый token, дёргает edge function payment-reminders
-- через pg_net.http_post.
--
-- Edge function:
--   - Валидирует токен (не expired/used).
--   - Для каждого scheduled_payment status='pending' считает days до due_date:
--     2, 1, 0 или <0 (просрочен).
--   - Для салона если notification_prefs.payment_due_{2d|1d|today|overdue}=true
--     (или ключ отсутствует) — шлёт уведомления: push (web-push), email,
--     Telegram (если каналы настроены).
--   - Просроченные шлются каждый день пока не оплачено.
-- =============================================================================

create table if not exists public.payment_reminder_triggers (
  token       uuid primary key default gen_random_uuid(),
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.payment_reminder_triggers enable row level security;
create policy "no public access to payment_reminder_triggers" on public.payment_reminder_triggers
  for all using (false) with check (false);
grant select, insert, update on public.payment_reminder_triggers to service_role;

create index if not exists idx_payment_reminder_triggers_expires
  on public.payment_reminder_triggers(expires_at)
  where used_at is null;

create extension if not exists pg_net with schema extensions;

create or replace function public.process_payment_reminders()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  delete from public.payment_reminder_triggers where expires_at < now() - interval '1 hour';
  insert into public.payment_reminder_triggers default values returning token into v_token;
  perform net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/payment-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('token', v_token::text, 'cron', true)
  );
  return 1;
end;
$$;

revoke all on function public.process_payment_reminders() from public;
grant execute on function public.process_payment_reminders() to service_role;

-- =============================================================================
-- Cron: ежедневно в 08:00 UTC (10:00 Warsaw летом / 09:00 зимой)
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-payment-reminders') then
    perform cron.unschedule('send-payment-reminders');
  end if;
end$$;

select cron.schedule(
  'send-payment-reminders',
  '0 8 * * *',
  $$ select public.process_payment_reminders(); $$
);
