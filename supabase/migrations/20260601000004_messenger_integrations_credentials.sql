-- messenger_integrations.credentials jsonb — для канала 'email' нужен
-- SMTP/IMAP host/port/user/pass. Для прочих каналов (telegram bot, meta)
-- credentials хранятся в encrypted_secrets отдельной таблице; email
-- пока использует jsonb (encryption — TODO в _shared crypto helper).
--
-- RLS не разрешает SELECT credentials клиенту: politиcas «Members write
-- integration» grant'ит INSERT/UPDATE/DELETE, но не SELECT (другие
-- policies). Edge service-key обходит RLS и читает напрямую.

alter table public.messenger_integrations
  add column if not exists credentials jsonb not null default '{}'::jsonb;

comment on column public.messenger_integrations.credentials is
  'Email-канал: { smtp:{host,port,user,pass,secure}, imap:{host,port,user,pass,secure} }. Не доступно через RLS клиенту.';
