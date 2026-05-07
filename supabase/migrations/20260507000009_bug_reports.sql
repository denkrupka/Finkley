-- =============================================================================
-- 20260507000009_bug_reports.sql
-- =============================================================================
-- Telegram-бот @finklay_dev_bot собирает баг-репорты владельца + партнёра в
-- общем чате и складывает их сюда. Когда Claude приходит работать — читает
-- эту таблицу через service-role и приоритизирует.
--
-- RLS: данные admin-only (это внутренний tooling, не пользовательские данные).
-- Через anon-key читать нельзя; service-role и authenticated с флагом is_admin
-- через profiles — да.
-- =============================================================================

-- Storage bucket для скриншотов из Telegram. Приватный, до 20 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bug-attachments', 'bug-attachments', false, 20971520,
        array['image/jpeg','image/png','image/webp','image/heic','image/gif','application/pdf','video/mp4'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Bucket-RLS: только service-role читает/пишет. Юзеры — никак.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'bug-attachments service_role only'
  ) then
    create policy "bug-attachments service_role only" on storage.objects
      for all
      using (bucket_id = 'bug-attachments' and auth.role() = 'service_role')
      with check (bucket_id = 'bug-attachments' and auth.role() = 'service_role');
  end if;
end$$;

-- =============================================================================
-- bug_reports
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'bug_status') then
    create type bug_status as enum ('open', 'in_progress', 'fixed', 'wontfix', 'duplicate');
  end if;
  if not exists (select 1 from pg_type where typname = 'bug_severity') then
    create type bug_severity as enum ('low', 'medium', 'high', 'critical');
  end if;
end$$;

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  -- Telegram metadata
  telegram_chat_id   bigint not null,
  telegram_message_id bigint not null,
  sender_id          bigint not null,
  sender_username    text,
  sender_first_name  text,
  -- Контент
  message_text       text,
  attachments        jsonb not null default '[]'::jsonb,
  -- attachments item: { type:'photo'|'document'|'video', file_id, storage_path,
  --                     mime, size, vision_summary? }
  reported_at        timestamptz not null default now(),
  -- Workflow
  status             bug_status not null default 'open',
  severity           bug_severity,
  area               text, -- visits|expenses|payouts|reports|auth|onboarding|...
  -- AI-разметка
  ai_summary         text,        -- краткая суть (1-2 предложения)
  ai_steps_to_repro  text,
  ai_categorized_at  timestamptz,
  -- Resolution
  fixed_at           timestamptz,
  fixed_in_commit    text,
  notes              text,        -- добавляется через /note <id> <text>
  duplicate_of       uuid references public.bug_reports(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Идемпотентность: один и тот же telegram message не дублируется
  unique (telegram_chat_id, telegram_message_id)
);

create index if not exists idx_bug_reports_status_reported
  on public.bug_reports(status, reported_at desc);

create trigger trg_bug_reports_updated_at
  before update on public.bug_reports
  for each row execute procedure public.set_updated_at();

alter table public.bug_reports enable row level security;

-- RLS: данные admin-only. Service-role обходит RLS автоматически. Юзеры
-- из public-app сюда не лезут — даже если попытаются, политики ниже их режут.
create policy "no public access to bug_reports" on public.bug_reports
  for all
  using (false)
  with check (false);

grant select, insert, update on public.bug_reports to service_role;
