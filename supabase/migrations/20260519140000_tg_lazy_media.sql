-- ADR-015 Phase 3 / lazy media:
--   Чтобы не забивать Supabase Storage (1GB free tier) и диск VM —
--   медиа из TG сообщений скачиваются ТОЛЬКО когда юзер открыл конкретный
--   диалог в портале. Через 5 мин после ухода со страницы фото/видео/voice/
--   document удаляются из bucket tg-media (запись tg_messages остаётся,
--   `media_path` обнуляется). При повторном открытии — worker качает заново.
--
-- Аватарки (path = <session_id>/avatars/...) НЕ удаляются.
--
-- Что добавляем:
--   1. Таблица tg_dialog_views — трекинг last_opened_at / last_closed_at
--      по диалогу для каждой сессии (PK = session_id + dialog_id).
--   2. Колонка tg_messages.media_pending — true когда мы попросили worker
--      скачать (чтобы UI показал placeholder, а не «нет файла»).

create table public.tg_dialog_views (
  session_id uuid not null references public.tg_sessions(id) on delete cascade,
  dialog_id uuid not null references public.tg_dialogs(id) on delete cascade,
  last_opened_at timestamptz not null default now(),
  last_closed_at timestamptz,
  primary key (session_id, dialog_id)
);

create index tg_dialog_views_open_idx
  on public.tg_dialog_views(last_opened_at desc);

alter table public.tg_dialog_views enable row level security;

create policy tg_dialog_views_select_own on public.tg_dialog_views
  for select to authenticated
  using (
    exists (
      select 1 from public.tg_sessions s
      where s.id = tg_dialog_views.session_id and s.user_id = auth.uid()
    )
  );

create policy tg_dialog_views_insert_own on public.tg_dialog_views
  for insert to authenticated
  with check (
    exists (
      select 1 from public.tg_sessions s
      where s.id = tg_dialog_views.session_id and s.user_id = auth.uid()
    )
  );

create policy tg_dialog_views_update_own on public.tg_dialog_views
  for update to authenticated
  using (
    exists (
      select 1 from public.tg_sessions s
      where s.id = tg_dialog_views.session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tg_sessions s
      where s.id = tg_dialog_views.session_id and s.user_id = auth.uid()
    )
  );

alter table public.tg_messages
  add column media_pending boolean not null default false;
