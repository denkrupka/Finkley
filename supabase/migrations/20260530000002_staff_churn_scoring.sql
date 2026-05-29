-- =============================================================================
-- 20260530000002_staff_churn_scoring.sql
-- =============================================================================
-- Расширяем staff_performance_advanced двумя серверными метриками:
--
--   - churn_pct (numeric) — % клиентов мастера, которые после визита у него
--     БОЛЬШЕ НИКОГДА не вернулись в салон (ни к этому мастеру, ни к другому).
--     Формальное определение:
--
--       churn(staff) = count(distinct client_id у этого staff)
--                       WHERE last_visit_in_salon == last_visit_at_this_master
--                         AND now() - last_visit_in_salon > retention_window
--                     / total_distinct_clients_seen_by_staff
--
--     То есть мы не считаем «отвалившимися» тех, у кого последний визит к
--     мастеру = последний визит в салон, но прошло мало времени (могут ещё
--     вернуться). Окно — `salons.retention_window_days` (по умолчанию 60).
--
--   - scoring (numeric) — единая «оценка» эффективности мастера:
--
--       scoring = (rebook_pct × retention_regular_pct) / max(churn_pct, 1)
--
--     Где retention_regular_pct = % постоянных клиентов мастера (≥2 визитов
--     за всю историю, первый — ДО периода), которые пришли в текущем
--     периоде. Чем выше — тем лучше; делим на churn чтобы наказывать тех,
--     кто теряет клиентов.
--
-- До этой миграции Отток и Скоринг считались client-side в StaffAnalyticsTab
-- через `useVisits` (выборка с начала года) — это не масштабировалось и не
-- было консистентным с RPC-метриками. Теперь всё в одном запросе.
--
-- ВАЖНО: `create or replace function` НЕ переопределяет return type — Postgres
-- падает с 42P13. Поэтому сначала DROP, потом CREATE.
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
  utilization_pct numeric,
  churn_pct numeric,
  scoring numeric
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
  ),
  /* ------------------------------------------------------------------
     Churn: для каждого мастера и каждого клиента считаем последний визит
     этого клиента к ЭТОМУ мастеру vs последний визит этого клиента в
     САЛОН (любой мастер). Если они совпадают и с тех пор прошло > окна
     retention — клиент «отвалился после этого мастера».

     Берём ВСЕ визиты салона за всё время (kind='visit', status='paid'),
     не ограничиваясь периодом — иначе нельзя понять, вернулся ли клиент
     в будущем.
  ------------------------------------------------------------------- */
  all_visits as (
    select staff_id, client_id, visit_at
    from visits
    where salon_id = p_salon_id
      and kind = 'visit'
      and status = 'paid'
      and client_id is not null
      and staff_id is not null
  ),
  last_per_staff_client as (
    select staff_id, client_id, max(visit_at) as last_at_staff
    from all_visits
    group by staff_id, client_id
  ),
  last_per_salon_client as (
    select client_id, max(visit_at) as last_at_salon
    from all_visits
    group by client_id
  ),
  churn_per_staff as (
    select
      lpsc.staff_id,
      count(distinct lpsc.client_id)::int as clients_total,
      count(distinct case
        when lpsc.last_at_staff = lps.last_at_salon
         and (now() - lps.last_at_salon) > (v_retention_days || ' days')::interval
        then lpsc.client_id
      end)::int as churned_count
    from last_per_staff_client lpsc
      join last_per_salon_client lps on lps.client_id = lpsc.client_id
    group by lpsc.staff_id
  ),
  /* ------------------------------------------------------------------
     Retention для постоянных клиентов (для формулы scoring):
       клиент = «постоянный» если ≥2 визитов в истории И первый визит
       был ДО начала периода. Активный = пришёл хотя бы раз в периоде.
     retention_regular_pct = active / total_regular * 100.
  ------------------------------------------------------------------- */
  per_staff_client_stats as (
    select
      staff_id,
      client_id,
      count(*)::int as total_count,
      min(visit_at) as first_at,
      max(case when visit_at >= p_start_ts and visit_at < p_end_ts
               then visit_at end) as last_in_period
    from all_visits
    group by staff_id, client_id
  ),
  regular_per_staff as (
    select
      staff_id,
      count(*) filter (where total_count >= 2 and first_at < p_start_ts)::int as regular_total,
      count(*) filter (
        where total_count >= 2
          and first_at < p_start_ts
          and last_in_period is not null
      )::int as regular_active
    from per_staff_client_stats
    group by staff_id
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
      else 0 end as utilization_pct,
    /* churn_pct */
    case
      when coalesce(cs.clients_total, 0) > 0
        then round((cs.churned_count::numeric * 100) / cs.clients_total, 1)
      else 0
    end as churn_pct,
    /* scoring = (rebook_share × retention_regular_share) / max(churn_share, 0.01).
       Работаем с долями (0..1), не процентами — иначе масштаб получается
       сотнями. Финальный диапазон: ~0..5; пороги UI: >1.5 / 0.5..1.5 / <0.5.

       Если churn=0 → берём 0.01 в знаменателе (как «1%» — даёт scoring×100,
       мастер не теряет клиентов и должен получать высокий балл, но не Inf).
       Если регуляров нет — fallback: rebook_share² / churn_share (квадрат
       вместо retention, чтобы новые мастера не получали нулевой скоринг). */
    case
      when coalesce(rps.regular_total, 0) > 0
        then round(
          (
            (case when a.unique_clients_count > 0
                  then coalesce(r.cnt,0)::numeric / a.unique_clients_count
                  else 0 end)
            *
            (rps.regular_active::numeric / rps.regular_total)
          )
          /
          greatest(
            case
              when coalesce(cs.clients_total, 0) > 0
                then cs.churned_count::numeric / cs.clients_total
              else 0
            end,
            0.01
          ),
          2
        )
      else
        round(
          (
            (case when a.unique_clients_count > 0
                  then coalesce(r.cnt,0)::numeric / a.unique_clients_count
                  else 0 end)
            ^ 2
          )
          /
          greatest(
            case
              when coalesce(cs.clients_total, 0) > 0
                then cs.churned_count::numeric / cs.clients_total
              else 0
            end,
            0.01
          ),
          2
        )
    end as scoring
  from agg a
    left join returned_per_staff r on r.staff_id = a.staff_id
    left join six_m s6 on s6.staff_id = a.staff_id
    left join hire h on h.staff_id = a.staff_id
    left join scheduled sc on sc.staff_id = a.staff_id
    left join churn_per_staff cs on cs.staff_id = a.staff_id
    left join regular_per_staff rps on rps.staff_id = a.staff_id
  order by a.total_revenue_cents desc;
end;
$$;

grant execute on function public.staff_performance_advanced(uuid, timestamptz, timestamptz)
  to authenticated;

comment on function public.staff_performance_advanced is
  'Расширенный отчёт по эффективности мастеров (retention, rebook%, utilization, churn%, scoring). Используется в /reports?tab=staff.';
