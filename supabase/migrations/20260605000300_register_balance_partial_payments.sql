-- ============================================================================
-- Bug 272a7e19 (Den 05.06): «Наличные» на дашборде показывают отрицательный
-- баланс (-818.37 PLN), хотя физически касса не уходила в минус. Причина —
-- compute_register_balance считает расходы как sum(amount_cents), игнорируя
-- частичные оплаты (visits.paid_amount_cents / expenses.paid_amount_cents).
-- Когда у юзера много расходов «оплачено частично» из cash-кассы, формула
-- вычитает полный amount_cents вместо реально оплаченной части, и баланс
-- уходит в минус.
--
-- Фикс: переписываем compute_register_balance чтобы использовать coalesce
-- (paid_amount_cents, full_revenue/full_amount) — то есть учитываем только
-- реально оплаченные суммы. Тоже самое для других кассовых компонентов.
--
-- compute_all_register_balances обёртка автоматически подцепит фикс через
-- обновлённую compute_register_balance — её не трогаем.
-- ============================================================================

drop function if exists public.compute_register_balance(uuid, text, timestamptz);

create or replace function public.compute_register_balance(
  p_salon_id uuid,
  p_register_id text,
  p_at timestamptz default now()
)
returns bigint
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_visits bigint;
  v_other bigint;
  v_in bigint;
  v_expenses bigint;
  v_payouts bigint;
  v_out bigint;
begin
  -- Визиты: paid_amount_cents = NULL → полностью оплачено (full revenue);
  -- иначе → ровно paid_amount_cents (частично). Cap'нем full_revenue чтобы
  -- discount/tip учитывались как и раньше.
  select coalesce(sum(
           coalesce(
             v.paid_amount_cents,
             v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)
           )
         ), 0)
    into v_visits
    from public.visits v
    where v.salon_id = p_salon_id
      and v.cash_register_id = p_register_id
      and v.status = 'paid'
      and v.deleted_at is null
      and v.visit_at <= p_at;

  -- Прочие доходы — та же логика.
  select coalesce(sum(coalesce(o.paid_amount_cents, o.amount_cents)), 0)
    into v_other
    from public.other_incomes o
    where o.salon_id = p_salon_id
      and o.cash_register_id = p_register_id
      and o.deleted_at is null
      and o.income_at <= p_at::date;

  -- Переводы между кассами — приходы.
  select coalesce(sum(amount_cents), 0)
    into v_in
    from public.cash_transfers
    where salon_id = p_salon_id
      and to_register_id = p_register_id
      and deleted_at is null
      and transferred_at <= p_at;

  -- Расходы: использовать paid_amount_cents (сколько реально оплачено
  -- из этой кассы), иначе amount_cents. Главная причина бага 272a7e19.
  select coalesce(sum(coalesce(e.paid_amount_cents, e.amount_cents)), 0)
    into v_expenses
    from public.expenses e
    where e.salon_id = p_salon_id
      and e.cash_register_id = p_register_id
      and e.deleted_at is null
      and e.expense_at <= p_at::date;

  -- Выплаты мастерам — пока без частичной оплаты, считаем full payout.
  select coalesce(sum(net_payout_cents), 0)
    into v_payouts
    from public.payouts
    where salon_id = p_salon_id
      and cash_register_id = p_register_id
      and status = 'paid';

  -- Переводы между кассами — расходы.
  select coalesce(sum(amount_cents), 0)
    into v_out
    from public.cash_transfers
    where salon_id = p_salon_id
      and from_register_id = p_register_id
      and deleted_at is null
      and transferred_at <= p_at;

  return v_visits + v_other + v_in - v_expenses - v_payouts - v_out;
end;
$$;

revoke all on function public.compute_register_balance(uuid, text, timestamptz) from public;
grant execute on function public.compute_register_balance(uuid, text, timestamptz) to authenticated;

comment on function public.compute_register_balance(uuid, text, timestamptz) is
  'Bug 272a7e19: использует coalesce(paid_amount_cents, full_amount) для visits/other_incomes/expenses — частичные оплаты больше не уводят баланс в минус.';
