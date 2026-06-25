-- =============================================================================
-- 20260625000002_lifecycle_emails.sql
-- =============================================================================
-- Stream 2 — lifecycle email automation: activation-drip + win-back.
--
-- Закрывает две дыры воронки:
--   1) Activation: салон завёл аккаунт, но не дошёл до «aha-момента» (первый
--      визит / расход). Шлём капельную серию на день 2 и день 3, плюс «забери
--      +14 дней» тем, кто уже добавил визит+расход и почти у цели (см.
--      setup_progress + ADR-034 REWARD_WINDOW_DAYS=7).
--   2) Win-back: implicit-trial (демо 14 дней без карты) закончился, юзер ушёл
--      на free и не вернулся. На ~день 14-21 после создания шлём «твои данные
--      на месте, вернись».
--
-- Архитектура rendezvous-token — та же, что у trial-reminders / digest. Два
-- cron-job (activation 08:30 UTC, winback 09:00 UTC) генерят одноразовый token
-- и дёргают edge function send-lifecycle-emails через pg_net.http_post.
-- Дедуп — lifecycle_email_log UNIQUE(salon_id, email_kind): каждый kind уходит
-- салону максимум один раз за всё время (insert-then-send, at-most-once).
-- =============================================================================

-- Леджер дедупликации: один email_kind на салон навсегда -----------------------
create table if not exists public.lifecycle_email_log (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  user_id     uuid,
  email_kind  text not null check (
    email_kind in (
      'activation_visit_d2',
      'activation_visit_d3',
      'activation_reward_d3',
      'winback_trial'
    )
  ),
  sent_at     timestamptz not null default now(),
  unique (salon_id, email_kind)
);

alter table public.lifecycle_email_log enable row level security;
create policy "no public access to lifecycle_email_log" on public.lifecycle_email_log
  for all using (false) with check (false);
grant select, insert on public.lifecycle_email_log to service_role;

create index if not exists idx_lifecycle_email_log_salon
  on public.lifecycle_email_log(salon_id);

-- Rendezvous-token для аутентификации вызова edge function ---------------------
create table if not exists public.lifecycle_email_triggers (
  token       uuid primary key default gen_random_uuid(),
  flow        text not null,
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.lifecycle_email_triggers enable row level security;
create policy "no public access to lifecycle_email_triggers" on public.lifecycle_email_triggers
  for all using (false) with check (false);
grant select, insert, update on public.lifecycle_email_triggers to service_role;

create index if not exists idx_lifecycle_email_triggers_expires
  on public.lifecycle_email_triggers(expires_at)
  where used_at is null;

create extension if not exists pg_net with schema extensions;

-- process_lifecycle_emails(flow) — генерит token и дёргает edge function --------
create or replace function public.process_lifecycle_emails(p_flow text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  delete from public.lifecycle_email_triggers where expires_at < now() - interval '1 hour';
  insert into public.lifecycle_email_triggers (flow) values (p_flow) returning token into v_token;
  perform net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/send-lifecycle-emails',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('token', v_token::text, 'flow', p_flow, 'cron', true)
  );
  return 1;
end;
$$;

revoke all on function public.process_lifecycle_emails(text) from public;
grant execute on function public.process_lifecycle_emails(text) to service_role;

-- =============================================================================
-- Cron jobs
--   activation — ежедневно 08:30 UTC (после trial-reminders в 08:00)
--   winback    — ежедневно 09:00 UTC
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'lifecycle-activation') then
    perform cron.unschedule('lifecycle-activation');
  end if;
end$$;

select cron.schedule(
  'lifecycle-activation',
  '30 8 * * *',
  $$ select public.process_lifecycle_emails('activation'); $$
);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lifecycle-winback') then
    perform cron.unschedule('lifecycle-winback');
  end if;
end$$;

select cron.schedule(
  'lifecycle-winback',
  '0 9 * * *',
  $$ select public.process_lifecycle_emails('winback'); $$
);
