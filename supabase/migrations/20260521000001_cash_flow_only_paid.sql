-- =============================================================================
-- 20260521000001_cash_flow_only_paid.sql
-- =============================================================================
-- ДДС должен показывать ТОЛЬКО фактические потоки денег. Раньше визиты
-- учитывались независимо от статуса (paid/pending), что давало ложную
-- картину «деньги есть, на самом деле не пришли».
--
-- Меняем фильтр: v.status = 'paid' (вместо v.status <> 'cancelled').
-- Pending визиты не попадают в приход — попадут когда юзер их «Рассчитает».
-- Расходы остаются как есть: таблица expenses содержит только фактически
-- оплаченные траты (запланированные живут в scheduled_payments отдельно).
-- =============================================================================

create or replace function public.cash_flow_daily(
  p_salon_id uuid,
  p_from date,
  p_to date
) returns table (
  day date,
  inflow_cents bigint,
  outflow_cents bigint,
  net_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with tz as (
    select coalesce(s.timezone, 'Europe/Warsaw') as tz
    from public.salons s
    where s.id = p_salon_id
  ),
  visit_flows as (
    select
      (v.visit_at at time zone (select tz from tz))::date as day,
      sum(
        coalesce(v.amount_cents, 0)
        - coalesce(v.discount_cents, 0)
        + coalesce(v.tip_cents, 0)
      )::bigint as amt
    from public.visits v
    where v.salon_id = p_salon_id
      and v.deleted_at is null
      and v.status = 'paid'
      and (v.visit_at at time zone (select tz from tz))::date between p_from and p_to
    group by 1
  ),
  other_in_flows as (
    select income_at as day, sum(amount_cents)::bigint as amt
    from public.other_incomes
    where salon_id = p_salon_id
      and deleted_at is null
      and income_at between p_from and p_to
    group by 1
  ),
  expense_flows as (
    select expense_at as day, sum(amount_cents)::bigint as amt
    from public.expenses
    where salon_id = p_salon_id
      and deleted_at is null
      and expense_at between p_from and p_to
    group by 1
  ),
  all_days as (
    select generate_series(p_from, p_to, '1 day'::interval)::date as day
  )
  select
    d.day,
    (coalesce(vf.amt, 0) + coalesce(oi.amt, 0))::bigint as inflow_cents,
    coalesce(ef.amt, 0)::bigint as outflow_cents,
    (coalesce(vf.amt, 0) + coalesce(oi.amt, 0) - coalesce(ef.amt, 0))::bigint as net_cents
  from all_days d
  left join visit_flows vf on vf.day = d.day
  left join other_in_flows oi on oi.day = d.day
  left join expense_flows ef on ef.day = d.day
  order by d.day;
$$;

revoke all on function public.cash_flow_daily(uuid, date, date) from public;
grant execute on function public.cash_flow_daily(uuid, date, date) to authenticated;
