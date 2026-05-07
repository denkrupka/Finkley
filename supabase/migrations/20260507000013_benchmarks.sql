-- =============================================================================
-- 20260507000013_benchmarks.sql
-- =============================================================================
-- TASK-36: Бенчмарки — сравнение салона со средним по рынку.
--
-- Архитектура:
--  * salons.benchmarks_opt_in — юзер согласился делиться обезличенной стат.
--  * benchmark_aggregates — материализованные агрегаты по (country, type)
--  * K-anonymity N=10 — публикуется только если в bucket'е минимум 10 салонов
--  * Daily cron пересчитывает (cheap, всё в SQL без AI/HTTP)
-- =============================================================================

alter table public.salons
  add column if not exists benchmarks_opt_in boolean not null default true;

-- Aggregate-таблица. Один row на (country, type, period). Period сейчас = '30d'.
create table if not exists public.benchmark_aggregates (
  country_code              text not null,
  salon_type                text not null,
  period                    text not null,
  computed_at               timestamptz not null default now(),
  salon_count               int not null,
  avg_check_cents           bigint,
  revenue_per_master_cents  bigint,
  visits_per_week           numeric(10,2),
  rebooking_rate_pct        numeric(5,2),
  top_services              jsonb,
  primary key (country_code, salon_type, period)
);

alter table public.benchmark_aggregates enable row level security;

-- Чтение: всем authenticated; запись: service_role
create policy "everyone reads benchmark_aggregates" on public.benchmark_aggregates
  for select using (true);
grant select on public.benchmark_aggregates to authenticated;
grant select, insert, update, delete on public.benchmark_aggregates to service_role;

-- =============================================================================
-- compute_benchmarks() — пересчёт всех агрегатов одним SQL-блоком.
-- K-anonymity enforced на финальном HAVING count(*) >= 10.
-- =============================================================================
create or replace function public.compute_benchmarks()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  -- Per-salon stats (только opt-in салоны)
  with eligible as (
    select id, country_code, salon_type, currency
      from salons
     where benchmarks_opt_in = true and deleted_at is null
  ),
  -- Avg check, visits/week, revenue per master — за последние 30 дней
  salon_stats as (
    select e.id, e.country_code, e.salon_type,
           coalesce(avg(v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)), 0)::bigint as avg_check,
           count(v.id) filter (where v.visit_at >= now() - interval '30 days')::numeric / 4.286 as visits_per_week,
           coalesce(sum(v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)) filter (where v.visit_at >= now() - interval '30 days'), 0)::bigint as revenue_30d,
           (select count(*) from staff s where s.salon_id = e.id and s.is_active = true and s.deleted_at is null) as active_staff
      from eligible e
      left join visits v
        on v.salon_id = e.id and v.status = 'paid' and v.deleted_at is null
       and v.visit_at >= now() - interval '30 days'
     group by e.id, e.country_code, e.salon_type
  ),
  salon_with_master_revenue as (
    select s.*,
           case when s.active_staff > 0
                then s.revenue_30d / s.active_staff
                else null end as revenue_per_master
      from salon_stats s
  ),
  -- Rebooking rate per salon: клиенты, у которых ≥2 визита за 60 дней / всего клиентов с хотя бы 1 визитом
  salon_rebooking as (
    select e.id, e.country_code, e.salon_type,
           case when count(distinct c.id) > 0
                then 100.0 * count(distinct c.id) filter (
                  where (
                    select count(*) from visits v2
                     where v2.client_id = c.id
                       and v2.salon_id = e.id
                       and v2.status = 'paid' and v2.deleted_at is null
                       and v2.visit_at >= now() - interval '60 days'
                  ) >= 2
                ) / count(distinct c.id)
                else 0 end::numeric(5,2) as rebooking_rate
      from eligible e
      left join clients c on c.salon_id = e.id and c.deleted_at is null and c.visit_count > 0
     group by e.id, e.country_code, e.salon_type
  ),
  -- Top-3 services per (country, type) — собираем глобально
  top_services_per_bucket as (
    select e.country_code, e.salon_type,
           jsonb_agg(s ORDER BY s.total_revenue desc) FILTER (WHERE s.rn <= 3) as top_services
      from (
        select country_code, salon_type, name,
               sum(total_revenue) as total_revenue,
               sum(visit_count) as visit_count,
               row_number() over (partition by country_code, salon_type order by sum(total_revenue) desc) as rn
          from (
            select e.country_code, e.salon_type, sv.name,
                   coalesce(sum(v.amount_cents), 0)::bigint as total_revenue,
                   count(v.id)::int as visit_count
              from eligible e
              join services sv on sv.salon_id = e.id
              left join visits v on v.service_id = sv.id and v.salon_id = e.id
                 and v.status = 'paid' and v.deleted_at is null
                 and v.visit_at >= now() - interval '30 days'
             group by e.country_code, e.salon_type, sv.name
          ) per_service
         group by country_code, salon_type, name
      ) s
      join eligible e on e.country_code = s.country_code and e.salon_type = s.salon_type
     group by e.country_code, e.salon_type
  ),
  -- Финальные агрегаты по (country, type) с k-anonymity
  buckets as (
    select swm.country_code, swm.salon_type,
           count(*)::int as salon_count,
           avg(swm.avg_check)::bigint as avg_check,
           avg(swm.revenue_per_master) filter (where swm.revenue_per_master is not null)::bigint as revenue_per_master,
           avg(swm.visits_per_week)::numeric(10,2) as visits_per_week,
           avg(rb.rebooking_rate)::numeric(5,2) as rebooking_rate
      from salon_with_master_revenue swm
      left join salon_rebooking rb on rb.id = swm.id
     group by swm.country_code, swm.salon_type
    having count(*) >= 10  -- K-anonymity: минимум 10 салонов в bucket'е
  )
  insert into public.benchmark_aggregates (
    country_code, salon_type, period, computed_at,
    salon_count, avg_check_cents, revenue_per_master_cents,
    visits_per_week, rebooking_rate_pct, top_services
  )
  select b.country_code, b.salon_type, '30d', now(),
         b.salon_count, b.avg_check, b.revenue_per_master,
         b.visits_per_week, b.rebooking_rate,
         coalesce(ts.top_services, '[]'::jsonb)
    from buckets b
    left join top_services_per_bucket ts
      on ts.country_code = b.country_code and ts.salon_type = b.salon_type
  on conflict (country_code, salon_type, period) do update set
    computed_at              = excluded.computed_at,
    salon_count              = excluded.salon_count,
    avg_check_cents          = excluded.avg_check_cents,
    revenue_per_master_cents = excluded.revenue_per_master_cents,
    visits_per_week          = excluded.visits_per_week,
    rebooking_rate_pct       = excluded.rebooking_rate_pct,
    top_services             = excluded.top_services;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.compute_benchmarks() from public;
grant execute on function public.compute_benchmarks() to service_role;

-- Daily cron 03:30 UTC (после recurring expenses на 03:00, до digest на 09:00)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'compute-benchmarks') then
    perform cron.unschedule('compute-benchmarks');
  end if;
end$$;

select cron.schedule(
  'compute-benchmarks',
  '30 3 * * *',
  $$ select public.compute_benchmarks(); $$
);

-- =============================================================================
-- RPC get_benchmark_comparison — для виджета на дашборде. Сравнивает stats
-- салона с агрегатом своего bucket. Возвращает null если bucket не достиг
-- k-anonymity (мало салонов).
-- =============================================================================
create or replace function public.get_benchmark_comparison(p_salon_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_country  text;
  v_type     text;
  v_my_avg_check    bigint;
  v_my_visits       numeric;
  v_my_rev_master   bigint;
  v_my_rebook       numeric;
  v_active_staff    int;
  v_bucket          benchmark_aggregates%rowtype;
begin
  select country_code, salon_type into v_country, v_type
    from salons where id = p_salon_id and deleted_at is null;
  if v_country is null then return null; end if;

  select * into v_bucket
    from benchmark_aggregates
   where country_code = v_country and salon_type = v_type and period = '30d';
  if v_bucket.salon_count is null then
    return jsonb_build_object('available', false, 'reason', 'bucket_empty');
  end if;

  -- Подсчёт мои метрики (тот же расчёт что в compute_benchmarks но per single salon)
  select coalesce(avg(amount_cents - coalesce(discount_cents, 0) + coalesce(tip_cents, 0)), 0)::bigint,
         count(*)::numeric / 4.286
    into v_my_avg_check, v_my_visits
    from visits
   where salon_id = p_salon_id and status = 'paid' and deleted_at is null
     and visit_at >= now() - interval '30 days';

  select count(*) into v_active_staff
    from staff where salon_id = p_salon_id and is_active = true and deleted_at is null;

  if v_active_staff > 0 then
    select coalesce(sum(amount_cents - coalesce(discount_cents, 0) + coalesce(tip_cents, 0)), 0)::bigint / v_active_staff
      into v_my_rev_master
      from visits
     where salon_id = p_salon_id and status = 'paid' and deleted_at is null
       and visit_at >= now() - interval '30 days';
  end if;

  -- Rebooking
  with my_clients as (
    select c.id from clients c where c.salon_id = p_salon_id and c.deleted_at is null and c.visit_count > 0
  ),
  rebooked as (
    select count(*) as c from my_clients m
     where (
       select count(*) from visits v2
        where v2.client_id = m.id and v2.salon_id = p_salon_id
          and v2.status = 'paid' and v2.deleted_at is null
          and v2.visit_at >= now() - interval '60 days'
     ) >= 2
  )
  select case when (select count(*) from my_clients) > 0
              then 100.0 * (select c from rebooked) / (select count(*) from my_clients)
              else 0 end
    into v_my_rebook;

  return jsonb_build_object(
    'available', true,
    'country_code', v_country,
    'salon_type', v_type,
    'salon_count', v_bucket.salon_count,
    'computed_at', v_bucket.computed_at,
    'me', jsonb_build_object(
      'avg_check_cents', v_my_avg_check,
      'visits_per_week', v_my_visits,
      'revenue_per_master_cents', v_my_rev_master,
      'rebooking_rate_pct', round(v_my_rebook, 1)
    ),
    'market', jsonb_build_object(
      'avg_check_cents', v_bucket.avg_check_cents,
      'visits_per_week', v_bucket.visits_per_week,
      'revenue_per_master_cents', v_bucket.revenue_per_master_cents,
      'rebooking_rate_pct', v_bucket.rebooking_rate_pct,
      'top_services', v_bucket.top_services
    )
  );
end;
$$;

grant execute on function public.get_benchmark_comparison(uuid) to authenticated, service_role;
