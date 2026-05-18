-- ADR-015 Phase 2: read receipts, медиа-метаданные, bootstrap-флаг.
--
-- Что добавляем:
--   - tg_sessions.bootstrap_completed_at — отметка что worker сделал
--     первичную загрузку диалогов и истории (чтобы не повторять)
--   - tg_messages.delivered — в TG сообщение доставляется как только сервер
--     принял (для outgoing — это сразу true). Оставляем для будущих edge-кейсов
--   - tg_messages.read_by_recipient_at — когда другая сторона прочитала
--     ИСХОДЯЩЕЕ сообщение (events.MessageRead с outgoing=True). Заполняется
--     только для is_outgoing=true.
--   - tg_messages.media_caption — подпись под фото/видео (TG: ниже медиа)
--   - tg_outbox: новые actions 'send_photo', 'send_document' для отправки
--     медиа (payload содержит storage_path или url)

alter table public.tg_sessions
  add column bootstrap_completed_at timestamptz;

alter table public.tg_messages
  add column delivered boolean not null default true,
  add column read_by_recipient_at timestamptz,
  add column media_caption text;

-- Расширяем check на новые actions
alter table public.tg_outbox drop constraint if exists tg_outbox_action_check;
alter table public.tg_outbox add constraint tg_outbox_action_check
  check (action in (
    'send_text', 'send_media', 'send_photo', 'send_document',
    'edit_message', 'delete_message', 'react', 'mark_read', 'typing',
    'fetch_history'
  ));

-- Индекс для быстрого фильтра «непрочитанные мной» в UI (входящие сообщения
-- в dialogs где unread_count > 0)
create index if not exists tg_messages_dialog_outgoing_idx
  on public.tg_messages(dialog_id, is_outgoing)
  where deleted = false;
