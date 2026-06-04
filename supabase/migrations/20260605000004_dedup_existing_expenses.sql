-- =============================================================================
-- One-shot cleanup существующих expenses-дублей, созданных через banking sync
-- + bank rules.
--
-- Owner-feedback 05.06: миграция 20260604000004 почистила дубли в
-- bank_transactions, но в expenses остались дубли — старые правила/ручной
-- импорт + новое правило создали по 2-3 expense на один реальный платёж.
--
-- Правило дубля:
--   (а) Самый строгий: один bank_transaction_id → несколько expenses.
--       Оставляем canonical = expense с самым ранним created_at.
--   (б) Fuzzy: дубли БЕЗ bank_transaction_id, где совпадают salon_id +
--       expense_at + amount_cents + contractor_name (норм lowercase trim).
--       Оставляем самый ранний.
--   (в) Аналогично для other_incomes по bank_transaction_id.
--
-- Не трогаем expenses с привязкой к payroll_period_id / payroll_staff_id —
-- это legitimate-сцепленные records зарплат.
-- =============================================================================

-- ─── (а) Дубли через bank_transaction_id ──────────────────────────────────────
do $$
declare
  v_group     record;
  v_to_delete uuid[];
  v_deleted_in_iter int;
  v_total_deleted int := 0;
  v_groups int := 0;
begin
  for v_group in
    select bank_transaction_id,
           array_agg(id order by created_at asc) as ids
      from public.expenses
     where bank_transaction_id is not null
       and deleted_at is null
     group by bank_transaction_id
    having count(*) > 1
  loop
    v_to_delete := v_group.ids[2:];

    -- Soft-delete (помечаем deleted_at), не hard-delete, чтобы можно было
    -- откатить если что-то пошло не так. Не трогаем payroll-сцепленные.
    update public.expenses
       set deleted_at = now()
     where id = any(v_to_delete)
       and payroll_period_id is null
       and payroll_staff_id is null
       and deleted_at is null;

    get diagnostics v_deleted_in_iter = row_count;
    v_total_deleted := v_total_deleted + v_deleted_in_iter;
    v_groups := v_groups + 1;
  end loop;

  raise notice 'expenses dedup (bank_transaction_id): % groups, % rows soft-deleted',
    v_groups, v_total_deleted;
end$$;

-- ─── (б) Fuzzy дубли БЕЗ bank_transaction_id ──────────────────────────────────
-- Совпадают: salon_id, expense_at, amount_cents, нормализованный contractor_name.
-- Если contractor_name пустой — НЕ схлопываем (слишком рискованно).
do $$
declare
  v_group   record;
  v_to_delete uuid[];
  v_deleted_in_iter int;
  v_total_deleted int := 0;
  v_groups int := 0;
begin
  for v_group in
    select
      salon_id, expense_at, amount_cents,
      lower(trim(coalesce(contractor_name, ''))) as cn_norm,
      array_agg(id order by created_at asc) as ids
      from public.expenses
     where bank_transaction_id is null
       and deleted_at is null
     group by salon_id, expense_at, amount_cents,
              lower(trim(coalesce(contractor_name, '')))
    having count(*) > 1
       and lower(trim(coalesce(contractor_name, ''))) != ''
  loop
    v_to_delete := v_group.ids[2:];

    update public.expenses
       set deleted_at = now()
     where id = any(v_to_delete)
       and payroll_period_id is null
       and payroll_staff_id is null
       and bank_transaction_id is null
       and deleted_at is null;

    get diagnostics v_deleted_in_iter = row_count;
    v_total_deleted := v_total_deleted + v_deleted_in_iter;
    v_groups := v_groups + 1;
  end loop;

  raise notice 'expenses dedup (fuzzy by contractor_name): % groups, % rows soft-deleted',
    v_groups, v_total_deleted;
end$$;

-- ─── (в) Аналогично для other_incomes ─────────────────────────────────────────
-- one bank_transaction_id → один other_income (canonical = earliest).
do $$
declare
  v_group   record;
  v_to_delete uuid[];
  v_deleted_in_iter int;
  v_total_deleted int := 0;
  v_groups int := 0;
begin
  for v_group in
    select bank_transaction_id,
           array_agg(id order by created_at asc) as ids
      from public.other_incomes
     where bank_transaction_id is not null
       and deleted_at is null
     group by bank_transaction_id
    having count(*) > 1
  loop
    v_to_delete := v_group.ids[2:];

    update public.other_incomes
       set deleted_at = now()
     where id = any(v_to_delete)
       and deleted_at is null;

    get diagnostics v_deleted_in_iter = row_count;
    v_total_deleted := v_total_deleted + v_deleted_in_iter;
    v_groups := v_groups + 1;
  end loop;

  raise notice 'other_incomes dedup (bank_transaction_id): % groups, % rows soft-deleted',
    v_groups, v_total_deleted;
end$$;
