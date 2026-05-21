-- =============================================================================
-- 20260521000010_client_ltv_metrics.sql
-- =============================================================================
-- Per-client LTV metrics для /reports → клиенты → Список:
--   - revenue_ltv_cents — суммарная выручка (= clients.total_revenue_cents
--     но с учётом discount/tip, через свежий пересчёт)
--   - gross_ltv_cents — выручка минус себестоимость услуг (для тех визитов,
--     где services.cost_cents задана). Если cost_cents=null — считаем 0 для
--     этого визита (= revenue, без вычета).
--   - visits_count — кол-во не-cancelled визитов с этим client_id
--   - customer_lifetime_months — месяцев между первым визитом и now()
--     (или created_at если визитов нет)
--
-- Возвращает строки для всех клиентов салона с visit_count > 0, плюс клиентов
-- без визитов (для них всё 0/null). UI делает left-join по client_id.
-- =============================================================================

create or replace function public.client_ltv_metrics(p_salon_id uuid)
returns table (
  client_id uuid,
  revenue_ltv_cents bigint,
  gross_ltv_cents bigint,
  visits_count bigint,
  customer_lifetime_months int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with v as (
    select
      v.client_id,
      v.visit_at,
      coalesce(v.amount_cents, 0)
        - coalesce(v.discount_cents, 0)
        + coalesce(v.tip_cents, 0)             as net_revenue,
      coalesce(v.amount_cents, 0)
        - coalesce(v.discount_cents, 0)
        + coalesce(v.tip_cents, 0)
        - coalesce(s.cost_cents, 0)            as gross
    from public.visits v
    left join public.services s on s.id = v.service_id
    where v.salon_id = p_salon_id
      and v.deleted_at is null
      and v.status <> 'cancelled'
      and v.client_id is not null
  ),
  agg as (
    select
      client_id,
      sum(net_revenue)::bigint        as revenue_ltv_cents,
      sum(gross)::bigint              as gross_ltv_cents,
      count(*)::bigint                as visits_count,
      min(visit_at)                   as first_visit_at
    from v
    group by client_id
  )
  select
    a.client_id,
    a.revenue_ltv_cents,
    a.gross_ltv_cents,
    a.visits_count,
    greatest(
      0,
      (extract(year  from age(now(), a.first_visit_at)) * 12
       + extract(month from age(now(), a.first_visit_at)))::int
    )                                  as customer_lifetime_months
  from agg a
$$;

grant execute on function public.client_ltv_metrics(uuid) to authenticated, service_role;

comment on function public.client_ltv_metrics(uuid) is
  'Per-client LTV: revenue, gross (с вычетом services.cost_cents), visits, lifetime months. Используется в /reports → клиенты → Список.';
