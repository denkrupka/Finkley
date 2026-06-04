-- =============================================================================
-- One-shot cleanup существующих дублей в bank_transactions.
-- Owner-feedback 04.06 15:30: после fuzzy dedup в banking-sync новые tx
-- больше не дублируются, но уже накопленные в БД дубли (RYANAIR DUBLIN,
-- OLEKSANDR LAVRENIUK, MAXMASTER, KRUPKA DENYS — каждая по 2-3 раза на
-- одну реальную транзакцию) остались. Owner попросил чтобы я почистил
-- их сам через миграцию.
--
-- Правило дубля (то же что в banking-sync isFuzzyDup):
--   (account_id, executed_at::date, amount_cents,
--    lower(coalesce(counterparty, description, ''))::text первые 20 символов)
-- В каждой группе оставляем canonical = запись с привязкой
-- (expense_id / linked_visit_id / linked_other_income_id / bank_tx_splits)
-- ИЛИ самую раннюю по created_at если привязок ни у кого нет.
-- Удаляем только НЕ-привязанные дубли — не дёргаем legitimate-linked tx.
-- =============================================================================

do $$
declare
  v_group   record;
  v_to_delete uuid[];
  v_deleted_in_iter int;
  v_total_deleted int := 0;
  v_groups_processed int := 0;
begin
  for v_group in
    with grouped as (
      select
        bt.id,
        bt.account_id,
        bt.executed_at::date as dt,
        bt.amount_cents,
        substring(lower(coalesce(bt.counterparty, bt.description, '')), 1, 20) as key_text,
        bt.created_at,
        bt.expense_id,
        bt.linked_visit_id,
        bt.linked_other_income_id,
        exists (
          select 1 from public.bank_tx_splits s where s.bank_transaction_id = bt.id
        ) as has_split
      from public.bank_transactions bt
    )
    select
      account_id, dt, amount_cents, key_text,
      array_agg(id order by
        -- Привязанные первыми (canonical), потом по created_at
        case when expense_id is not null
              or linked_visit_id is not null
              or linked_other_income_id is not null
              or has_split then 0 else 1 end,
        created_at asc
      ) as ids
    from grouped
    where key_text != ''
    group by account_id, dt, amount_cents, key_text
    having count(*) > 1
  loop
    -- canonical = ids[1]; кандидаты на удаление = ids[2..]
    v_to_delete := v_group.ids[2:];

    -- Удаляем только не-привязанные. Если у одного из «дублей» есть
    -- собственная привязка — оставляем (legitimate twin).
    delete from public.bank_transactions
     where id = any(v_to_delete)
       and expense_id is null
       and linked_visit_id is null
       and linked_other_income_id is null
       and not exists (
         select 1 from public.bank_tx_splits s where s.bank_transaction_id = bank_transactions.id
       );

    get diagnostics v_deleted_in_iter = row_count;
    v_total_deleted := v_total_deleted + v_deleted_in_iter;
    v_groups_processed := v_groups_processed + 1;
  end loop;

  raise notice 'bank_transactions dedup: % groups, % rows deleted',
    v_groups_processed, v_total_deleted;
end$$;
