-- =============================================================================
-- 20260509000004_banking_expiry_notify.sql
-- =============================================================================
-- Email-нотификация владельцу салона за 14 дней до истечения PSD2-consent.
-- Без re-auth bank-import замолкнет — даём заранее предупредить.
--
-- Архитектура (rendezvous-token, копия weekly-digest cron):
--   * banking_expiry_triggers — одноразовые токены (5-мин TTL)
--   * cron_run_banking_expiry_notify() — генерит токен, POST'ит на
--     banking-expiry-notify edge function
--   * Edge function валидирует токен, выбирает connection'ы у которых
--     valid_until ≤ +14 дней и expiry_email_sent_at IS NULL, шлёт email
--     через send-email, проставляет expiry_email_sent_at
--
-- Schema:
--   * bank_connections.expiry_email_sent_at — timestamp последней нотификации.
--     При re-connect (valid_until отодвигается > 30 дней вперёд) триггер
--     сбрасывает обратно в NULL — следующее истечение опять триггернёт.
-- =============================================================================

alter table public.bank_connections
  add column if not exists expiry_email_sent_at timestamptz;

create index if not exists idx_bank_connections_expiry_notify
  on public.bank_connections(valid_until)
  where status = 'connected'
    and valid_until is not null
    and expiry_email_sent_at is null;

-- ─── Триггер: сброс флажка при re-connect ─────────────────────────────────
create or replace function public.bank_connections_reset_expiry_notify()
returns trigger
language plpgsql
as $$
begin
  if new.valid_until is distinct from old.valid_until
     and (old.valid_until is null or new.valid_until > old.valid_until + interval '30 days')
  then
    new.expiry_email_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bank_connections_reset_expiry_notify on public.bank_connections;
create trigger trg_bank_connections_reset_expiry_notify
  before update on public.bank_connections
  for each row execute procedure public.bank_connections_reset_expiry_notify();

-- ─── banking_expiry_triggers: одноразовый токен для cron ─────────────────
create table if not exists public.banking_expiry_triggers (
  token uuid primary key default gen_random_uuid(),
  used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now()
);

alter table public.banking_expiry_triggers enable row level security;
create policy "no public access to banking_expiry_triggers"
  on public.banking_expiry_triggers
  for all using (false) with check (false);
grant select, insert, update on public.banking_expiry_triggers to service_role;

create index if not exists idx_banking_expiry_triggers_expires
  on public.banking_expiry_triggers(expires_at)
  where used_at is null;

-- ─── cron_run_banking_expiry_notify ───────────────────────────────────────
create or replace function public.cron_run_banking_expiry_notify()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  -- Чистим устаревшие токены
  delete from public.banking_expiry_triggers
   where expires_at < now() - interval '1 hour';

  insert into public.banking_expiry_triggers default values returning token into v_token;

  perform net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/banking-expiry-notify',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('token', v_token::text)
  );
  return 1;
end;
$$;

revoke all on function public.cron_run_banking_expiry_notify() from public;
grant execute on function public.cron_run_banking_expiry_notify() to service_role;

-- ─── Schedule: раз в день в 09:00 UTC ─────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'banking-expiry-notify') then
    perform cron.unschedule('banking-expiry-notify');
  end if;
end$$;

select cron.schedule(
  'banking-expiry-notify',
  '0 9 * * *',
  $$ select public.cron_run_banking_expiry_notify(); $$
);

comment on column public.bank_connections.expiry_email_sent_at is
  'Когда отправили email-нотификацию о приближении истечения consent. NULL → ещё не слали (или сбросилось при re-connect).';
