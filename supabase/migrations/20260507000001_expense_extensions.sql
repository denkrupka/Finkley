-- =============================================================================
-- 20260507000001_expense_extensions.sql
-- =============================================================================
-- TASK-25: фото чеков (Storage bucket + receipt_url) + повторяющиеся расходы
-- (recurrence enum + next_occurrence_at).
-- =============================================================================

-- 1) Колонка receipt_url для ссылки на загруженный файл в Storage.
--    Полное path внутри bucket'а receipts (e.g. <salon_id>/<uuid>.jpg).
alter table public.expenses
  add column if not exists receipt_url text;

-- 2) Повторяющиеся расходы.
--    recurrence:
--      none      — обычный одноразовый расход (default)
--      weekly    — повторяется каждую неделю в той же дате-of-week
--      monthly   — повторяется каждый месяц в той же day-of-month
--    next_occurrence_at — день, когда CRON должен создать следующий
--      инстанс этого расхода (NULL для recurrence='none').
do $$
begin
  if not exists (select 1 from pg_type where typname = 'expense_recurrence') then
    create type expense_recurrence as enum ('none', 'weekly', 'monthly');
  end if;
end$$;

alter table public.expenses
  add column if not exists recurrence expense_recurrence not null default 'none',
  add column if not exists next_occurrence_at date,
  add column if not exists recurrence_parent_id uuid references public.expenses(id) on delete set null;

create index if not exists idx_expenses_recurrence_due
  on public.expenses(salon_id, next_occurrence_at)
  where recurrence <> 'none' and deleted_at is null;

-- 3) Storage bucket для чеков. Приватный.
--    Path внутри: <salon_id>/<expense_id>.<ext>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS: только участники салона могут читать/писать в их подпапку.
-- Path начинается с salon_id, который должен быть в salon_members.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts: members read'
  ) then
    create policy "receipts: members read" on storage.objects for select
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1]::uuid in (
          select salon_id from public.salon_members where user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts: members insert'
  ) then
    create policy "receipts: members insert" on storage.objects for insert
      with check (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1]::uuid in (
          select salon_id from public.salon_members where user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'receipts: members delete'
  ) then
    create policy "receipts: members delete" on storage.objects for delete
      using (
        bucket_id = 'receipts'
        and (storage.foldername(name))[1]::uuid in (
          select salon_id from public.salon_members where user_id = auth.uid()
        )
      );
  end if;
end$$;
