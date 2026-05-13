-- Enable Supabase Realtime для мессенджер-таблиц.
-- SPA подписывается на postgres_changes для INSERT в messenger_messages
-- и UPDATE в messenger_conversations — чтобы новые сообщения появлялись
-- мгновенно без перезагрузки страницы.

ALTER PUBLICATION supabase_realtime ADD TABLE messenger_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE messenger_conversations;
