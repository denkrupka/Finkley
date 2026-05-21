-- =============================================================================
-- 20260521000012_payouts_tips.sql
-- =============================================================================
-- Расширяем calculate_payouts_for_period колонкой tips_cents.
-- Юзер хочет видеть в /payouts сколько чаевых отдать каждому мастеру отдельно
-- (чаевые передаются мастеру 100%, не идут в commission).
--
-- DROP перед CREATE — иначе Postgres 42P13 «cannot change return type of
-- existing function» (расширяем return table колонкой tips_cents).
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
  )
  select sr.staff_id,
         sr.full_name,
         sr.payout_scheme,
         sr.visit_count,
         sr.revenue_cents,
         sr.tips_cents,
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
   order by sr.full_name;
$$;

grant execute on function public.calculate_payouts_for_period(uuid, date, date) to authenticated;
