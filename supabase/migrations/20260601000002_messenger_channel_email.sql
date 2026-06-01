-- Расширение messenger_channel enum для канала 'email' — отправка и приём
-- писем (SMTP/IMAP или Gmail OAuth) в едином мессенджере салона.
--
-- Связанная задача backlog: email-poll + email-send edge functions.
-- В этой миграции — только enum, чтобы UI и code-skeleton могли ссылаться
-- на канал, не падая на FK.

alter type messenger_channel add value if not exists 'email';
