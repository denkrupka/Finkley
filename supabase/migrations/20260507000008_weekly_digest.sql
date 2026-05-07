-- =============================================================================
-- 20260507000008_weekly_digest.sql
-- =============================================================================
-- TASK-34 (lite): флажок opt-in/opt-out на уровне салона + RPC для KPI
-- за последнюю неделю в IANA-таймзоне салона.
--
-- Cron-доставка пока не активирована (требует разовой настройки vault для
-- service_role JWT). Edge function send-weekly-digest можно дёргать вручную
-- из UI «Settings → Отправить дайджест сейчас» — это уже работает.
-- =============================================================================

alter table public.salons
  add column if not exists weekly_digest_enabled boolean not null default true;

-- KPI за прошлую полную неделю (понедельник 00:00 → понедельник 00:00 этой недели).
-- Возвращает данные одной строкой для удобства edge function.
create or replace function public.weekly_digest_kpis(p_salon_id uuid)
returns table (
  period_start date,
  period_end   date,
  revenue_cents bigint,
  expense_cents bigint,
  profit_cents  bigint,
  visits_count  bigint,
  prev_revenue_cents bigint,
  top_staff_name text,
  top_staff_revenue_cents bigint,
  top_service_name text,
  top_service_revenue_cents bigint
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_today_local date;
  v_this_mon date;
  v_last_mon date;
  v_prev_mon date;
  v_period_start_ts timestamptz;
  v_period_end_ts   timestamptz;
  v_prev_start_ts   timestamptz;
  v_prev_end_ts     timestamptz;
begin
  select coalesce(timezone, 'Europe/Warsaw') into v_tz
    from salons where id = p_salon_id;
  if not found then return; end if;

  v_today_local := (now() at time zone v_tz)::date;
  v_this_mon := v_today_local - (extract(isodow from v_today_local)::int - 1);
  v_last_mon := v_this_mon - 7;
  v_prev_mon := v_last_mon - 7;

  v_period_start_ts := (v_last_mon || ' 00:00:00')::timestamp at time zone v_tz;
  v_period_end_ts   := (v_this_mon || ' 00:00:00')::timestamp at time zone v_tz;
  v_prev_start_ts   := (v_prev_mon || ' 00:00:00')::timestamp at time zone v_tz;
  v_prev_end_ts     := v_period_start_ts;

  return query
  with last_week as (
    select
      coalesce(sum(amount_cents - coalesce(discount_cents, 0) + coalesce(tip_cents, 0)), 0)::bigint as revenue,
      count(*)::bigint as visits
      from visits
     where salon_id = p_salon_id
       and visit_at >= v_period_start_ts
       and visit_at <  v_period_end_ts
       and status = 'paid'
       and deleted_at is null
  ), last_week_exp as (
    select coalesce(sum(amount_cents), 0)::bigint as expense
      from expenses
     where salon_id = p_salon_id
       and expense_at >= v_last_mon
       and expense_at <  v_this_mon
       and deleted_at is null
  ), prev_week as (
    select coalesce(sum(amount_cents - coalesce(discount_cents, 0) + coalesce(tip_cents, 0)), 0)::bigint as revenue
      from visits
     where salon_id = p_salon_id
       and visit_at >= v_prev_start_ts
       and visit_at <  v_prev_end_ts
       and status = 'paid'
       and deleted_at is null
  ), top_staff as (
    select s.full_name,
           coalesce(sum(v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)), 0)::bigint as rev
      from visits v
      join staff s on s.id = v.staff_id
     where v.salon_id = p_salon_id
       and v.visit_at >= v_period_start_ts
       and v.visit_at <  v_period_end_ts
       and v.status = 'paid'
       and v.deleted_at is null
     group by s.full_name
     order by rev desc
     limit 1
  ), top_service as (
    select coalesce(s.name, v.service_name_snapshot, '— Без услуги') as service_name,
           coalesce(sum(v.amount_cents - coalesce(v.discount_cents, 0) + coalesce(v.tip_cents, 0)), 0)::bigint as rev
      from visits v
      left join services s on s.id = v.service_id
     where v.salon_id = p_salon_id
       and v.visit_at >= v_period_start_ts
       and v.visit_at <  v_period_end_ts
       and v.status = 'paid'
       and v.deleted_at is null
     group by 1
     order by rev desc
     limit 1
  )
  select v_last_mon                                         as period_start,
         (v_this_mon - 1)                                   as period_end,
         lw.revenue                                         as revenue_cents,
         lwe.expense                                        as expense_cents,
         (lw.revenue - lwe.expense)                         as profit_cents,
         lw.visits                                          as visits_count,
         pw.revenue                                         as prev_revenue_cents,
         (select full_name from top_staff)                  as top_staff_name,
         (select rev from top_staff)                        as top_staff_revenue_cents,
         (select service_name from top_service)             as top_service_name,
         (select rev from top_service)                      as top_service_revenue_cents
    from last_week lw, last_week_exp lwe, prev_week pw;
end;
$$;

grant execute on function public.weekly_digest_kpis(uuid) to authenticated, service_role;
