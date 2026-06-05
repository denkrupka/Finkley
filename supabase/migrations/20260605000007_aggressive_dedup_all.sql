-- =============================================================================
-- One-shot AGGRESSIVE дедупликация всех бизнес-таблиц.
--
-- Owner-feedback 05.06 02:23: «удали все дубли за все время».
-- Применено вручную через Management API на проде; миграция повторяет
-- ту же логику для staging/clone.
--
-- Стратегия:
--   1) bank_transactions: dedup по (salon_id, date, amount, type,
--      lower(trim(description))). Counterparty намеренно НЕ в ключе —
--      Enable Banking присылает разные формы (POSIR vs POSIR PLYWALNIA
--      RATAJE) при переподключении. Description обычно стабилен.
--   2) expenses (auto_commission/auto_card_fee/auto_processing_fee):
--      catch-all dedup. Эти исторически создавались по 4 шт в один и
--      тот же момент (~миллисекунды разница) → явный баг auto-генерации
--      комиссий за визиты.
--   3) expenses (bank_import + KSeF + manual): dedup по (salon, date,
--      amount, contractor_name, document_number, source).
--   4) other_incomes: по (salon, date, amount, payer_name).
--   5) scheduled_payments: по (salon, source, external_id).
--
-- Canonical: запись с привязкой (expense_id/linked_visit_id/...) ИЛИ
-- самая ранняя created_at. payroll-сцепленные expenses не трогаем.
-- =============================================================================

-- 1) bank_transactions cross-account dedup by description
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    with txs as (
      select bt.id, bt.executed_at::date as dt, bt.amount_cents, bt.type,
             lower(trim(coalesce(bt.description, ''))) as d,
             bt.created_at, bt.expense_id, bt.linked_visit_id, bt.linked_other_income_id,
             bc.salon_id
      from public.bank_transactions bt
      join public.bank_accounts ba on ba.id = bt.account_id
      join public.bank_connections bc on bc.id = ba.connection_id
    )
    select array_agg(id order by
      case when expense_id is not null or linked_visit_id is not null
            or linked_other_income_id is not null then 0 else 1 end,
      created_at asc) as ids
    from txs where d <> ''
    group by salon_id, dt, amount_cents, type, d
    having count(*) > 1
  loop
    delete from public.bank_transactions
     where id = any((v_g.ids)[2:])
       and expense_id is null and linked_visit_id is null
       and linked_other_income_id is null
       and not exists (select 1 from public.bank_tx_splits s
                        where s.bank_transaction_id = bank_transactions.id);
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'bank_transactions dedup: %', v_total;
end$$;

-- 2) expenses catch-all dedup (включая auto_commission/bank_import/ksef)
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.expenses
    where deleted_at is null
    group by salon_id, expense_at, amount_cents,
             coalesce(lower(trim(contractor_name)), ''),
             coalesce(document_number, ''),
             coalesce(source, '')
    having count(*) > 1
  loop
    update public.expenses set deleted_at = now()
     where id = any((v_g.ids)[2:]) and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'expenses dedup: %', v_total;
end$$;

-- 3) other_incomes fuzzy dedup
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.other_incomes
    where deleted_at is null
      and lower(trim(coalesce(payer_name, ''))) <> ''
    group by salon_id, income_at, amount_cents,
             lower(trim(coalesce(payer_name, '')))
    having count(*) > 1
  loop
    update public.other_incomes set deleted_at = now()
     where id = any((v_g.ids)[2:]) and deleted_at is null;
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'other_incomes dedup: %', v_total;
end$$;

-- 4) scheduled_payments по (salon, source, external_id)
do $$
declare v_g record; v_total int := 0; v_iter int;
begin
  for v_g in
    select array_agg(id order by created_at asc) as ids
    from public.scheduled_payments
    where external_id is not null
    group by salon_id, source, external_id
    having count(*) > 1
  loop
    delete from public.scheduled_payments where id = any((v_g.ids)[2:]);
    get diagnostics v_iter = row_count;
    v_total := v_total + v_iter;
  end loop;
  raise notice 'scheduled_payments dedup: %', v_total;
end$$;
