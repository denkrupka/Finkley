-- =============================================================================
-- 20260508000016_service_cost_and_margin.sql
-- =============================================================================
-- TASK-23 (доделка): маржа по услугам.
--
-- Добавляем `services.cost_cents` (себестоимость одной оказанной услуги в
-- центах). Nullable — старые услуги без указанной себестоимости считаются
-- «неразмеченными», маржа для них в RPC возвращается NULL.
--
-- Расширяем RPC top_services_by_revenue:
--   + cost_cents — total cost = unit_cost × visits_count
--   + margin_cents — revenue − cost (NULL если cost не задан)
--   + margin_pct — margin / revenue × 100 (NULL если cost не задан или
--     revenue = 0)
-- =============================================================================

alter table public.services
  add column if not exists cost_cents bigint;

-- В предыдущей версии функция возвращала меньше колонок (без cost/margin).
-- Postgres не позволяет менять return type через CREATE OR REPLACE — нужно
-- дропнуть старую сигнатуру первой. CASCADE на случай, если на неё навешано
-- что-то ещё (grant'ы, view'ы — на момент миграции — ничего, но safe).
drop function if exists public.top_services_by_revenue(uuid, timestamptz, timestamptz, int);

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
  visits_count bigint,
  cost_cents bigint,
  margin_cents bigint,
  margin_pct numeric
)
language sql stable as $$
  with agg as (
    select
      coalesce(s.id, '00000000-0000-0000-0000-000000000000'::uuid) as service_id,
      coalesce(s.name, v.service_name_snapshot, '— Без услуги') as service_name,
      coalesce(sum(v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)), 0) as revenue_cents,
      count(*) as visits_count,
      -- s.cost_cents может быть NULL — тогда сумма произведений всё равно
      -- даст NULL, что для нас и означает «маржа неизвестна».
      sum(s.cost_cents) as cost_cents
    from visits v
    left join services s on s.id = v.service_id
    where v.salon_id = p_salon_id
      and v.visit_at >= p_period_start
      and v.visit_at < p_period_end
      and v.status = 'paid'
      and v.deleted_at is null
    group by coalesce(s.id, '00000000-0000-0000-0000-000000000000'::uuid),
             coalesce(s.name, v.service_name_snapshot, '— Без услуги')
  )
  select
    a.service_id,
    a.service_name,
    a.revenue_cents,
    a.visits_count,
    a.cost_cents,
    case when a.cost_cents is null then null else a.revenue_cents - a.cost_cents end as margin_cents,
    case
      when a.cost_cents is null or a.revenue_cents = 0 then null
      else round(((a.revenue_cents - a.cost_cents)::numeric / a.revenue_cents) * 100, 1)
    end as margin_pct
  from agg a
  order by a.revenue_cents desc
  limit p_limit;
$$;
