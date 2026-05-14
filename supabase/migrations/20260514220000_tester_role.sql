-- =============================================================================
-- 20260514220000_tester_role.sql
-- =============================================================================
-- «Тестировщик» — флаг доверенного пользователя, который может слать баги
-- прямо из UI приложения (желтая фиксированная панель + кнопка «Сообщить о
-- баге» + модалка с описанием/файлом/скриншотом).
--
-- Изменения:
--   profiles.is_tester boolean default false  — флаг ставится из /admin/users
--   bug_reports.source enum дополняется значением 'tester'
--   bug_reports.telegram_* становятся nullable — тестерские баги летят из UI,
--     telegram-полей у них нет. Старые telegram-records остаются как были,
--     idempotency-unique на (telegram_chat_id, telegram_message_id) теперь
--     partial — только когда оба значения NOT NULL.
-- =============================================================================

-- profiles.is_tester
alter table public.profiles
  add column if not exists is_tester boolean not null default false;

create index if not exists idx_profiles_is_tester on public.profiles(id)
  where is_tester = true;

-- bug_reports.source: добавляем 'tester' в check constraint
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'chk_bug_reports_source') then
    alter table public.bug_reports drop constraint chk_bug_reports_source;
  end if;
  alter table public.bug_reports
    add constraint chk_bug_reports_source
    check (source in ('team', 'client', 'admin_ui', 'tester'));
end$$;

-- bug_reports.telegram_* → nullable
alter table public.bug_reports
  alter column telegram_chat_id drop not null,
  alter column telegram_message_id drop not null,
  alter column sender_id drop not null;

-- Старый UNIQUE(telegram_chat_id, telegram_message_id) — заменяем на partial
-- unique index чтобы NULL-NULL пары (тестерские/UI-баги) не конфликтовали.
do $$
declare
  cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.bug_reports'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) like '%(telegram_chat_id, telegram_message_id)%';
  if cname is not null then
    execute format('alter table public.bug_reports drop constraint %I', cname);
  end if;
end$$;

create unique index if not exists bug_reports_tg_msg_uk
  on public.bug_reports(telegram_chat_id, telegram_message_id)
  where telegram_chat_id is not null and telegram_message_id is not null;
