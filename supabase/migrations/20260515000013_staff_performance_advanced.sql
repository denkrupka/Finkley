-- =============================================================================
-- staff_performance_advanced — расширенный отчёт по эффективности мастера.
-- =============================================================================
-- Используется в /reports?tab=staff. По каждому активному мастеру возвращает:
--   - total_revenue_cents   — выручка за период (visits + retail)
--   - visits_revenue_cents  — только обычные визиты (kind='visit')
--   - retail_revenue_cents  — допродажи (kind='retail')
--   - visits_count          — кол-во оплаченных визитов за период (kind='visit')
--   - unique_clients_count  — уникальные клиенты в визитах
--   - returned_clients_count — клиенты, у которых после визита к мастеру был
--                              ещё хотя бы один визит в салон (любому мастеру)
--                              в течение salon.retention_window_days
--   - rebook_pct            — returned_clients / unique_clients * 100
--   - revenue_6m_cents      — выручка мастера за последние 6 мес (для тренда)
--   - hire_date             — дата первого визита мастера (приблизительный
--                              «стаж работы»)
--   - scheduled_minutes     — расчётная сумма рабочих минут по weekly_schedule
--                              за период (для расчёта utilization)
--   - worked_minutes        — сумма service.default_duration_min по оплаченным
--                              визитам мастера за период
--   - utilization_pct       — worked / scheduled * 100
--
-- Доступ: член салона (любая роль). Sensitive PII не возвращается.
-- =============================================================================

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
  -- Membership check (RLS-friendly — функция security invoker)
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
    -- Все оплаченные визиты мастера за период
    select
      vi.staff_id,
      vi.kind,
      vi.client_id,
      vi.visit_at,
      vi.amount_cents - vi.discount_cents + vi.tip_cents as net_cents,
      coalesce(s.default_duration_min, 60) as dur_min
    from visits vi
      left join services s on s.id = vi.service_id
    where vi.salon_id = p_salon_id
      and vi.status = 'paid'
      and vi.visit_at >= p_start_ts
      and vi.visit_at <  p_end_ts
  ),
  /* Возвращаемость: клиент сделал ещё хотя бы один визит в салон в течение
     retention_window_days после визита к мастеру. */
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
    -- Стаж = дата первого визита (visit-kind) этого мастера
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
      /* Очень грубая оценка: считаем сколько минут «открыто» в неделю по
         weekly_schedule (mon-sun) и масштабируем на длину периода в днях.
         Точный счёт «сколько именно рабочих часов попадёт в период» — это
         календарный pass по каждой дате; здесь используем средневзвешенный. */
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

comment on function public.staff_performance_advanced is
  'Расширенный отчёт по эффективности мастеров (retention, rebook%, utilization, revenue split). Используется в /reports?tab=staff.';
