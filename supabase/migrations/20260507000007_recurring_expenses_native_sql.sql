-- =============================================================================
-- 20260507000007_recurring_expenses_native_sql.sql
-- =============================================================================
-- Переписываем логику process-recurring-expenses из edge-function в
-- чистый SQL и зовём её из cron напрямую. Это убирает зависимость от
-- FUNCTION_INTERNAL_SECRET, который надо было класть в Vault руками
-- (см. предыдущую миграцию 20260507000004 + MORNING_TODO).
--
-- Edge-function /process-recurring-expenses оставляем — её можно дёргать
-- вручную для тестов/отладки, но cron теперь её не использует.
-- =============================================================================

-- Сама логика повторяющихся расходов: ровно те же шаги что были в TS-функции.
-- security definer → бежит от owner (postgres) и обходит RLS, что нужно для
-- межсалонной обработки cron-таска (без auth.uid()).
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
           recurrence, next_occurrence_at
      from public.expenses
     where recurrence <> 'none'
       and next_occurrence_at <= current_date
       and deleted_at is null
     order by next_occurrence_at
     limit 500
  loop
    v_processed := v_processed + 1;

    -- 1) Создаём новый instance расхода датой = next_occurrence_at
    begin
      insert into public.expenses (
        salon_id, category_id, amount_cents, payment_method, comment,
        expense_at, recurrence, recurrence_parent_id, source
      )
      values (
        r.salon_id, r.category_id, r.amount_cents, r.payment_method, r.comment,
        r.next_occurrence_at, 'none', r.id, 'recurring'
      );
      v_created := v_created + 1;
    exception when others then
      raise warning 'process_recurring_expenses: insert failed for parent=%, sqlstate=%, msg=%',
        r.id, sqlstate, sqlerrm;
      continue;
    end;

    -- 2) Двигаем родительский next_occurrence_at вперёд на 1 период
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

-- Только postgres (owner) может звать через security definer, но имеет смысл
-- разрешить и authenticated для отладки через RPC из админ-кабинета.
revoke all on function public.process_recurring_expenses() from public;
grant execute on function public.process_recurring_expenses() to authenticated, service_role;

-- =============================================================================
-- Перепланируем cron: снимаем старый HTTP-вариант и ставим SQL-вызов
-- =============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-recurring-expenses') then
    perform cron.unschedule('process-recurring-expenses');
  end if;
end$$;

select cron.schedule(
  'process-recurring-expenses',
  '0 3 * * *',
  $$ select public.process_recurring_expenses(); $$
);
