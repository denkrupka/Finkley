-- Дефолтная expense_category для контрагента.
--
-- При создании expense (через OCR / KSeF / manual выбор контрагента) если
-- у контрагента задан default_expense_category_id — автоматически
-- проставляется в expenses.category_id. Юзер может изменить вручную.
--
-- Цель: автоматизировать категоризацию повторяющихся расходов от одних
-- и тех же контрагентов (Aliexpress → «Косметика», Orange → «Связь»,
-- Vatican Sp. z o.o. → «Аренда»).

alter table public.counterparties
  add column if not exists default_expense_category_id uuid
    references public.expense_categories(id) on delete set null;

comment on column public.counterparties.default_expense_category_id is
  'Дефолтная expense_category для расходов с этим контрагентом. NULL = без дефолта (юзер выбирает каждый раз). Используется при создании expense через OCR/KSeF/manual для автозаполнения category_id.';
