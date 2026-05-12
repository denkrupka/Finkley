-- Unified messenger inbox
-- Один встроенный мессенджер для салона: чаты от клиентов из всех
-- подключённых каналов (Telegram, WhatsApp, Instagram, Facebook).
-- Сообщения хранятся локально, провайдер-интеграции — отдельным
-- слоем (webhook → INSERT message).

CREATE TYPE messenger_channel AS ENUM ('telegram', 'whatsapp', 'instagram', 'facebook', 'internal');

CREATE TABLE IF NOT EXISTS messenger_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  channel messenger_channel NOT NULL,
  /** Внешний идентификатор собеседника в канале (telegram chat_id, instagram user_id, ...) */
  external_user_id text NOT NULL,
  /** Имя клиента как видно в канале — для отображения в списке чатов. */
  display_name text NOT NULL DEFAULT '',
  /** Аватар (URL). Канал может присылать через webhook. */
  avatar_url text,
  /** Связь с уже существующим клиентом в clients (если matched). */
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  /** Кол-во непрочитанных сообщений (incoming, не direction=out) для салона. */
  unread_count int NOT NULL DEFAULT 0,
  /** Время последнего сообщения — для сортировки списка. */
  last_message_at timestamptz NOT NULL DEFAULT now(),
  /** Превью последнего сообщения для рендеринга в списке. */
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (salon_id, channel, external_user_id)
);

CREATE INDEX IF NOT EXISTS idx_msg_conv_salon ON messenger_conversations (salon_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_conv_channel ON messenger_conversations (salon_id, channel);

CREATE TABLE IF NOT EXISTS messenger_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  /** 'in' — пришло от клиента, 'out' — отправлено салоном. */
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  text text,
  /** Path в Storage bucket 'messenger-media' если приложили фото/документ. */
  media_path text,
  media_kind text CHECK (media_kind IN ('image', 'video', 'audio', 'file')),
  /** ID сообщения в внешнем канале для дедупа webhook'ов. */
  external_message_id text,
  /** Кто отправил (если out) — для аудита. */
  sent_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msg_messages_conv ON messenger_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_messages_salon ON messenger_messages (salon_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_msg_external
  ON messenger_messages (conversation_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

-- Connected messenger integrations per-salon (credentials encrypted at-rest by Supabase).
CREATE TABLE IF NOT EXISTS messenger_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  channel messenger_channel NOT NULL,
  /** Provider-specific config (encrypted secrets хранятся в encrypted_secrets отдельной таблице). */
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'pending', 'connected', 'error')),
  external_account_id text,
  display_name text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salon_id, channel)
);

ALTER TABLE messenger_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messenger_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messenger_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read conversations"
  ON messenger_conversations FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM salon_members WHERE user_id = auth.uid()));
CREATE POLICY "Members write conversations"
  ON messenger_conversations FOR ALL
  USING (salon_id IN (SELECT salon_id FROM salon_members WHERE user_id = auth.uid()))
  WITH CHECK (salon_id IN (SELECT salon_id FROM salon_members WHERE user_id = auth.uid()));

CREATE POLICY "Members read messages"
  ON messenger_messages FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM salon_members WHERE user_id = auth.uid()));
CREATE POLICY "Members write messages"
  ON messenger_messages FOR ALL
  USING (salon_id IN (SELECT salon_id FROM salon_members WHERE user_id = auth.uid()))
  WITH CHECK (salon_id IN (SELECT salon_id FROM salon_members WHERE user_id = auth.uid()));

CREATE POLICY "Owner/Admin manage integrations"
  ON messenger_integrations FOR ALL
  USING (
    salon_id IN (
      SELECT salon_id FROM salon_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    salon_id IN (
      SELECT salon_id FROM salon_members WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Members read integrations"
  ON messenger_integrations FOR SELECT
  USING (salon_id IN (SELECT salon_id FROM salon_members WHERE user_id = auth.uid()));

-- Авто-обновление last_message_at + last_message_preview при INSERT сообщения
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS trigger AS $$
BEGIN
  UPDATE messenger_conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = COALESCE(NEW.text, '[media]'),
      unread_count = CASE WHEN NEW.direction = 'in' THEN unread_count + 1 ELSE unread_count END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messenger_message_after_insert ON messenger_messages;
CREATE TRIGGER trg_messenger_message_after_insert
  AFTER INSERT ON messenger_messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();
