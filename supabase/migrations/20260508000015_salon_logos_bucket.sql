-- =============================================================================
-- 20260508000015_salon_logos_bucket.sql
-- =============================================================================
-- Logo upload в Settings (был URL-инпут, теперь file picker → Storage).
-- Bucket публичный (логотипы видны на дашборде в шапке без signed URL).
-- =============================================================================

-- Bucket: публичный (Public read), 5 MB cap, только картинки.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('salon-logos', 'salon-logos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS:
--   read  — anon/authenticated (bucket public, но всё равно явно)
--   write — только админ/owner салона по first-folder = salon_id
--   delete — то же что write
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'salon-logos: anyone read'
  ) then
    create policy "salon-logos: anyone read" on storage.objects for select
      using (bucket_id = 'salon-logos');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'salon-logos: admin write'
  ) then
    create policy "salon-logos: admin write" on storage.objects for insert
      with check (
        bucket_id = 'salon-logos'
        and (storage.foldername(name))[1]::uuid in (
          select salon_id from public.salon_members
          where user_id = auth.uid() and role in ('owner', 'admin')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'salon-logos: admin update'
  ) then
    create policy "salon-logos: admin update" on storage.objects for update
      using (
        bucket_id = 'salon-logos'
        and (storage.foldername(name))[1]::uuid in (
          select salon_id from public.salon_members
          where user_id = auth.uid() and role in ('owner', 'admin')
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'salon-logos: admin delete'
  ) then
    create policy "salon-logos: admin delete" on storage.objects for delete
      using (
        bucket_id = 'salon-logos'
        and (storage.foldername(name))[1]::uuid in (
          select salon_id from public.salon_members
          where user_id = auth.uid() and role in ('owner', 'admin')
        )
      );
  end if;
end$$;
