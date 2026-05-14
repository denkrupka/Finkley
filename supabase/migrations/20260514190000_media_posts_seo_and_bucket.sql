-- =============================================================================
-- 20260514190000_media_posts_seo_and_bucket.sql
-- =============================================================================
-- PR6: блог переходит на TipTap WYSIWYG → храним HTML рядом с markdown.
-- Также добавляем SEO-поля (мета-описание для поисковиков, og:image,
-- canonical) и хранилище для изображений блога.
-- =============================================================================

-- ---- media_posts: HTML body + SEO ----
alter table public.media_posts
  add column if not exists body_html text,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists og_image_url text,
  add column if not exists canonical_url text,
  add column if not exists keywords text[];

-- ---- Storage bucket для изображений блога ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-images', 'blog-images', true, 10485760,
        array['image/jpeg','image/png','image/webp','image/gif','image/svg+xml'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'blog-images public read'
  ) then
    create policy "blog-images public read" on storage.objects
      for select
      using (bucket_id = 'blog-images');
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'blog-images admin write'
  ) then
    create policy "blog-images admin write" on storage.objects
      for all
      using (
        bucket_id = 'blog-images'
        and auth.uid() in (select user_id from public.app_admins)
      )
      with check (
        bucket_id = 'blog-images'
        and auth.uid() in (select user_id from public.app_admins)
      );
  end if;
end$$;
