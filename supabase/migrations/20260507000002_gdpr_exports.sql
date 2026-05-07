-- =============================================================================
-- 20260507000002_gdpr_exports.sql
-- =============================================================================
-- TASK-26: экспорт всех данных пользователя в ZIP с CSV-файлами
-- (GDPR Art. 20 «Право на портативность»).
-- =============================================================================

-- Реестр запросов на экспорт (для rate-limit'а и истории).
create table if not exists public.export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending', -- pending | processing | done | failed
  storage_path text, -- e.g. <user_id>/<request_id>.zip
  signed_url_expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);

alter table public.export_requests enable row level security;

create index if not exists idx_export_requests_user_created
  on export_requests(user_id, created_at desc);

create policy "users see own exports" on export_requests for select
  using (user_id = auth.uid());

create policy "users insert own exports" on export_requests for insert
  with check (user_id = auth.uid());

-- Service role обходит RLS, так что edge-function пишет напрямую без политики.

-- Storage bucket: приватные ZIP'ы экспорта. Один файл на request.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, 104857600, array['application/zip', 'application/octet-stream'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS на Storage: пользователь видит только файлы в своей папке.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'exports: own read'
  ) then
    create policy "exports: own read" on storage.objects for select
      using (
        bucket_id = 'exports'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end$$;
