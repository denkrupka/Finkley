-- =============================================================================
-- 20260528100000_payroll_premium.sql
-- =============================================================================
-- T116 — премия мастеру.
--
-- Владелец просит при создании ЗП-расхода уметь указать «Премия» отдельной
-- суммой, и видеть её в отчёте /payouts отдельной колонкой между «Чаевые»
-- и «Начислено».
--
-- Решение:
--   1. expenses.premium_cents — bigint NOT NULL DEFAULT 0. Заполняется только
--      когда категория is_payroll = true и юзер ввёл премию. Хранится отдельно
--      от amount_cents — amount = базовый payout, premium = бонус.
--   2. RPC calculate_payouts_for_period возвращает дополнительно premium_cents
--      = сумма expenses.premium_cents за период по мастеру (только paid).
--
-- Schema change:
--   - +1 колонка expenses.premium_cents
--   - DROP + CREATE функции (нельзя ALTER return type)
-- =============================================================================

alter table public.expenses
  add column if not exists premium_cents bigint not null default 0;

comment on column public.expenses.premium_cents is
  'T116 — премия мастеру сверх базового payout. Заполняется только при is_payroll=true. amount_cents — базовый payout, premium_cents — бонус сверху.';

create index if not exists idx_expenses_premium_payroll
  on public.expenses(payroll_staff_id, payroll_period_start)
  where payroll_staff_id is not null and premium_cents > 0;

-- =============================================================================
-- RPC calculate_payouts_for_period: + premium_cents колонка.
-- =============================================================================

drop function if exists public.calculate_payouts_for_period(uuid, date, date);

create or replace function public.calculate_payouts_for_period(
  p_salon_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  staff_id uuid,
  full_name text,
  payout_scheme staff_payout_scheme,
  visit_count bigint,
  revenue_cents bigint,
  tips_cents bigint,
  premium_cents bigint,
  payout_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with staff_revenue as (
    select s.id                       as staff_id,
           s.full_name,
           s.payout_scheme,
           s.payout_percent,
           s.payout_fixed_cents,
           s.chair_rent_cents,
           coalesce(
             sum(v.amount_cents + v.tip_cents - v.discount_cents),
             0
           )::bigint                  as revenue_cents,
           coalesce(sum(v.tip_cents), 0)::bigint as tips_cents,
           count(v.id)::bigint        as visit_count
      from staff s
      left join visits v
        on v.staff_id = s.id
       and v.salon_id = s.salon_id
       and v.status   = 'paid'
       and v.deleted_at is null
       and v.visit_at >= p_period_start::timestamptz
       and v.visit_at <  (p_period_end::date + 1)::timestamptz
     where s.salon_id = p_salon_id
       and s.deleted_at is null
       and s.is_active = true
     group by s.id
  ),
  service_overrides as (
    select v.staff_id,
           coalesce(
             sum(((v.amount_cents + v.tip_cents - v.discount_cents) * o.payout_percent)::bigint / 100),
             0
           )::bigint as override_payout
      from visits v
      join staff_service_overrides o
        on o.staff_id   = v.staff_id
       and o.service_id = v.service_id
      join staff s on s.id = v.staff_id
     where v.salon_id = p_salon_id
       and s.payout_scheme = 'percent_service'
       and v.status = 'paid'
       and v.deleted_at is null
       and v.visit_at >= p_period_start::timestamptz
       and v.visit_at <  (p_period_end::date + 1)::timestamptz
     group by v.staff_id
  ),
  staff_premium as (
    -- Сумма premium_cents из expenses (ЗП-расходы) по мастеру за период.
    -- Окно периода expense пересекается с p_period_start..p_period_end:
    -- payroll_period_end >= p_period_start AND payroll_period_start <= p_period_end.
    select e.payroll_staff_id as staff_id,
           coalesce(sum(e.premium_cents), 0)::bigint as premium_cents
      from expenses e
     where e.salon_id = p_salon_id
       and e.payroll_staff_id is not null
       and e.deleted_at is null
       and e.premium_cents > 0
       and coalesce(e.payroll_period_end, e.payroll_period_start)   >= p_period_start
       and coalesce(e.payroll_period_start, e.payroll_period_end)   <= p_period_end
     group by e.payroll_staff_id
  )
  select sr.staff_id,
         sr.full_name,
         sr.payout_scheme,
         sr.visit_count,
         sr.revenue_cents,
         sr.tips_cents,
         coalesce(sp.premium_cents, 0)::bigint as premium_cents,
         (case sr.payout_scheme
            when 'fixed'           then coalesce(sr.payout_fixed_cents, 0)
            when 'percent_revenue' then (sr.revenue_cents * coalesce(sr.payout_percent, 0))::bigint / 100
            when 'percent_service' then coalesce(so.override_payout, 0)
            when 'chair_rent'      then -coalesce(sr.chair_rent_cents, 0)
            when 'mixed'           then coalesce(sr.payout_fixed_cents, 0)
                                         + (sr.revenue_cents * coalesce(sr.payout_percent, 0))::bigint / 100
          end)::bigint as payout_cents
    from staff_revenue sr
    left join service_overrides so on so.staff_id = sr.staff_id
    left join staff_premium sp     on sp.staff_id = sr.staff_id
   order by sr.full_name;
$$;

grant execute on function public.calculate_payouts_for_period(uuid, date, date) to authenticated;
