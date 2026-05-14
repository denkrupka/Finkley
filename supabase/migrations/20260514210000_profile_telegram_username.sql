-- =============================================================================
-- 20260514210000_profile_telegram_username.sql
-- =============================================================================
-- Добавляем profiles.telegram_username для отображения «@username» в UI
-- после привязки Telegram через @finkley_tg_bot.
--
-- telegram_id уже есть в profiles (миграция 20260505000001) — туда сохраняется
-- numeric id. Username — необязательный (юзер может не выставить @handle в TG),
-- nullable text.
-- =============================================================================

alter table public.profiles
  add column if not exists telegram_username text;
