-- =============================================================================
-- 20260505000011_grants_default_privileges.sql
-- =============================================================================
-- На этом Supabase-проекте default privileges для public схемы не настроены —
-- ни у одной из ролей (anon, authenticated, service_role) нет SELECT/INSERT/
-- UPDATE/DELETE на таблицах, созданных миграциями 000001–000010, только
-- унаследованные REFERENCES/TRIGGER/TRUNCATE. Это ломает любой PostgREST-запрос
-- ("permission denied for table ...") даже из service-role клиента.
--
-- Что делаем:
-- 1. USAGE на схему public для трёх стандартных ролей.
-- 2. CRUD-grant'ы на все существующие таблицы и view'ы.
-- 3. USAGE/SELECT на все sequences (нужно для default uuid/bigserial).
-- 4. EXECUTE на все функции в public.
-- 5. Default privileges для всех future-таблиц/функций/sequences,
--    применяемых в роли postgres.
--
-- Безопасность: настоящие права доступа определяются RLS-политиками,
-- которые уже включены на всех таблицах. Anon/authenticated получают
-- DML, но RLS отсеивает строки, которые им не положены. service_role
-- по-прежнему bypass'ит RLS — это интенция (edge functions с админ-доступом).
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated;
grant all on all tables in schema public to service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

grant execute on all functions in schema public
  to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
