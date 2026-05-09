-- =============================================================================
-- 20260509000003_banking_sync_cron.sql
-- =============================================================================
-- Daily cron для авто-синка всех bank_connections (Enable Banking).
-- Тащит свежие транзакции, debits авто-создают expenses (см. banking-sync).
--
-- Архитектура (rendezvous-token, копия Booksy/wFirma cron):
--   1) pg_cron каждые 6 часов вызывает cron_run_banking_syncs()
--   2) Функция выбирает все bank_connections со status='connected'
--   3) Для каждой — создаёт одноразовый токен в bank_sync_triggers,
--      шлёт async POST на banking-sync {connection_id, token}
--   4) banking-sync валидирует токен → запускает syncConnection()
--
-- 6 часов — компромисс: банковские транзакции обычно booking'аются с
-- задержкой 1-3 часа после операции, чаще обновлять смысла мало.
-- Cron выполняется в 00:00 / 06:00 / 12:00 / 18:00 UTC.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- ─── bank_sync_triggers: одноразовые токены ───────────────────────────────
create table if not exists public.bank_sync_triggers (
  token uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  consumed_at timestamptz
);

create index if not exists idx_bank_sync_triggers_expires
  on public.bank_sync_triggers(expires_at);

-- RLS: только service-role (юзеры с этой таблицей не работают)
alter table public.bank_sync_triggers enable row level security;
-- Никаких policies → юзеры не видят. Service role bypass'ит RLS.

-- ─── cron_run_banking_syncs: kicks банкинг-syncs для всех connected ───────
create or replace function public.cron_run_banking_syncs()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conn record;
  v_token uuid;
  v_count int := 0;
begin
  -- Чистим истёкшие токены
  delete from public.bank_sync_triggers
  where expires_at < now() - interval '1 hour';

  -- Также автоматически переводим в expired connection'ы у которых
  -- consent истёк. Юзер увидит баннер «переподключи банк» в UI и
  -- получит email-нотификацию (см. banking-expiry-notify cron).
  update public.bank_connections
     set status = 'expired',
         last_error = 'consent_expired'
   where status = 'connected'
     and valid_until is not null
     and valid_until < now();

  for v_conn in
    select id, salon_id
      from public.bank_connections
     where status = 'connected'
  loop
    insert into public.bank_sync_triggers(connection_id)
    values (v_conn.id)
    returning token into v_token;

    perform net.http_post(
      url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/banking-sync',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'connection_id', v_conn.id::text,
        'cron_token', v_token::text
      )
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.cron_run_banking_syncs() from public;
grant execute on function public.cron_run_banking_syncs() to service_role;

-- ─── Schedule: каждые 6 часов ─────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'banking-auto-sync') then
    perform cron.unschedule('banking-auto-sync');
  end if;
end$$;

select cron.schedule(
  'banking-auto-sync',
  '0 */6 * * *',
  $$ select public.cron_run_banking_syncs(); $$
);
