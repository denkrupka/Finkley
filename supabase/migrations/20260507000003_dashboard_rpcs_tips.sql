-- =============================================================================
-- 20260507000003_dashboard_rpcs_tips.sql
-- =============================================================================
-- TASK-24: учитываем tip_cents и discount_cents в выручке.
-- revenue_cents = sum(amount_cents - discount_cents + tip_cents)
--
-- Объяснение: скидка делает фактический приход меньше; чаевые увеличивают
-- (даже если уйдут мастеру — это всё равно деньги, которые «прошли через кассу»
-- и считаются в обороте; распределение в payout схемах — TASK-21/22).
-- =============================================================================

create or replace function public.dashboard_kpis(
  p_salon_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns table (
  revenue_cents bigint,
  expense_cents bigint,
  profit_cents bigint,
  visits_count bigint
)
language sql stable as $$
  with rev as (
    select coalesce(sum(amount_cents - coalesce(discount_cents, 0) + coalesce(tip_cents, 0)), 0) as v
    from visits
    where salon_id = p_salon_id
      and visit_at >= p_period_start
      and visit_at < p_period_end
      and status = 'paid'
      and deleted_at is null
  ), exp as (
    select coalesce(sum(amount_cents), 0) as v
    from expenses
    where salon_id = p_salon_id
      and expense_at >= p_period_start::date
      and expense_at < p_period_end::date
      and deleted_at is null
  ), cnt as (
    select count(*) as v
    from visits
    where salon_id = p_salon_id
      and visit_at >= p_period_start
      and visit_at < p_period_end
      and deleted_at is null
  )
  select rev.v, exp.v, rev.v - exp.v, cnt.v from rev, exp, cnt;
$$;

create or replace function public.top_staff_by_revenue(
  p_salon_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_limit int default 3
)
returns table (
  staff_id uuid,
  full_name text,
  revenue_cents bigint
)
language sql stable as $$
  select
    s.id,
    s.full_name,
    coalesce(sum(v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)), 0) as revenue_cents
  from staff s
  left join visits v on v.staff_id = s.id
    and v.visit_at >= p_period_start
    and v.visit_at < p_period_end
    and v.status = 'paid'
    and v.deleted_at is null
  where s.salon_id = p_salon_id
    and s.is_active = true
  group by s.id, s.full_name
  order by revenue_cents desc
  limit p_limit;
$$;

create or replace function public.top_services_by_revenue(
  p_salon_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_limit int default 3
)
returns table (
  service_id uuid,
  service_name text,
  revenue_cents bigint,
  visits_count bigint
)
language sql stable as $$
  select
    coalesce(s.id, '00000000-0000-0000-0000-000000000000'::uuid) as service_id,
    coalesce(s.name, v.service_name_snapshot, '— Без услуги') as service_name,
    coalesce(sum(v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)), 0) as revenue_cents,
    count(*) as visits_count
  from visits v
  left join services s on s.id = v.service_id
  where v.salon_id = p_salon_id
    and v.visit_at >= p_period_start
    and v.visit_at < p_period_end
    and v.status = 'paid'
    and v.deleted_at is null
  group by coalesce(s.id, '00000000-0000-0000-0000-000000000000'::uuid),
           coalesce(s.name, v.service_name_snapshot, '— Без услуги')
  order by revenue_cents desc
  limit p_limit;
$$;

create or replace function public.revenue_by_day(
  p_salon_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_timezone text default 'Europe/Warsaw'
)
returns table (
  day date,
  revenue_cents bigint,
  visits_count bigint
)
language sql stable as $$
  select
    (visit_at at time zone p_timezone)::date as day,
    coalesce(sum(amount_cents - coalesce(discount_cents, 0) + coalesce(tip_cents, 0)), 0) as revenue_cents,
    count(*) as visits_count
  from visits
  where salon_id = p_salon_id
    and visit_at >= p_period_start
    and visit_at < p_period_end
    and status = 'paid'
    and deleted_at is null
  group by day
  order by day;
$$;
