-- =============================================================================
-- One-shot cross-account dedup для bank_transactions.
--
-- Owner-feedback 05.06: при переподключении банка через Enable Banking
-- создаётся НОВЫЙ bank_accounts.id (даже если IBAN тот же). Все старые
-- транзакции импортируются второй раз → видны как дубли в UI:
--   02.05 RYANAIR DUBLIN -16.31 (x2)  ← account A (25.05) + account B (02.06)
--   02.05 RYANAIR DUBLIN -89.16 (x2)
--   и т.д.
--
-- Миграция 20260604000004 группировала по (account_id, date, amount, key) —
-- НЕ ловила cross-account дубли. Эта группирует по salon_id (через
-- bank_accounts → bank_connections → salon_id), date, amount_cents, type,
-- normalized counterparty/description.
--
-- Canonical = строка с привязкой (expense_id / linked_visit_id /
-- linked_other_income_id) или старейшая created_at. Удаляем только
-- НЕ-привязанные дубли — legitimate-linked twin не трогаем.
-- =============================================================================

do $$
declare
  v_g record;
  v_total int := 0;
  v_iter int;
  v_groups int := 0;
begin
  for v_g in
    with txs as (
      select
        bt.id,
        bt.executed_at::date as dt,
        bt.amount_cents,
        bt.type,
        lower(trim(coalesce(bt.counterparty, bt.description, ''))) as k,
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
      where k <> ''
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
    v_groups := v_groups + 1;
  end loop;

  raise notice 'cross-account bank_transactions dedup: % groups, % rows deleted',
    v_groups, v_total;
end$$;
