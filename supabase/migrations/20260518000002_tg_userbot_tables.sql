-- ADR-015: Telegram userbot (личный аккаунт) — таблицы для интеграции
-- через Telethon на отдельном сервисе (services/tg-userbot/).
--
-- Поток:
--   1. Юзер вводит phone в SPA → POST userbot.finkley.app/auth/start
--      → userbot создаёт `tg_auth_flows` (state=awaiting_code)
--   2. SPA отправляет полученный SMS-код → userbot завершает авторизацию,
--      пишет зашифрованную session-string в `tg_sessions`
--   3. Userbot подписан на TG events → пишет новые сообщения в `tg_messages`
--   4. SPA через Supabase Realtime реактивно отрисовывает входящие
--   5. Отправка: SPA пишет в `tg_outbox` (action=send_text) →
--      userbot слушает → выполняет MTProto-вызов → результат в `tg_messages`
--
-- Безопасность:
--   - `session_encrypted` шифруется AES-256-GCM ключом SECRETS_ENCRYPTION_KEY
--     (тот же что для wFirma, ADR-002), расшифровка только на userbot-сервисе
--   - RLS: юзер видит только свои сессии и связанные данные
--   - service_role используется userbot-сервисом для bypass RLS

-- ============================================================================
-- 1. tg_sessions — авторизованные TG-аккаунты юзеров
-- ============================================================================
create table public.tg_sessions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  -- Зашифрованная MTProto session-string (AES-GCM). Никогда не возвращаем
  -- на клиента — расшифровка только в edge function или userbot worker.
  session_encrypted text not null,
  -- Кеш профиля TG-юзера для UI (заполняется userbot'ом после авторизации).
  tg_user_id bigint,
  tg_username text,
  tg_first_name text,
  tg_last_name text,
  tg_photo_path text,  -- путь в Supabase Storage bucket tg-media
  status text not null default 'active'
    check (status in ('active', 'revoked', 'error', 'unauthorized')),
  last_error text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Один юзер портала может подключить только одну TG-сессию в салоне
  -- (чтобы не возникало многозначности в outbox). Если нужно — позже снимаем.
  unique (salon_id, user_id)
);

create index tg_sessions_salon_idx on public.tg_sessions(salon_id);
create index tg_sessions_status_idx on public.tg_sessions(status) where status = 'active';

alter table public.tg_sessions enable row level security;

-- RLS: юзер видит только свои сессии (привязка через user_id)
create policy tg_sessions_select_own on public.tg_sessions
  for select to authenticated
  using (user_id = auth.uid());

create policy tg_sessions_insert_own on public.tg_sessions
  for insert to authenticated
  with check (user_id = auth.uid());

create policy tg_sessions_update_own on public.tg_sessions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy tg_sessions_delete_own on public.tg_sessions
  for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- 2. tg_dialogs — список чатов (диалогов) в TG-аккаунте юзера
-- ============================================================================
create table public.tg_dialogs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tg_sessions(id) on delete cascade,
  tg_chat_id bigint not null,
  type text not null check (type in ('user', 'group', 'channel', 'bot')),
  title text,
  username text,
  -- Кеш аватарки для списка диалогов (path в bucket tg-media).
  photo_path text,
  -- Последнее сообщение (для preview в списке).
  last_message_text text,
  last_message_at timestamptz,
  last_message_from_id bigint,
  -- Количество непрочитанных (отдаёт Telegram).
  unread_count int not null default 0,
  pinned boolean not null default false,
  archived boolean not null default false,
  muted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, tg_chat_id)
);

create index tg_dialogs_session_idx on public.tg_dialogs(session_id);
create index tg_dialogs_last_msg_idx on public.tg_dialogs(session_id, last_message_at desc nulls last);

alter table public.tg_dialogs enable row level security;

-- RLS: видим диалоги тех сессий, которые наши
create policy tg_dialogs_select_via_session on public.tg_dialogs
  for select to authenticated
  using (
    exists (
      select 1 from public.tg_sessions s
      where s.id = tg_dialogs.session_id and s.user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE — только через service_role (userbot worker)
-- Клиент не должен напрямую модифицировать диалоги.

-- ============================================================================
-- 3. tg_messages — сообщения в диалогах
-- ============================================================================
create table public.tg_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tg_sessions(id) on delete cascade,
  dialog_id uuid not null references public.tg_dialogs(id) on delete cascade,
  -- ID сообщения в TG для дедупликации (одно сообщение приходит от Telethon
  -- несколько раз при reconnect / fetch_history overlap).
  tg_message_id bigint not null,
  -- Отправитель (null = система или service message).
  from_tg_user_id bigint,
  -- Исходящее = отправил юзер портала со своей сессии.
  is_outgoing boolean not null,
  text text,
  -- Медиа: kind определяет тип файла, media_path — путь в Supabase Storage.
  media_kind text check (media_kind in ('photo', 'video', 'document', 'voice', 'sticker', 'animation', 'video_note')),
  media_path text,
  media_mime_type text,
  media_size_bytes bigint,
  media_thumb_path text,  -- preview для list view
  -- Ответ на другое сообщение.
  reply_to_tg_message_id bigint,
  -- Реакции: jsonb массив [{"emoji":"❤","count":5,"chose_by_me":true}, ...]
  reactions jsonb,
  -- Forward-info: jsonb {from_id, from_name, from_date}
  forward_from jsonb,
  edited_at timestamptz,
  deleted boolean not null default false,
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (session_id, tg_message_id)
);

create index tg_messages_dialog_sent_idx on public.tg_messages(dialog_id, sent_at desc);
create index tg_messages_session_idx on public.tg_messages(session_id);

alter table public.tg_messages enable row level security;

create policy tg_messages_select_via_session on public.tg_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.tg_sessions s
      where s.id = tg_messages.session_id and s.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 4. tg_outbox — очередь действий от SPA к userbot
-- ============================================================================
create table public.tg_outbox (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tg_sessions(id) on delete cascade,
  dialog_id uuid references public.tg_dialogs(id) on delete cascade,
  action text not null check (action in (
    'send_text', 'send_media', 'edit_message', 'delete_message',
    'react', 'mark_read', 'typing', 'fetch_history'
  )),
  -- payload зависит от action:
  --   send_text: {"text": "...", "reply_to_tg_message_id": 123}
  --   send_media: {"media_path": "tg-media/...", "caption": "..."}
  --   edit_message: {"tg_message_id": 123, "text": "new text"}
  --   delete_message: {"tg_message_id": 123}
  --   react: {"tg_message_id": 123, "emoji": "❤"}
  --   mark_read: {"tg_message_id": 123}
  --   typing: {} (отправляет typing-индикатор)
  --   fetch_history: {"offset_id": 0, "limit": 50}
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index tg_outbox_pending_idx on public.tg_outbox(status, created_at)
  where status in ('pending', 'processing');
create index tg_outbox_session_idx on public.tg_outbox(session_id);

alter table public.tg_outbox enable row level security;

-- SPA может INSERT в outbox для своих сессий (отправить сообщение)
create policy tg_outbox_insert_own on public.tg_outbox
  for insert to authenticated
  with check (
    exists (
      select 1 from public.tg_sessions s
      where s.id = tg_outbox.session_id and s.user_id = auth.uid()
    )
  );

-- SELECT — чтобы видеть статус отправки своих сообщений
create policy tg_outbox_select_own on public.tg_outbox
  for select to authenticated
  using (
    exists (
      select 1 from public.tg_sessions s
      where s.id = tg_outbox.session_id and s.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 5. tg_auth_flows — временные state машины авторизации (phone → code → 2FA)
-- ============================================================================
create table public.tg_auth_flows (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  -- phone_code_hash — возвращает Telegram после send_code_request; нужен для
  -- sign_in. Шифруется тем же ключом что и session.
  phone_code_hash_encrypted text,
  -- Временная зашифрованная in-flight TG-сессия (до завершения 2FA).
  pending_session_encrypted text,
  state text not null default 'awaiting_code'
    check (state in ('awaiting_code', 'awaiting_2fa', 'done', 'failed', 'expired')),
  last_error text,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tg_auth_flows_user_idx on public.tg_auth_flows(user_id, state);
create index tg_auth_flows_expires_idx on public.tg_auth_flows(expires_at) where state != 'done';

alter table public.tg_auth_flows enable row level security;

create policy tg_auth_flows_select_own on public.tg_auth_flows
  for select to authenticated
  using (user_id = auth.uid());

create policy tg_auth_flows_insert_own on public.tg_auth_flows
  for insert to authenticated
  with check (user_id = auth.uid());

-- Сам flow обновляется через service_role (userbot bridge), юзер только
-- читает статус и создаёт новый.

-- ============================================================================
-- 6. Triggers: автообновление updated_at
-- ============================================================================
create or replace function public.tg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger tg_sessions_touch before update on public.tg_sessions
  for each row execute function public.tg_touch_updated_at();
create trigger tg_dialogs_touch before update on public.tg_dialogs
  for each row execute function public.tg_touch_updated_at();
create trigger tg_auth_flows_touch before update on public.tg_auth_flows
  for each row execute function public.tg_touch_updated_at();

-- ============================================================================
-- 7. Storage bucket для медиа (фото/видео/файлы из TG)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('tg-media', 'tg-media', false, 50 * 1024 * 1024)  -- 50 MB max
on conflict (id) do nothing;

-- RLS на storage.objects: путь должен начинаться с session_id; юзер видит
-- только файлы своих сессий.
create policy tg_media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tg-media'
    and exists (
      select 1 from public.tg_sessions s
      where s.id::text = (storage.foldername(name))[1]
        and s.user_id = auth.uid()
    )
  );

-- INSERT/DELETE — только service_role (userbot worker), не клиент.

-- ============================================================================
-- 8. Realtime: включаем для tg_messages и tg_outbox чтобы SPA подписался
-- ============================================================================
alter publication supabase_realtime add table public.tg_messages;
alter publication supabase_realtime add table public.tg_dialogs;
alter publication supabase_realtime add table public.tg_outbox;
alter publication supabase_realtime add table public.tg_auth_flows;
