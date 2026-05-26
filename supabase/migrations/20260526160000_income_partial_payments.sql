-- Partial-payments для доходов (visits + other_incomes), симметрично расходам
-- (миграции 20260525150000 + 20260525160000 + 20260526114212). Image #51.
--
-- Структура:
--   visits.paid_amount_cents          bigint nullable
--   other_incomes.paid_amount_cents   bigint nullable
--   income_payment_installments       таблица (как у expenses)
--   trigger recalc_income_paid_amount пересчёт paid_amount_cents

-- ===========================================================================
-- 1) Колонки paid_amount_cents
-- ===========================================================================
alter table visits add column if not exists paid_amount_cents bigint;
alter table other_incomes add column if not exists paid_amount_cents bigint;

comment on column visits.paid_amount_cents is
  'Сколько уже оплачено (для частичных оплат). NULL = полностью оплачено '
  '(legacy: считаем amount_cents = paid). См. trigger recalc_income_paid_amount.';
comment on column other_incomes.paid_amount_cents is
  'Сколько уже оплачено (для частичных поступлений). NULL = полностью оплачено.';

-- ===========================================================================
-- 2) Таблица income_payment_installments
-- ===========================================================================
create table if not exists income_payment_installments (
  id uuid primary key default gen_random_uuid(),
  -- ровно один из двух не-null (CHECK ниже)
  visit_id uuid references visits(id) on delete cascade,
  other_income_id uuid references other_incomes(id) on delete cascade,
  paid_at timestamptz not null default now(),
  amount_cents bigint not null check (amount_cents > 0),
  payment_method text,
  -- cash_register_id хранится в salons.financial_settings.cash_registers.items[]
  -- как JSONB-id (не отдельная таблица — см. ADR-014). Поэтому text + без FK.
  cash_register_id text,
  bank_transaction_id uuid references bank_transactions(id) on delete set null,
  comment text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- ровно один FK заполнен
  constraint chk_inc_inst_single_entity check (
    (visit_id is not null and other_income_id is null)
    or (visit_id is null and other_income_id is not null)
  )
);

create index if not exists idx_inc_inst_visit on income_payment_installments(visit_id);
create index if not exists idx_inc_inst_other_income on income_payment_installments(other_income_id);
create index if not exists idx_inc_inst_bank_tx on income_payment_installments(bank_transaction_id);

comment on table income_payment_installments is
  'Журнал частичных поступлений для visits/other_incomes. Аналог '
  'expense_payment_installments для доходной стороны. Image #51.';

-- ===========================================================================
-- 3) RLS
-- ===========================================================================
alter table income_payment_installments enable row level security;

create policy "inc_inst_select_own" on income_payment_installments
  for select to authenticated using (
    exists (
      select 1
      from visits v
      join salon_members sm on sm.salon_id = v.salon_id
      where v.id = income_payment_installments.visit_id
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1
      from other_incomes oi
      join salon_members sm on sm.salon_id = oi.salon_id
      where oi.id = income_payment_installments.other_income_id
        and sm.user_id = auth.uid()
    )
  );

create policy "inc_inst_insert_own" on income_payment_installments
  for insert to authenticated with check (
    exists (
      select 1
      from visits v
      join salon_members sm on sm.salon_id = v.salon_id
      where v.id = income_payment_installments.visit_id
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1
      from other_incomes oi
      join salon_members sm on sm.salon_id = oi.salon_id
      where oi.id = income_payment_installments.other_income_id
        and sm.user_id = auth.uid()
    )
  );

create policy "inc_inst_delete_own" on income_payment_installments
  for delete to authenticated using (
    exists (
      select 1
      from visits v
      join salon_members sm on sm.salon_id = v.salon_id
      where v.id = income_payment_installments.visit_id
        and sm.user_id = auth.uid()
    )
    or exists (
      select 1
      from other_incomes oi
      join salon_members sm on sm.salon_id = oi.salon_id
      where oi.id = income_payment_installments.other_income_id
        and sm.user_id = auth.uid()
    )
  );

-- ===========================================================================
-- 4) Trigger recalc_income_paid_amount
-- ===========================================================================
create or replace function public.recalc_income_paid_amount()
returns trigger
language plpgsql
as $$
declare
  v_visit_id uuid;
  v_other_income_id uuid;
  v_sum bigint;
  v_total bigint;
begin
  -- Определяем затронутую сущность (visit или other_income) из OLD/NEW
  v_visit_id := coalesce(new.visit_id, old.visit_id);
  v_other_income_id := coalesce(new.other_income_id, old.other_income_id);

  if v_visit_id is not null then
    select coalesce(sum(amount_cents), 0) into v_sum
    from income_payment_installments
    where visit_id = v_visit_id;
    -- visit total = amount - discount + tip (как effective net)
    select coalesce(amount_cents, 0) - coalesce(discount_cents, 0) + coalesce(tip_cents, 0)
    into v_total
    from visits
    where id = v_visit_id;
    if v_sum >= v_total then
      update visits set paid_amount_cents = null where id = v_visit_id;
    else
      update visits set paid_amount_cents = v_sum where id = v_visit_id;
    end if;
  elsif v_other_income_id is not null then
    select coalesce(sum(amount_cents), 0) into v_sum
    from income_payment_installments
    where other_income_id = v_other_income_id;
    select amount_cents into v_total from other_incomes where id = v_other_income_id;
    if v_sum >= v_total then
      update other_incomes set paid_amount_cents = null where id = v_other_income_id;
    else
      update other_incomes set paid_amount_cents = v_sum where id = v_other_income_id;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists income_payment_installments_recalc on income_payment_installments;
create trigger income_payment_installments_recalc
  after insert or update or delete on income_payment_installments
  for each row execute function public.recalc_income_paid_amount();

comment on function public.recalc_income_paid_amount is
  'Пересчитывает visits.paid_amount_cents / other_incomes.paid_amount_cents '
  'на основе SUM(income_payment_installments). NULL = полностью оплачено.';
