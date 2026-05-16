-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000010_close_payout_register.sql
--
-- Расширяем close_payout_period: добавляем опциональный параметр
-- p_cash_register_id text, чтобы при закрытии периода UI мог указать с
-- какой кассы выплачена зарплата. Заполняем cash_register_id в обеих
-- записях (payouts + auto-expense) — это нужно для корректных per-register
-- балансов в модалке «Перестановка средств» (ADR-014).
--
-- DROP+CREATE — сигнатура меняется (добавляется параметр), CREATE OR REPLACE
-- не сработает для смены сигнатуры. Default = null → старые вызовы клиента
-- продолжают работать без параметра.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.close_payout_period(uuid, date, date);

create or replace function public.close_payout_period(
  p_salon_id uuid,
  p_period_start date,
  p_period_end date,
  p_cash_register_id text default null
)
returns table (
  payouts_created int,
  total_expense_cents bigint
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r record;
  v_expense_id uuid;
  v_category_id uuid;
  v_total bigint := 0;
  v_count int := 0;
  v_period_label text;
begin
  if not exists (
    select 1 from salon_members
     where salon_id = p_salon_id and user_id = auth.uid()
  ) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_period_end >= current_date then
    raise exception 'period_not_finished' using errcode = '22023';
  end if;

  if exists (
    select 1 from payouts
     where salon_id = p_salon_id
       and period_start = p_period_start
       and period_end = p_period_end
       and status = 'paid'
  ) then
    raise exception 'period_already_closed' using errcode = '23505';
  end if;

  select id into v_category_id
    from expense_categories
   where salon_id = p_salon_id
     and is_system = true
     and name = 'Зарплаты'
   limit 1;

  if v_category_id is null then
    insert into expense_categories (salon_id, name, is_system, sort_order)
      values (p_salon_id, 'Зарплаты', true, 100)
      returning id into v_category_id;
  end if;

  v_period_label := to_char(p_period_start, 'DD.MM.YYYY') || ' — ' || to_char(p_period_end, 'DD.MM.YYYY');

  for r in
    select * from public.calculate_payouts_for_period(p_salon_id, p_period_start, p_period_end)
  loop
    v_expense_id := null;

    if r.payout_cents > 0 then
      insert into expenses (
        salon_id, category_id, expense_at, amount_cents,
        comment, source, created_by, cash_register_id
      )
      values (
        p_salon_id, v_category_id, p_period_end, r.payout_cents,
        'Зарплата: ' || r.full_name || ' (' || v_period_label || ')',
        'payout',
        auth.uid(),
        p_cash_register_id
      )
      returning id into v_expense_id;
      v_total := v_total + r.payout_cents;
    end if;

    insert into payouts (
      salon_id, staff_id, period_start, period_end,
      total_revenue_cents, total_payout_cents, net_payout_cents,
      status, paid_at, comment, cash_register_id
    ) values (
      p_salon_id, r.staff_id, p_period_start, p_period_end,
      r.revenue_cents, r.payout_cents, r.payout_cents,
      'paid', now(),
      case when v_expense_id is not null
           then 'expense_id=' || v_expense_id::text
           else null
      end,
      p_cash_register_id
    );

    v_count := v_count + 1;
  end loop;

  return query select v_count, v_total;
end;
$$;

grant execute on function public.close_payout_period(uuid, date, date, text) to authenticated;
