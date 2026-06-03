-- =============================================================================
-- Расширяем системную категорию «БЕЗ КАТЕГОРИИ» (миграция 20260603000018)
-- на все accounting-импорты: wFirma, Fakturownia, inFakt + KSeF (уже).
--
-- Бэкфилл: расходы с source IN ('wfirma','fakturownia','infakt') и
-- category_id IS NULL → переводим на «БЕЗ КАТЕГОРИИ».
--
-- ВНИМАНИЕ: НЕ трогаем существующие категории «Импорт wFirma», «Импорт
-- Fakturownia», «Импорт inFakt» и расходы в них — у юзера эти
-- pie-slice'ы уже видны в P&L, удаление сломает аналитику. Эта
-- миграция только подбирает осиротевшие расходы без категории.
-- =============================================================================

update public.expenses e
   set category_id = c.id
  from public.expense_categories c
 where c.salon_id = e.salon_id
   and c.is_system = true
   and c.name = 'БЕЗ КАТЕГОРИИ'
   and e.category_id is null
   and e.source in ('wfirma', 'fakturownia', 'infakt')
   and e.deleted_at is null;

-- Аналогично для scheduled_payments (планы оплаты wFirma/Fakturownia/inFakt
-- если такие есть). У KSeF scheduled_payments уже покрыт миграцией
-- 20260603000018.
update public.scheduled_payments sp
   set category_id = c.id
  from public.expense_categories c
 where c.salon_id = sp.salon_id
   and c.is_system = true
   and c.name = 'БЕЗ КАТЕГОРИИ'
   and sp.category_id is null
   and sp.source in ('wfirma', 'fakturownia', 'infakt');
