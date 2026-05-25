-- Триггер: при связи bank-tx с expense автоматически пересчитываем
-- expenses.paid_amount_cents = SUM(bank_transactions.amount_cents)
-- WHERE expense_id = X.
--
-- Если sum >= amount → paid_amount_cents = NULL (полностью оплачено).
-- Иначе                → paid_amount_cents = sum (частично оплачено).
--
-- Это покрывает кейс «фактура 5000 zł, пришли 2 банковских платежа
-- по 2000 и 3000»: первый перевод привяжется → paid=2000, второй
-- привяжется → paid=null (full paid). Manual paid_amount_cents (введённое
-- через чекбокс) будет перезаписано — для смешанных кейсов (часть налом,
-- часть переводом) юзер должен редактировать в форме после связи.

create or replace function public.recalc_expense_paid_from_bank()
returns void
language plpgsql
as $$
declare
  -- безопасный snapshot — каждый вызов в плотном цикле триггера должен
  -- видеть собственные текущие данные.
begin
  null; -- placeholder, реальная функция ниже принимает аргумент
end;
$$;

create or replace function public.recalc_expense_paid(p_expense_id uuid)
returns void
language plpgsql
as $$
declare
  v_sum bigint;
  v_amount bigint;
begin
  if p_expense_id is null then return; end if;
  select coalesce(sum(amount_cents), 0) into v_sum
    from public.bank_transactions
   where expense_id = p_expense_id;
  select amount_cents into v_amount
    from public.expenses
   where id = p_expense_id;
  if v_amount is null then return; end if;
  update public.expenses
     set paid_amount_cents = case
       when v_sum >= v_amount then null  -- полностью оплачено
       when v_sum = 0 then null          -- нет связанных tx → не трогаем (legacy)
       else v_sum
     end
   where id = p_expense_id;
end;
$$;

create or replace function public.bank_tx_after_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.expense_id is not null then
      perform public.recalc_expense_paid(new.expense_id);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.expense_id is distinct from new.expense_id then
      if old.expense_id is not null then
        perform public.recalc_expense_paid(old.expense_id);
      end if;
    end if;
    if new.expense_id is not null then
      perform public.recalc_expense_paid(new.expense_id);
    end if;
  elsif tg_op = 'DELETE' then
    if old.expense_id is not null then
      perform public.recalc_expense_paid(old.expense_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists tr_bank_tx_recalc_paid on public.bank_transactions;
create trigger tr_bank_tx_recalc_paid
after insert or update of expense_id, amount_cents
or delete
on public.bank_transactions
for each row execute function public.bank_tx_after_change();

comment on function public.recalc_expense_paid(uuid) is
  'Пересчёт paid_amount_cents для одного расхода на основе SUM(bank_transactions.amount_cents).';
