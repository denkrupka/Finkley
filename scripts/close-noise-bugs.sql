-- Закрываем шумовые/тестовые записи в багтрекере. Это ad-hoc cleanup,
-- не миграция (не нужно бронировать слот в schema_migrations).
update public.bug_reports
   set status = 'fixed',
       fixed_at = now(),
       notes = coalesce(notes || E'\n---\n', '') ||
               'Закрыто как шум/тест (' || to_char(now(), 'YYYY-MM-DD') || ')'
 where id in (
   '15255e00-e37c-4ee9-932e-2515cf41c396',  -- voice test
   '6c3c3247-ccf0-4730-9fd6-f3668fae7736',  -- voice test
   'ad0738fb-a77a-4f50-97ec-318bcf6841eb',  -- voice test (no transcript)
   '6f243471-8ea3-4fe6-8cfa-22c82a8871d3',  -- voice test (no transcript)
   'a11a8f5c-89ab-4956-aed9-633284b058d4',  -- Elena: вопрос боту, не фича
   '50f27a2d-278d-4a76-b038-906d5ea82124'   -- служебное "Функции" при создании топика
 );
