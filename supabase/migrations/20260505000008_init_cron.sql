-- =============================================================================
-- 20260505000008_init_cron.sql
-- =============================================================================
-- Включаем pg_cron для scheduled tasks (Booksy sync, weekly digest, и т.д.)
--
-- ⚠ Применять ТОЛЬКО на удалённых Supabase проектах.
--    На локальном supabase start этой extension может не быть.
--    Если применяется локально и падает — пропустить (use IF NOT EXISTS).
-- =============================================================================

create extension if not exists pg_cron with schema extensions;

-- Доступ для service_role
grant usage on schema cron to service_role;

-- Конкретные cron-задачи добавляем в отдельных миграциях
-- по мере появления edge functions в стадии 1+:
--
-- Пример (стадия 3, будет в отдельной миграции):
--
-- select cron.schedule(
--   'booksy-sync',
--   '*/30 * * * *',
--   $$ select net.http_post(
--        'https://<ref>.functions.supabase.co/booksy-sync',
--        '{}'::jsonb,
--        'application/json'::text,
--        headers := jsonb_build_object(
--          'Authorization', 'Bearer ' || current_setting('cron.secret')
--        )
--      ) $$
-- );
