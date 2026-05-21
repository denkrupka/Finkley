-- =============================================================================
-- 20260522000001_create_salon_setup_anon_grant.sql
-- =============================================================================
-- Фикс: у новых юзеров на онбординге наблюдался "permission denied for
-- function create_salon_with_setup" — JWT иногда воспринимался как anon
-- (например в момент refresh / email-confirm pending state).
--
-- Решение: дать execute и anon-роли тоже. Функция сама проверяет
-- auth.uid() not null в первой же строке, поэтому открытие для anon
-- не создаёт дыру — без JWT всё равно сразу exception.
-- =============================================================================

revoke all on function public.create_salon_with_setup(
  text, text, text, text, text, text, jsonb, jsonb, text[]
) from public;

grant execute on function public.create_salon_with_setup(
  text, text, text, text, text, text, jsonb, jsonb, text[]
) to authenticated, service_role, anon;
