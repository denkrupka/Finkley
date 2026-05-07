-- =============================================================================
-- 20260507000006_analytics_rpcs.sql
-- =============================================================================
-- TASK-23: дополнительные аналитические RPC для страницы Отчёты.
--
-- Все RPC — security invoker + stable, RLS на visits/expenses/staff фильтрует
-- по salon_id юзера автоматически. Считаем revenue по той же формуле, что в
-- dashboard: amount - discount + tip (см. 20260507000003_dashboard_rpcs_tips).
-- =============================================================================

-- Выручка по способу оплаты
create or replace function public.analytics_revenue_by_payment(
  p_salon_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns table (
  payment_method payment_method,
  visits_count bigint,
  revenue_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select v.payment_method,
         count(*)::bigint                                                       as visits_count,
         coalesce(sum(v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)), 0)::bigint as revenue_cents
    from visits v
   where v.salon_id = p_salon_id
     and v.visit_at >= p_period_start
     and v.visit_at <  p_period_end
     and v.status = 'paid'
     and v.deleted_at is null
   group by v.payment_method
   order by revenue_cents desc;
$$;

grant execute on function public.analytics_revenue_by_payment(uuid, timestamptz, timestamptz) to authenticated;

-- Heatmap загрузки: день недели × час
-- dow: 0=воскресенье ... 6=суббота (Postgres extract dow стандарт)
-- hour: 0..23
create or replace function public.analytics_visits_heatmap(
  p_salon_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_timezone text default 'Europe/Warsaw'
)
returns table (
  dow int,
  hour_of_day int,
  visits_count bigint,
  revenue_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select extract(dow from (visit_at at time zone p_timezone))::int                         as dow,
         extract(hour from (visit_at at time zone p_timezone))::int                        as hour_of_day,
         count(*)::bigint                                                                  as visits_count,
         coalesce(sum(amount_cents - coalesce(discount_cents, 0) + coalesce(tip_cents, 0)), 0)::bigint as revenue_cents
    from visits
   where salon_id = p_salon_id
     and visit_at >= p_period_start
     and visit_at <  p_period_end
     and status = 'paid'
     and deleted_at is null
   group by dow, hour_of_day
   order by dow, hour_of_day;
$$;

grant execute on function public.analytics_visits_heatmap(uuid, timestamptz, timestamptz, text) to authenticated;
