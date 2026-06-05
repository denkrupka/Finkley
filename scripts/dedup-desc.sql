-- Dedup bank_transactions по (salon, date, amount, type, normalized description)
-- БЕЗ counterparty — потому что Enable Banking при переподключении присылает
-- counterparty в разной форме (POSIR vs POSIR PLYWALNIA RATAJE), а
-- description обычно стабилен.
do $$
declare
  v_g record;
  v_total int := 0;
  v_iter int;
begin
  for v_g in
    with txs as (
      select
        bt.id, bt.executed_at::date as dt, bt.amount_cents, bt.type,
        lower(trim(coalesce(bt.description, ''))) as d,
        bt.created_at, bt.expense_id, bt.linked_visit_id, bt.linked_other_income_id,
        bc.salon_id
      from public.bank_transactions bt
      join public.bank_accounts ba on ba.id = bt.account_id
      join public.bank_connections bc on bc.id = ba.connection_id
    )
    select
      salon_id, dt, amount_cents, type, d,
      array_agg(id order by
        case when expense_id is not null
              or linked_visit_id is not null
              or linked_other_income_id is not null then 0 else 1 end,
        created_at asc
      ) as ids
      from txs
      where d <> ''
      group by salon_id, dt, amount_cents, type, d
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
  raise notice 'bank_transactions dedup (by description) deleted: %', v_total;
end$$;
