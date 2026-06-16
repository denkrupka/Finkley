-- =============================================================================
-- 20260616000002_client_stats_paid_only.sql
-- =============================================================================
-- Bug (владелец 16.06): у клиента уже посчитан LTV и визит, хотя визит ещё
-- «ожидает оплаты» (status='pending'). LTV / выручка / счётчик визитов должны
-- считаться ТОЛЬКО по оплаченным визитам (status='paid').
--
-- Раньше (20260515000015) мы сознательно считали visit_count и
-- total_revenue_cents по ВСЕМ визитам — теперь это меняем: они считаются
-- только по оплаченным. last_visit_at оставляем как «последний прошедший
-- не-отменённый» (поведение не меняем — это про «когда последний раз был»,
-- а не про деньги).
--
-- Дополнительно чиним две скрытые проблемы старого триггера:
--   1. Он висел только на INSERT/DELETE — смена статуса pending→paid (UPDATE)
--      не пересчитывала агрегаты вообще. Теперь триггер ещё и на UPDATE.
--   2. Инкрементальная арифметика (+1/−amount) расходилась с реальностью при
--      смене статуса/суммы/клиента. Теперь пересчитываем агрегаты клиента
--      из БД «с нуля» — это надёжно и просто (у клиента десятки визитов).
-- =============================================================================

-- Пересчёт агрегатов одного клиента из его визитов.
create or replace function public.recalc_client_stats_one(p_client_id uuid)
returns void
language plpgsql
as $$
begin
  if p_client_id is null then
    return;
  end if;
  update public.clients c set
    visit_count = coalesce(agg.cnt, 0),
    total_revenue_cents = coalesce(agg.rev, 0),
    last_visit_at = agg.last_at
  from (
    select
      count(*) filter (where status = 'paid')::int as cnt,
      coalesce(sum(amount_cents) filter (where status = 'paid'), 0)::bigint as rev,
      max(visit_at) filter (where visit_at <= now() and status <> 'cancelled') as last_at
    from public.visits
    where client_id = p_client_id
      and deleted_at is null
  ) agg
  where c.id = p_client_id;
end;
$$;

-- Триггерная обёртка: пересчитываем затронутого клиента (и старого, если у
-- визита сменился client_id).
create or replace function public.recalc_client_stats()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalc_client_stats_one(new.client_id);
  elsif tg_op = 'DELETE' then
    perform public.recalc_client_stats_one(old.client_id);
  elsif tg_op = 'UPDATE' then
    perform public.recalc_client_stats_one(new.client_id);
    if new.client_id is distinct from old.client_id then
      perform public.recalc_client_stats_one(old.client_id);
    end if;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_visits_client_stats on public.visits;
create trigger trg_visits_client_stats
  after insert or update or delete on public.visits
  for each row execute procedure public.recalc_client_stats();

-- Backfill: пересчёт visit_count и total_revenue_cents по оплаченным визитам
-- для всех существующих клиентов.
update public.clients c set
  visit_count = coalesce(agg.cnt, 0),
  total_revenue_cents = coalesce(agg.rev, 0)
from (
  select
    client_id,
    count(*) filter (where status = 'paid')::int as cnt,
    coalesce(sum(amount_cents) filter (where status = 'paid'), 0)::bigint as rev
  from public.visits
  where client_id is not null
    and deleted_at is null
  group by client_id
) agg
where c.id = agg.client_id;

-- Клиенты без единого оплаченного визита — обнуляем (на случай, если раньше
-- им насчитали по неоплаченным).
update public.clients c set
  visit_count = 0,
  total_revenue_cents = 0
where not exists (
  select 1 from public.visits v
  where v.client_id = c.id
    and v.status = 'paid'
    and v.deleted_at is null
);

-- client_ltv_metrics: тоже считаем только оплаченные визиты (раньше было
-- status <> 'cancelled' — включало pending).
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
      and v.status = 'paid'
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

comment on function public.client_ltv_metrics(uuid) is
  'Per-client LTV: revenue, gross (с вычетом services.cost_cents), visits, lifetime months. Считаются ТОЛЬКО оплаченные визиты (status=paid). Используется в /reports → клиенты → Список.';
