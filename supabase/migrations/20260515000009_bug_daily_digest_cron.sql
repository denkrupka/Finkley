-- =============================================================================
-- Cron-job: ежедневная сводка по багам владельцу (super_admin) в Telegram.
-- Тот же rendezvous-token pattern что в weekly_digest_cron.
-- =============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.bug_digest_triggers (
  token       uuid primary key default gen_random_uuid(),
  used_at     timestamptz,
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

alter table public.bug_digest_triggers enable row level security;
create policy "no public access to bug_digest_triggers"
  on public.bug_digest_triggers for all using (false) with check (false);
grant select, insert, update on public.bug_digest_triggers to service_role;

create index if not exists idx_bug_digest_triggers_expires
  on public.bug_digest_triggers(expires_at)
  where used_at is null;

-- Cron шлёт POST в /daily-digest. Внутренний secret валидируется edge function'ом
-- через function_internal_secret из её ENV — мы передаём его в body. Но из cron
-- мы не можем читать env edge function'а; используем тот же подход что выше —
-- одноразовый токен. Удобнее всего: edge function на /daily-digest проверяет
-- secret из body; для cron шлём «cron-marker» который функция распознаёт через
-- запрос к bug_digest_triggers (как в weekly_digest).
--
-- Упрощение: сейчас функция /daily-digest требует FUNCTION_INTERNAL_SECRET в body.
-- Мы знаем этот secret на уровне SQL только если положим его в БД (опасно).
-- Поэтому добавляем альтернативную auth — токен-кикалка.
--
-- Edge function уже валидирует FUNCTION_INTERNAL_SECRET. Дополним её: если
-- в body есть token и он валиден в bug_digest_triggers — тоже пускаем.
-- Это сделано в коде telegram-bug-collector в handleDailyDigest.

create or replace function public.process_bug_daily_digest()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  delete from public.bug_digest_triggers where expires_at < now() - interval '1 hour';
  insert into public.bug_digest_triggers default values returning token into v_token;

  perform net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/telegram-bug-collector/daily-digest',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'token', v_token::text,
      'cron', true
    )
  );

  return 1;
end;
$$;

revoke all on function public.process_bug_daily_digest() from public;
grant execute on function public.process_bug_daily_digest() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'bug-daily-digest') then
    perform cron.unschedule('bug-daily-digest');
  end if;
end$$;

-- 08:00 UTC каждый день = 09:00 Warsaw зимой / 10:00 летом
select cron.schedule(
  'bug-daily-digest',
  '0 8 * * *',
  $$ select public.process_bug_daily_digest(); $$
);
