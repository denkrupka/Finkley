-- Удаляем старую recursive RLS policy на app_admins.
--
-- Старая «Admins read app_admins» делала SELECT из той же таблицы которую
-- защищает (`auth.uid() IN (SELECT user_id FROM app_admins)`) — это
-- циклическая зависимость, Postgres падает с "infinite recursion detected".
--
-- Новая «Users read own app_admin row» (миграция 20260514120000) использует
-- простое `auth.uid() = user_id` без recursive lookup — этого достаточно
-- для useIsAppAdmin() в SPA (каждый юзер видит только свою строку).
--
-- Для админ-фич которые требуют видеть ВСЕХ app_admins (например, страница
-- Settings → Admins) — используем service-role через edge function admin-stats.

DROP POLICY IF EXISTS "Admins read app_admins" ON app_admins;
