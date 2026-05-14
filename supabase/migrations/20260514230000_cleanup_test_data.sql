-- =============================================================================
-- 20260514230000_cleanup_test_data.sql
-- =============================================================================
-- One-shot data cleanup: удаление тестовых юзеров (и всех их данных) с MAIN.
-- В fresh-окружениях (test / new replica) операция no-op — таких юзеров нет.
--
-- Удаляются юзеры с email-паттернами тестов:
--   *@finkley.test, *@finsalon.test, *@srv1.mail-tester.com, *kynninc.com,
--   pavlenko0yevhenii@gmail.com, tg_326628865@telegram.finkley.app
-- (По договорённости с владельцем — это всё тесты.)
--
-- Сохраняются: deniskrupka001@gmail.com (super-admin) + fin.pls27@gmail.com
-- (активный реальный юзер).
--
-- Прямой DELETE upal на FK audit_log_salon_id_fkey: триггер trg_audit_members
-- пишет в audit_log при cascade-удалении salon_members, а к этому моменту
-- salon уже исчез. Решение: SET LOCAL session_replication_role = replica
-- отключает триггеры в рамках транзакции.
-- =============================================================================

do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids
    from auth.users
   where email like '%@finkley.test'
      or email like '%@finsalon.test'
      or email like '%@srv1.mail-tester.com'
      or email like '%kynninc.com'
      or email = 'pavlenko0yevhenii@gmail.com'
      or email = 'tg_326628865@telegram.finkley.app';

  if v_ids is null or array_length(v_ids, 1) is null then
    raise notice 'No test users found — skipping cleanup.';
    return;
  end if;

  raise notice 'Cleaning up % test users and their data', array_length(v_ids, 1);

  -- Отключаем триггеры на эту транзакцию, чтобы cascade delete salons →
  -- salon_members → audit-trigger не падал на FK к уже удалённой salons-row.
  set local session_replication_role = replica;

  -- Bug-reports от тестовых юзеров (reporter_user_id ON DELETE SET NULL —
  -- не каскадится; чистим явно).
  delete from public.bug_reports where reporter_user_id = any(v_ids);

  -- Салоны тестовых юзеров. Cascade почистит salon_members, visits, expenses,
  -- clients, payouts, salon_subscriptions, integration_credentials, insights,
  -- audit_log, и т.д. (все FK на salons.id с on delete cascade).
  delete from public.salons where created_by = any(v_ids);

  -- Сами auth.users. Cascade почистит profiles, app_admins (если кто-то из
  -- тестов попал — маловероятно), salon_members где они были не-owner-ом.
  delete from auth.users where id = any(v_ids);

  set local session_replication_role = origin;
end$$;
