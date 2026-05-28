-- =============================================================================
-- 20260528000001_avatars_bucket.sql
-- =============================================================================
-- Storage bucket для аватаров пользователей. Используется:
--   - UserProfileCard в /settings → Профиль (загрузка собственного аватара)
--   - InviteSignupForm после accept-invite
--
-- Bucket публичный (аватары видны в шапке/тимбилдинге без signed URL).
-- Путь: <auth.user.id>/avatar-<ts>.<ext>
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS:
--   read   — anyone (public bucket)
--   write  — только сам пользователь в свою папку (first-folder = auth.uid())
--   update — то же
--   delete — то же
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars: anyone read'
  ) then
    create policy "avatars: anyone read" on storage.objects for select
      using (bucket_id = 'avatars');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars: owner write'
  ) then
    create policy "avatars: owner write" on storage.objects for insert
      with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars: owner update'
  ) then
    create policy "avatars: owner update" on storage.objects for update
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars: owner delete'
  ) then
    create policy "avatars: owner delete" on storage.objects for delete
      using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end$$;
