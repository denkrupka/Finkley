-- =============================================================================
-- 20260507000011_weekly_digest_cron.sql
-- =============================================================================
-- TASK-34b: автоматическая рассылка еженедельного дайджеста по понедельникам.
--
-- Архитектура: rendezvous-token. Cron в SQL создаёт одноразовый uuid-токен в
-- digest_triggers, шлёт его через pg_net.http_post в edge function. Функция
-- читает токен из БД, валидирует (не expired, не used), помечает used и
-- рассылает дайджест всем салонам с weekly_digest_enabled=true.
--
-- Зачем токен: edge function deployed --no-verify-jwt (cron не может слать
-- user JWT). Токен — наша внутренняя auth, без секретов в git/Vault.
-- =============================================================================

-- Таблица одноразовых токенов для cron-вызовов
create table if not exists public.digest_triggers (
  token       uuid primary key default gen_random_uuid(),
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

-- RLS: никаких пользовательских доступов, только service_role читает/пишет
alter table public.digest_triggers enable row level security;
create policy "no public access to digest_triggers" on public.digest_triggers
  for all using (false) with check (false);
grant select, insert, update on public.digest_triggers to service_role;

create index if not exists idx_digest_triggers_expires
  on public.digest_triggers(expires_at)
  where used_at is null;

-- pg_net уже включён предыдущей миграцией (см. 20260507000007), но создаём
-- идемпотентно на случай чистого staging
create extension if not exists pg_net with schema extensions;

-- =============================================================================
-- process_weekly_digests — генерит token и кикает edge function
-- =============================================================================
create or replace function public.process_weekly_digests()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  -- Чистим устаревшие токены чтобы таблица не росла
  delete from public.digest_triggers where expires_at < now() - interval '1 hour';

  -- Создаём свежий одноразовый токен
  insert into public.digest_triggers default values returning token into v_token;

  -- Async POST в send-weekly-digest. pg_net помещает запрос в очередь и
  -- возвращает request_id, реальная обработка в воркере. Не ждём ответа.
  perform net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/send-weekly-digest',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'token', v_token::text,
      'cron', true
    )
  );

  return 1;
end;
$$;

revoke all on function public.process_weekly_digests() from public;
grant execute on function public.process_weekly_digests() to service_role;

-- =============================================================================
-- Cron: понедельник 09:00 UTC (= 10:00 Warsaw зимой / 11:00 летом)
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-weekly-digests') then
    perform cron.unschedule('send-weekly-digests');
  end if;
end$$;

select cron.schedule(
  'send-weekly-digests',
  '0 9 * * 1',
  $$ select public.process_weekly_digests(); $$
);
