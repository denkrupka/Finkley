-- RLS fix: каждый авторизованный пользователь может прочитать СВОЮ собственную
-- строку из app_admins. Без этого useIsAppAdmin() в SPA всегда возвращает false
-- (старая policy «Admins read app_admins» проверяет членство в той же таблице,
-- которую пытаемся прочитать — circular).
--
-- Безопасно: WHERE auth.uid() = user_id жёстко ограничивает чтение одной строкой.

DROP POLICY IF EXISTS "Users read own app_admin row" ON app_admins;
CREATE POLICY "Users read own app_admin row"
  ON app_admins FOR SELECT
  USING (auth.uid() = user_id);
