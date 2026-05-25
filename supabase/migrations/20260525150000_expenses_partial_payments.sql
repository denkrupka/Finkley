-- Частичные оплаты для expenses.
--
-- Семантика:
--   amount_cents       — полная сумма по фактуре/документу
--   paid_amount_cents  — сколько уже оплачено
--     NULL    = «полностью оплачено» (paid == amount), legacy + дефолт
--     == amount_cents = тоже полностью оплачено (после ручной правки или
--                        full bank-payment), UI трактует как paid
--     < amount_cents  = частично оплачено, оставшаяся часть idет в pending
--     0               = пока не оплачено (есть документ, но денег ещё нет)
--
-- Расход с `paid < amount` показывается одновременно на вкладке «Оплачено»
-- (с пометкой "оплачено X из Y") и на «Не оплачено» (с суммой
-- `amount − paid`). Когда придёт остаток (через bank-import или ручной
-- расход), paid становится amount и расход «сливается» только в paid.
--
-- Bridge-таблица `bank_transaction_expense_links` для multi-link появится
-- в отдельной миграции — пока обходимся через update bank_transactions
-- триггером.

alter table public.expenses
  add column if not exists paid_amount_cents bigint
    check (paid_amount_cents is null or (paid_amount_cents >= 0 and paid_amount_cents <= amount_cents));

comment on column public.expenses.paid_amount_cents is
  'Сколько фактически оплачено. NULL = считаем полностью оплаченным (legacy default). 0..amount_cents — частичная оплата.';

-- Удобный SQL-предикат «фактически оплачено полностью»: либо null, либо равно сумме.
-- Используется в UI: WHERE paid_amount_cents is null OR paid_amount_cents = amount_cents.

create index if not exists idx_expenses_partial_payment
  on public.expenses(salon_id, paid_amount_cents)
  where paid_amount_cents is not null and paid_amount_cents < amount_cents;
