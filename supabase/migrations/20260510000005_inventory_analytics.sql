-- =============================================================================
-- 20260510000005_inventory_analytics.sql
-- =============================================================================
-- RPC для аналитики материалов:
--
-- 1) inventory_plan_vs_fact(p_salon_id, p_period_start, p_period_end)
--    Возвращает по каждому материалу:
--      - planned: visits.count × service_materials.quantity (ожидаемое
--        потребление по рецепту услуги для оплаченных не-retail визитов)
--      - actual:  sum(consumption transactions) за период (то что реально
--        списалось — может отличаться из-за ручных корректировок, retail,
--        изменений рецепта задним числом)
--      - variance: actual - planned (положительное = перерасход)
--      - variance_value_cents: cost_per_unit × variance — финансовая оценка
--
-- 2) inventory_consumption_by_staff(p_salon_id, p_period_start, p_period_end)
--    По каждому мастеру: сколько единиц каждого материала израсходовал
--    через свои визиты. Полезно чтобы найти кто переносит больше нормы
--    (например, мастер тратит 80мл краски вместо 60 по рецепту).
-- =============================================================================

create or replace function public.inventory_plan_vs_fact(
  p_salon_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns table (
  material_id uuid,
  material_name text,
  unit text,
  planned numeric,
  actual numeric,
  variance numeric,
  variance_value_cents bigint,
  cost_per_unit_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with planned_per_material as (
    select sm.material_id,
           sum(sm.quantity)::numeric as planned
      from visits v
      join service_materials sm on sm.service_id = v.service_id
     where v.salon_id   = p_salon_id
       and v.status     = 'paid'
       and v.kind       = 'visit'
       and v.deleted_at is null
       and v.visit_at  >= p_period_start
       and v.visit_at  <  p_period_end
     group by sm.material_id
  ),
  actual_per_material as (
    select tx.material_id,
           sum(-tx.quantity)::numeric as actual  -- consumption.quantity отрицательный
      from inventory_transactions tx
     where tx.salon_id   = p_salon_id
       and tx.type       = 'consumption'
       and tx.created_at >= p_period_start
       and tx.created_at <  p_period_end
     group by tx.material_id
  )
  select ii.id                 as material_id,
         ii.name               as material_name,
         ii.unit,
         coalesce(p.planned, 0)::numeric  as planned,
         coalesce(a.actual, 0)::numeric   as actual,
         (coalesce(a.actual, 0) - coalesce(p.planned, 0))::numeric as variance,
         ((coalesce(a.actual, 0) - coalesce(p.planned, 0)) * ii.cost_per_unit_cents)::bigint
                              as variance_value_cents,
         ii.cost_per_unit_cents
    from inventory_items ii
    left join planned_per_material p on p.material_id = ii.id
    left join actual_per_material a on a.material_id = ii.id
   where ii.salon_id = p_salon_id
     and ii.is_archived = false
     and (coalesce(p.planned, 0) > 0 or coalesce(a.actual, 0) > 0)
   order by abs(coalesce(a.actual, 0) - coalesce(p.planned, 0)) desc;
$$;

grant execute on function public.inventory_plan_vs_fact(uuid, timestamptz, timestamptz) to authenticated;

-- =============================================================================
-- inventory_consumption_by_staff
-- =============================================================================
create or replace function public.inventory_consumption_by_staff(
  p_salon_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns table (
  staff_id uuid,
  staff_full_name text,
  material_id uuid,
  material_name text,
  unit text,
  total_consumed numeric,
  visit_count bigint,
  avg_per_visit numeric,
  expected_per_visit numeric,
  cost_per_unit_cents bigint,
  total_cost_cents bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with master_consumption as (
    select v.staff_id,
           tx.material_id,
           sum(-tx.quantity)::numeric as total_consumed,
           count(distinct tx.visit_id)::bigint as visit_count
      from inventory_transactions tx
      join visits v on v.id = tx.visit_id
     where tx.salon_id   = p_salon_id
       and tx.type       = 'consumption'
       and v.staff_id   is not null
       and tx.created_at >= p_period_start
       and tx.created_at <  p_period_end
     group by v.staff_id, tx.material_id
  ),
  expected as (
    -- Усреднённый «положенный по рецепту» расход на 1 визит для пары
    -- (master, material). Если у мастера были визиты разных услуг с разными
    -- рецептами — берём средневзвешенное.
    select v.staff_id,
           sm.material_id,
           (sum(sm.quantity) / nullif(count(distinct v.id), 0))::numeric as expected_per_visit
      from visits v
      join service_materials sm on sm.service_id = v.service_id
     where v.salon_id   = p_salon_id
       and v.status     = 'paid'
       and v.kind       = 'visit'
       and v.deleted_at is null
       and v.staff_id   is not null
       and v.visit_at  >= p_period_start
       and v.visit_at  <  p_period_end
     group by v.staff_id, sm.material_id
  )
  select mc.staff_id,
         s.full_name                    as staff_full_name,
         mc.material_id,
         ii.name                         as material_name,
         ii.unit,
         mc.total_consumed,
         mc.visit_count,
         (mc.total_consumed / nullif(mc.visit_count, 0))::numeric as avg_per_visit,
         e.expected_per_visit,
         ii.cost_per_unit_cents,
         (mc.total_consumed * ii.cost_per_unit_cents)::bigint as total_cost_cents
    from master_consumption mc
    join staff s on s.id = mc.staff_id
    join inventory_items ii on ii.id = mc.material_id
    left join expected e on e.staff_id = mc.staff_id and e.material_id = mc.material_id
   order by s.full_name, mc.total_consumed desc;
$$;

grant execute on function public.inventory_consumption_by_staff(uuid, timestamptz, timestamptz) to authenticated;
