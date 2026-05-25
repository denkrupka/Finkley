-- Расширяем bank_transactions: добавляем привязку к visit (kind=visit или
-- kind=retail) и other_income. Для debit-транзакций привязка уже есть через
-- expense_id; для credit (поступлений) нужно линковать с доходами.
--
-- Polymorphism через две nullable-колонки + check-constraint, что заполнена
-- максимум одна из {linked_visit_id, linked_other_income_id}. Bridge-таблица
-- для частичных оплат — отдельная миграция (Этап 3).

alter table public.bank_transactions
  add column if not exists linked_visit_id uuid
    references public.visits(id) on delete set null,
  add column if not exists linked_other_income_id uuid
    references public.other_incomes(id) on delete set null,
  add column if not exists needs_review boolean not null default false;

-- Только одна из ссылок может быть выставлена за раз.
-- expense_id зарезервирован для debit, остальные — для credit.
alter table public.bank_transactions
  drop constraint if exists chk_bank_tx_single_link;
alter table public.bank_transactions
  add constraint chk_bank_tx_single_link
  check (
    (case when expense_id is not null then 1 else 0 end) +
    (case when linked_visit_id is not null then 1 else 0 end) +
    (case when linked_other_income_id is not null then 1 else 0 end) <= 1
  );

create index if not exists idx_bank_transactions_linked_visit
  on public.bank_transactions(linked_visit_id)
  where linked_visit_id is not null;

create index if not exists idx_bank_transactions_linked_other_income
  on public.bank_transactions(linked_other_income_id)
  where linked_other_income_id is not null;

comment on column public.bank_transactions.linked_visit_id is
  'Ссылка на доход-визит (services или retail), который оплачен этой транзакцией.';
comment on column public.bank_transactions.linked_other_income_id is
  'Ссылка на other_incomes, который оплачен этой транзакцией.';
comment on column public.bank_transactions.needs_review is
  'true когда auto-match нашёл совпадение с низкой уверенностью — оператор должен подтвердить.';
