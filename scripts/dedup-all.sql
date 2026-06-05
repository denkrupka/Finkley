-- ─── 1) bank_transactions: cross-account aggressive (по salon_id) ──────────
do $$
declare
  v_g record;
  v_total int := 0;
  v_iter int;
begin
  for v_g in
    with txs as (
      select
        bt.id,
        bt.executed_at::date as dt,
        bt.amount_cents,
        bt.type,
        lower(trim(coalesce(bt.counterparty, ''))) || '|' ||
          lower(trim(coalesce(bt.description, ''))) as k,
        bt.created_at,
        bt.expense_id,
        bt.linked_visit_id,
        bt.linked_other_income_id,
        bc.salon_id
      from public.bank_transactions bt
      join public.bank_accounts ba on ba.id = bt.account_id
      join public.bank_connections bc on bc.id = ba.connection_id
    )
    select
      salon_id, dt, amount_cents, type, k,
      array_agg(id order by
        case when expense_id is not null
              or linked_visit_id is not null
              or linked_other_income_id is not null then 0 else 1 end,
        created_at asc
      ) as ids
      from txs
      group by salon_id, dt, amount_cents, type, k
      having count(*) > 1
  loop
    delete from public.bank_transactions
     where id = any((v_g.ids)[2:])
       and expense_id is null
       and linked_visit_id is null
       and linked_other_income_id is null
       and not exists (
         select 1 from public.bank_tx_splits s
          where s.bank_transaction_id = bank_transactions.id
       );
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'bank_transactions dedup deleted: %', v_total;
end$$;

-- ─── 2) expenses: по bank_transaction_id (guarded) + fuzzy по contractor ──
do $$
declare
  v_g record;
  v_total int := 0;
  v_iter int;
  v_has boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='expenses'
       and column_name='bank_transaction_id'
  ) into v_has;
  if not v_has then return; end if;

  for v_g in
    select bank_transaction_id, array_agg(id order by created_at asc) as ids
      from public.expenses
      where bank_transaction_id is not null and deleted_at is null
      group by bank_transaction_id
      having count(*) > 1
  loop
    update public.expenses
       set deleted_at = now()
     where id = any((v_g.ids)[2:])
       and payroll_period_id is null
       and payroll_staff_id is null
       and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'expenses dedup (bank_transaction_id) soft-deleted: %', v_total;
end$$;

do $$
declare
  v_g record;
  v_total int := 0;
  v_iter int;
begin
  for v_g in
    select salon_id, expense_at, amount_cents,
           lower(trim(coalesce(contractor_name, ''))) as cn,
           array_agg(id order by created_at asc) as ids
      from public.expenses
      where deleted_at is null
        and lower(trim(coalesce(contractor_name, ''))) <> ''
      group by salon_id, expense_at, amount_cents,
               lower(trim(coalesce(contractor_name, '')))
      having count(*) > 1
  loop
    update public.expenses
       set deleted_at = now()
     where id = any((v_g.ids)[2:])
       and payroll_period_id is null
       and payroll_staff_id is null
       and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'expenses dedup (fuzzy by contractor) soft-deleted: %', v_total;
end$$;

-- ─── 3) other_incomes: fuzzy по salon + income_at + amount + payer_name ────
do $$
declare
  v_g record;
  v_total int := 0;
  v_iter int;
begin
  for v_g in
    select salon_id, income_at, amount_cents,
           lower(trim(coalesce(payer_name, ''))) as pn,
           array_agg(id order by created_at asc) as ids
      from public.other_incomes
      where deleted_at is null
        and lower(trim(coalesce(payer_name, ''))) <> ''
      group by salon_id, income_at, amount_cents,
               lower(trim(coalesce(payer_name, '')))
      having count(*) > 1
  loop
    update public.other_incomes
       set deleted_at = now()
     where id = any((v_g.ids)[2:])
       and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'other_incomes dedup (fuzzy by payer) soft-deleted: %', v_total;
end$$;

-- ─── 4) scheduled_payments: по (salon, external_id, source) ────────────────
do $$
declare
  v_g record;
  v_total int := 0;
  v_iter int;
begin
  for v_g in
    select salon_id, source, external_id, array_agg(id order by created_at asc) as ids
      from public.scheduled_payments
      where external_id is not null
      group by salon_id, source, external_id
      having count(*) > 1
  loop
    delete from public.scheduled_payments
     where id = any((v_g.ids)[2:]);
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'scheduled_payments dedup deleted: %', v_total;
end$$;
