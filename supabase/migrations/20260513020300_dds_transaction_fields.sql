-- Поля транзакции для ДДС: контрагент + под-статья.
-- Все NULLable — старые записи остаются валидными.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sub_article text;
ALTER TABLE other_incomes ADD COLUMN IF NOT EXISTS payer_name text;
ALTER TABLE other_incomes ADD COLUMN IF NOT EXISTS sub_article text;

COMMENT ON COLUMN expenses.sub_article IS
  'Под-статья (иерархическая) для ДДС — детализация внутри expense_categories.';
COMMENT ON COLUMN other_incomes.payer_name IS
  'Плательщик/контрагент для прочих доходов (для ДДС-детализации).';
COMMENT ON COLUMN other_incomes.sub_article IS
  'Под-статья для прочих доходов.';
