-- =============================================================================
-- 20260521000011_staff_performance_tips.sql
-- =============================================================================
-- Расширяем staff_performance_advanced колонкой tips_cents (сумма чаевых
-- за период, у мастера visit-kind).
--
-- Юзер просит видеть чаевые отдельно в /reports → мастера, а также в /payouts
-- для расчёта выплат (чаевые отдаются мастеру 100%, не входят в commission).
--
-- ВАЖНО: `create or replace function` НЕ переопределяет return type —
-- Postgres падает с 42P13. Поэтому сначала DROP старой версии (она была
-- создана в миграции 20260515000013_staff_performance_advanced.sql) и
-- только потом создаём заново с новой сигнатурой (добавлен tips_cents).
-- =============================================================================

drop function if exists public.staff_performance_advanced(uuid, timestamptz, timestamptz);

create or replace function public.staff_performance_advanced(
  p_salon_id uuid,
  p_start_ts timestamptz,
  p_end_ts   timestamptz
)
returns table (
  staff_id uuid,
  full_name text,
  is_active boolean,
  total_revenue_cents bigint,
  visits_revenue_cents bigint,
  retail_revenue_cents bigint,
  tips_cents bigint,
  visits_count int,
  unique_clients_count int,
  returned_clients_count int,
  rebook_pct numeric,
  revenue_6m_cents bigint,
  hire_date date,
  scheduled_minutes int,
  worked_minutes int,
  utilization_pct numeric
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_retention_days int;
  v_period_days int;
begin
  if not exists (
    select 1 from salon_members sm
     where sm.salon_id = p_salon_id and sm.user_id = auth.uid()
  ) then
    raise exception 'forbidden';
  end if;

  select coalesce(retention_window_days, 60) into v_retention_days
    from salons where id = p_salon_id;

  v_period_days := greatest(1, extract(day from (p_end_ts - p_start_ts))::int);

  return query
  with v as (
    select
      vi.staff_id,
      vi.kind,
      vi.client_id,
      vi.visit_at,
      vi.amount_cents - vi.discount_cents + vi.tip_cents as net_cents,
      vi.tip_cents,
      coalesce(s.default_duration_min, 60) as dur_min
    from visits vi
      left join services s on s.id = vi.service_id
    where vi.salon_id = p_salon_id
      and vi.status = 'paid'
      and vi.visit_at >= p_start_ts
      and vi.visit_at <  p_end_ts
  ),
  returners as (
    select distinct v1.staff_id, v1.client_id
    from v v1
      join visits v2 on v2.salon_id = p_salon_id
                    and v2.client_id = v1.client_id
                    and v2.visit_at >  v1.visit_at
                    and v2.visit_at <= v1.visit_at + (v_retention_days || ' days')::interval
                    and v2.status = 'paid'
    where v1.client_id is not null
      and v1.kind = 'visit'
  ),
  six_m as (
    select staff_id,
           sum(amount_cents - discount_cents + tip_cents) as rev_6m
    from visits
    where salon_id = p_salon_id
      and status = 'paid'
      and visit_at >= now() - interval '6 months'
    group by staff_id
  ),
  hire as (
    select staff_id, min(visit_at)::date as first_at
    from visits
    where salon_id = p_salon_id
      and staff_id is not null
      and kind = 'visit'
    group by staff_id
  ),
  agg as (
    select
      st.id as staff_id,
      st.full_name,
      st.is_active,
      st.weekly_schedule,
      coalesce(sum(v.net_cents),0)::bigint as total_revenue_cents,
      coalesce(sum(case when v.kind = 'visit'  then v.net_cents end),0)::bigint as visits_revenue_cents,
      coalesce(sum(case when v.kind = 'retail' then v.net_cents end),0)::bigint as retail_revenue_cents,
      coalesce(sum(case when v.kind = 'visit'  then v.tip_cents end),0)::bigint as tips_cents,
      coalesce(count(case when v.kind = 'visit' then 1 end),0)::int as visits_count,
      coalesce(count(distinct case when v.kind = 'visit' then v.client_id end),0)::int
        as unique_clients_count,
      coalesce(sum(case when v.kind = 'visit' then v.dur_min end),0)::int as worked_minutes
    from staff st
      left join v on v.staff_id = st.id
    where st.salon_id = p_salon_id
    group by st.id, st.full_name, st.is_active, st.weekly_schedule
  ),
  returned_per_staff as (
    select staff_id, count(*)::int as cnt
    from returners
    group by staff_id
  ),
  scheduled as (
    select
      a.staff_id,
      coalesce((
        select sum(
          extract(epoch from (
            (coalesce((day_cfg->>'end')::time, '20:00')) -
            (coalesce((day_cfg->>'start')::time, '09:00'))
          ))::int / 60
        )::int * v_period_days / 7
        from (
          select jsonb_array_elements_text(jsonb_build_array(
            'mon','tue','wed','thu','fri','sat','sun'
          )) as day_key
        ) days
        cross join lateral (
          select (a.weekly_schedule->days.day_key) as day_cfg
        ) c
        where day_cfg is not null
          and coalesce((day_cfg->>'off')::boolean, false) = false
      ), 0) as minutes
    from agg a
  )
  select
    a.staff_id,
    a.full_name,
    a.is_active,
    a.total_revenue_cents,
    a.visits_revenue_cents,
    a.retail_revenue_cents,
    a.tips_cents,
    a.visits_count,
    a.unique_clients_count,
    coalesce(r.cnt, 0) as returned_clients_count,
    case when a.unique_clients_count > 0
      then round((coalesce(r.cnt,0)::numeric * 100) / a.unique_clients_count, 1)
      else 0 end as rebook_pct,
    coalesce(s6.rev_6m, 0)::bigint as revenue_6m_cents,
    h.first_at as hire_date,
    coalesce(sc.minutes, 0)::int as scheduled_minutes,
    a.worked_minutes,
    case when coalesce(sc.minutes,0) > 0
      then round((a.worked_minutes::numeric * 100) / sc.minutes, 1)
      else 0 end as utilization_pct
  from agg a
    left join returned_per_staff r on r.staff_id = a.staff_id
    left join six_m s6 on s6.staff_id = a.staff_id
    left join hire h on h.staff_id = a.staff_id
    left join scheduled sc on sc.staff_id = a.staff_id
  order by a.total_revenue_cents desc;
end;
$$;

grant execute on function public.staff_performance_advanced(uuid, timestamptz, timestamptz)
  to authenticated;
