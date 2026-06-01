-- process_recurring_expenses(): копировать VAT-поля при генерации
--
-- Раньше функция копировала только amount_cents/category_id/payment_method/
-- comment. Для VAT-плательщиков каждый сгенерированный expense (аренда,
-- бухгалтерия и т.п.) появлялся с amount_net_cents=NULL/vat_rate_pct=NULL —
-- P&L через vatBreakdownFor получал fallback на брутто-как-нетто и vat=0.
-- Recurring аренда 1230 PLN не давала VAT-вычета.
--
-- Здесь добавляем три поля в SELECT и INSERT. Без изменения сигнатуры
-- (returns processed/created) — replace function в-line.

create or replace function public.process_recurring_expenses()
returns table (processed int, created int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_next_date date;
  v_processed int := 0;
  v_created int := 0;
begin
  for r in
    select id, salon_id, category_id, amount_cents, payment_method, comment,
           recurrence, next_occurrence_at,
           amount_net_cents, vat_rate_pct
      from public.expenses
     where recurrence <> 'none'
       and next_occurrence_at <= current_date
       and deleted_at is null
     order by next_occurrence_at
     limit 500
  loop
    v_processed := v_processed + 1;

    begin
      insert into public.expenses (
        salon_id, category_id, amount_cents, payment_method, comment,
        expense_at, recurrence, recurrence_parent_id, source,
        amount_net_cents, vat_rate_pct
      )
      values (
        r.salon_id, r.category_id, r.amount_cents, r.payment_method, r.comment,
        r.next_occurrence_at, 'none', r.id, 'recurring',
        r.amount_net_cents, r.vat_rate_pct
      );
      v_created := v_created + 1;
    exception when others then
      raise warning 'process_recurring_expenses: insert failed for parent=%, sqlstate=%, msg=%',
        r.id, sqlstate, sqlerrm;
      continue;
    end;

    v_next_date := case r.recurrence
      when 'weekly'  then (r.next_occurrence_at + interval '7 days')::date
      when 'monthly' then (r.next_occurrence_at + interval '1 month')::date
    end;

    update public.expenses
       set next_occurrence_at = v_next_date
     where id = r.id;
  end loop;

  return query select v_processed, v_created;
end;
$$;

revoke all on function public.process_recurring_expenses() from public;
grant execute on function public.process_recurring_expenses() to authenticated, service_role;
