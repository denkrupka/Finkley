-- =============================================================================
-- 20260526114212_expense_payment_installments.sql
-- =============================================================================
-- Журнал частичных оплат расходов. Раньше `expenses.paid_amount_cents` —
-- скалярная сумма уже-оплаченного, без истории. Юзер не видит когда какая
-- часть оплачена / чем. Owner-feedback 2026-05-26:
--   «при следующем открытии расхода — предыдущая частичная оплата должна
--    быть в форме списком: Дата, Сумма, Чем оплатили».
--
-- Решение: bridge-таблица `expense_payment_installments`. Каждая частичная
-- оплата = одна запись. `expenses.paid_amount_cents` остаётся как
-- денормализованный кеш (для быстрого фильтра «не полностью оплачено»),
-- пересчитывается trigger'ом на INSERT/UPDATE/DELETE installments.
--
-- При связывании bank-tx с expense через mismatch-модалку «частичная оплата»
-- — frontend создаёт installment c amount = tx.amount, paid_at = tx.executed_at,
-- cash_register_id = null (банковский перевод), bank_transaction_id = tx.id.
-- При ручной оплате через ExpenseFormModal — создаётся installment с
-- параметрами кассы.
-- =============================================================================

create table public.expense_payment_installments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  paid_at timestamptz not null default now(),
  amount_cents bigint not null check (amount_cents > 0),
  payment_method text,
  cash_register_id text,
  bank_transaction_id uuid references public.bank_transactions(id) on delete set null,
  comment text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_inst_expense on public.expense_payment_installments(expense_id);
create index idx_inst_bank_tx on public.expense_payment_installments(bank_transaction_id)
  where bank_transaction_id is not null;

alter table public.expense_payment_installments enable row level security;

-- RLS: member салона может SELECT/INSERT/UPDATE/DELETE через expense → salon → salon_members.
create policy "installments_select" on public.expense_payment_installments
  for select using (
    expense_id in (
      select id from public.expenses
       where salon_id in (
         select salon_id from public.salon_members where user_id = auth.uid()
       )
    )
  );
create policy "installments_modify" on public.expense_payment_installments
  for all using (
    expense_id in (
      select id from public.expenses
       where salon_id in (
         select salon_id from public.salon_members where user_id = auth.uid()
       )
    )
  )
  with check (
    expense_id in (
      select id from public.expenses
       where salon_id in (
         select salon_id from public.salon_members where user_id = auth.uid()
       )
    )
  );

-- =============================================================================
-- Trigger: пересчёт expenses.paid_amount_cents из installments.
-- При INSERT/UPDATE/DELETE installments → SUM(amount_cents) → expenses.paid.
-- Если sum == 0 или ровно equal amount_cents → paid_amount_cents = NULL
-- (полностью оплачено, по legacy-семантике).
-- =============================================================================
create or replace function public.recalc_expense_paid_amount()
returns trigger
language plpgsql
as $$
declare
  v_expense_id uuid;
  v_total_paid bigint;
  v_amount bigint;
begin
  v_expense_id := coalesce(new.expense_id, old.expense_id);
  if v_expense_id is null then
    return null;
  end if;

  select coalesce(sum(amount_cents), 0)
    into v_total_paid
    from public.expense_payment_installments
   where expense_id = v_expense_id;

  select amount_cents into v_amount
    from public.expenses where id = v_expense_id;

  if v_total_paid = 0 then
    update public.expenses set paid_amount_cents = null where id = v_expense_id;
  elsif v_total_paid >= v_amount then
    -- полностью покрыто installments → paid_amount_cents = NULL (legacy
    -- семантика «полностью оплачено», см. effectivePaidCents())
    update public.expenses set paid_amount_cents = null where id = v_expense_id;
  else
    update public.expenses set paid_amount_cents = v_total_paid where id = v_expense_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_inst_recalc on public.expense_payment_installments;
create trigger trg_inst_recalc
  after insert or update or delete on public.expense_payment_installments
  for each row execute function public.recalc_expense_paid_amount();

comment on table public.expense_payment_installments is
  'Журнал частичных оплат расходов. Связан с expenses (cascade delete) и
   опц с bank_transactions (set null on delete). Trigger trg_inst_recalc
   пересчитывает expenses.paid_amount_cents = SUM(installments.amount).';
