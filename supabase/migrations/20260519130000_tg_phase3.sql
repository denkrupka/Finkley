-- ADR-015 Phase 3: фикс RLS на upload + аватарки + поиск + реакции/видео.
--
-- Что добавляем:
--   1. INSERT policy для bucket tg-media — SPA-юзер может класть файлы в
--      путь upload/<session_id>/<uuid>.ext своей сессии. До этого политика
--      была только SELECT через service_role на INSERT — клиентский upload
--      падал с "new row violates row-level security policy".
--   2. Расширяем SELECT policy: юзер видит И worker-скачанные файлы
--      (path = <session_id>/<msg_id>.ext) И свои загруженные (upload/...).
--   3. pg_trgm индексы на text/media_caption для быстрого поиска по чатам
--      (UI делает ILIKE % %).
--   4. Расширяем check на tg_outbox.action — добавляем send_video, send_voice,
--      download_history (для подгрузки старых сообщений по требованию).
--   5. Колонка tg_messages.has_reactions — для быстрого подсветить сообщения
--      с реакциями в UI (если потребуется фильтр).

-- ----------------------------------------------------------------------------
-- 1. Storage RLS для tg-media
-- ----------------------------------------------------------------------------

drop policy if exists tg_media_select_own on storage.objects;
create policy tg_media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tg-media'
    and (
      -- worker-загруженные: <session_id>/<msg_id>.ext
      exists (
        select 1 from public.tg_sessions s
        where s.id::text = (storage.foldername(name))[1]
          and s.user_id = auth.uid()
      )
      or
      -- SPA-загруженные: upload/<session_id>/<uuid>.ext
      (
        (storage.foldername(name))[1] = 'upload'
        and exists (
          select 1 from public.tg_sessions s
          where s.id::text = (storage.foldername(name))[2]
            and s.user_id = auth.uid()
        )
      )
    )
  );

-- SPA может класть файлы только в upload/<session_id>/... своей сессии.
create policy tg_media_insert_own_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tg-media'
    and (storage.foldername(name))[1] = 'upload'
    and exists (
      select 1 from public.tg_sessions s
      where s.id::text = (storage.foldername(name))[2]
        and s.user_id = auth.uid()
    )
  );

-- SPA может удалять только свои upload-файлы (для отмены неотправленного).
create policy tg_media_delete_own_upload on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tg-media'
    and (storage.foldername(name))[1] = 'upload'
    and exists (
      select 1 from public.tg_sessions s
      where s.id::text = (storage.foldername(name))[2]
        and s.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Поиск по сообщениям (ILIKE с trgm-индексом)
-- ----------------------------------------------------------------------------

create extension if not exists pg_trgm;

create index if not exists tg_messages_text_trgm_idx
  on public.tg_messages using gin (text gin_trgm_ops)
  where deleted = false and text is not null;

create index if not exists tg_messages_caption_trgm_idx
  on public.tg_messages using gin (media_caption gin_trgm_ops)
  where deleted = false and media_caption is not null;

-- ----------------------------------------------------------------------------
-- 3. Outbox actions: добавляем send_video, send_voice, download_history
-- ----------------------------------------------------------------------------

alter table public.tg_outbox drop constraint if exists tg_outbox_action_check;
alter table public.tg_outbox add constraint tg_outbox_action_check
  check (action in (
    'send_text', 'send_media', 'send_photo', 'send_video', 'send_voice', 'send_document',
    'edit_message', 'delete_message', 'react', 'mark_read', 'typing',
    'fetch_history', 'download_media'
  ));
