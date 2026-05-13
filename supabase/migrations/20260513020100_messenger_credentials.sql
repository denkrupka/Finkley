-- Encrypted credentials for messenger integrations.
-- Шифруются через AES-256-GCM в edge function messenger-connect (env MESSENGER_SECRETS_KEY).
-- SPA не имеет доступа к этой колонке: добавляем RLS-фильтр чтобы service-role
-- читал, а member видел только публичные мета-поля через VIEW.

ALTER TABLE messenger_integrations
  ADD COLUMN IF NOT EXISTS credentials jsonb;

ALTER TABLE messenger_integrations
  ADD COLUMN IF NOT EXISTS webhook_secret text;

COMMENT ON COLUMN messenger_integrations.credentials IS
  'Encrypted provider credentials (AES-256-GCM via WebCrypto in edge function messenger-connect). Никогда не возвращать клиенту.';
COMMENT ON COLUMN messenger_integrations.webhook_secret IS
  'Опциональный secret_token для Telegram setWebhook, чтобы валидировать входящие апдейты.';
