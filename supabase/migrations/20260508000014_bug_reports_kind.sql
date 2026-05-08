-- =============================================================================
-- 20260508000014_bug_reports_kind.sql
-- =============================================================================
-- Telegram bug-collector принимает сообщения из 2 тем форум-чата:
--   - "Баги"     → kind='bug'      (поведение по умолчанию, как и раньше)
--   - "Функции"  → kind='feature'  (запросы новых фичей; не баги для починки)
-- Сообщения из других тем (General, Вопросы, ...) бот игнорирует
-- silently — там идёт обсуждение, а не репорты.
--
-- Маппинг thread_id → kind делает edge function через env-vars
-- TELEGRAM_THREAD_BUGS / TELEGRAM_THREAD_FEATURES.
-- =============================================================================

alter table public.bug_reports
  add column if not exists kind text not null default 'bug';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_bug_reports_kind'
  ) then
    alter table public.bug_reports
      add constraint chk_bug_reports_kind check (kind in ('bug', 'feature'));
  end if;
end$$;

create index if not exists idx_bug_reports_kind_status
  on public.bug_reports(kind, status, reported_at desc)
  where status = 'open';
