-- =============================================================================
-- 20260514200000_bug_reports_moderation.sql
-- =============================================================================
-- PR7: bug_reports теперь получают баги двумя путями:
--   (1) Telegram-команда (старый flow): source='team', автоматически approved
--   (2) Клиенты салонов через бота: source='client', requires_approval=true,
--       нужен явный апрув super-admin'а перед обработкой
--
-- Поля:
--   source           - 'team' | 'client' | 'admin_ui'
--   requires_approval- true для 'client', super-admin аппрувит вручную
--   approved_by      - кто аппрувнул
--   approved_at      - когда
--   reporter_user_id - если бот залогинен через TG, привязка к auth.users
--   salon_id         - если клиент пишет про конкретный салон
--
-- telegram_* колонки остаются NOT NULL для existing flow и client-bot (бот всё
-- так же из Telegram присылает). Для admin_ui требуется placeholder 0/0/0.
-- =============================================================================

alter table public.bug_reports
  add column if not exists source text not null default 'team',
  add column if not exists requires_approval boolean not null default false,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists reporter_user_id uuid references auth.users(id) on delete set null,
  add column if not exists salon_id uuid references public.salons(id) on delete set null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_bug_reports_source'
  ) then
    alter table public.bug_reports
      add constraint chk_bug_reports_source
      check (source in ('team', 'client', 'admin_ui'));
  end if;
end$$;

create index if not exists idx_bug_reports_source_approval
  on public.bug_reports(source, requires_approval, approved_at)
  where requires_approval = true and approved_at is null;
