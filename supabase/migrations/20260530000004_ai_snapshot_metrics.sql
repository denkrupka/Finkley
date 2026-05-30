-- =============================================================================
-- 20260530000004_ai_snapshot_metrics.sql
-- =============================================================================
-- Расширяем ai_salon_snapshot дополнительными метриками для AI-помощника:
--   • current_month.avg_check / prev_month.avg_check — средний чек этого/прошлого месяца
--   • retention_rate — % клиентов, посетивших и прошлый, и текущий месяц
--   • churn_rate — % клиентов, что были активны 60-90 дней назад, но не пришли за 30 дней
--   • new_vs_returning — { new, returning } количество визитов в текущем месяце
--   • top_services_by_avg_check — топ-5 услуг по среднему чеку
--
-- Цель: AI отвечает на «какой у меня средний чек?» / «есть ли отток клиентов?» /
-- «новые vs возвращающиеся» конкретными числами, без воды и без выдумывания.
-- =============================================================================

create or replace function public.ai_salon_snapshot(p_salon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_cur_start timestamptz := date_trunc('month', v_now);
  v_prev_start timestamptz := v_cur_start - interval '1 month';
  v_prev_end   timestamptz := v_cur_start;
  result jsonb;
begin
  with cur_period as (
    select
      coalesce(sum(amount_cents), 0) as revenue,
      count(*) as visits,
      coalesce(avg(amount_cents), 0) as avg_ticket,
      coalesce(avg(amount_cents), 0) as avg_check
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid'
      and visit_at >= v_cur_start and visit_at < v_now
  ),
  prev_period as (
    select
      coalesce(sum(amount_cents), 0) as revenue,
      count(*) as visits,
      coalesce(avg(amount_cents), 0) as avg_check
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid'
      and visit_at >= v_prev_start and visit_at < v_prev_end
  ),
  top_staff as (
    select
      coalesce(s.full_name, 'Без мастера') as name,
      sum(v.amount_cents) as revenue,
      count(*) as visits
    from visits v
    left join staff s on s.id = v.staff_id
    where v.salon_id = p_salon_id and v.deleted_at is null
      and v.status = 'paid'
      and v.visit_at >= v_cur_start
    group by 1
    order by revenue desc
    limit 5
  ),
  top_services as (
    select
      coalesce(svc.name, v.service_name_snapshot, '—') as name,
      sum(v.amount_cents) as revenue,
      count(*) as visits
    from visits v
    left join services svc on svc.id = v.service_id
    where v.salon_id = p_salon_id and v.deleted_at is null
      and v.status = 'paid'
      and v.visit_at >= v_cur_start
    group by 1
    order by revenue desc
    limit 5
  ),
  top_services_by_avg as (
    -- Топ услуг по среднему чеку (а не по общей выручке), мин 2 визита,
    -- чтобы не показать одноразовую дорогую покупку как «топ услугу».
    select
      coalesce(svc.name, v.service_name_snapshot, '—') as name,
      round(avg(v.amount_cents))::bigint as avg_check,
      count(*) as visits
    from visits v
    left join services svc on svc.id = v.service_id
    where v.salon_id = p_salon_id and v.deleted_at is null
      and v.status = 'paid'
      and v.visit_at >= v_cur_start
    group by 1
    having count(*) >= 2
    order by avg(v.amount_cents) desc
    limit 5
  ),
  expenses_period as (
    select coalesce(sum(amount_cents), 0) as total
    from expenses
    where salon_id = p_salon_id and deleted_at is null
      and expense_at >= v_cur_start::date and expense_at < v_now::date + 1
  ),
  client_stats as (
    select
      count(*) filter (where last_visit_at >= v_cur_start - interval '90 days') as active,
      count(*) as total,
      count(*) filter (where last_visit_at is null) as never_visited
    from clients
    where salon_id = p_salon_id and deleted_at is null
  ),
  pending_visits as (
    select count(*) as cnt
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'pending'
      and visit_at < v_now
  ),
  -- Клиенты, у которых был хотя бы один визит в текущем месяце.
  cur_month_clients as (
    select distinct client_id
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid'
      and client_id is not null
      and visit_at >= v_cur_start and visit_at < v_now
  ),
  -- Клиенты с визитом в прошлом месяце.
  prev_month_clients as (
    select distinct client_id
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid'
      and client_id is not null
      and visit_at >= v_prev_start and visit_at < v_prev_end
  ),
  -- Retention: какая доля клиентов прошлого месяца вернулась в этом месяце.
  -- Считаем от ЗНАМЕНАТЕЛЯ (был в прошлом месяце), а не от текущего, потому
  -- что бизнес-смысл retention'а — «удержали ли мы тех, кого уже вели».
  retention_calc as (
    select
      (select count(*) from prev_month_clients) as prev_clients,
      (select count(*) from prev_month_clients p
        where exists (select 1 from cur_month_clients c where c.client_id = p.client_id)) as retained
  ),
  -- Churn: клиенты, которые были активны 30-90 дней назад (т.е. ходили), но
  -- не пришли за последние 30 дней. Знаменатель — клиенты, активные в окне 30-90д.
  churn_window as (
    select c.id
    from clients c
    where c.salon_id = p_salon_id and c.deleted_at is null
      and c.last_visit_at >= v_now - interval '90 days'
      and c.last_visit_at <  v_now - interval '30 days'
  ),
  churn_active_30 as (
    select c.id
    from clients c
    where c.salon_id = p_salon_id and c.deleted_at is null
      and c.last_visit_at >= v_now - interval '30 days'
  ),
  churn_calc as (
    select
      (select count(*) from churn_window) + (select count(*) from churn_active_30) as denom,
      (select count(*) from churn_window) as churned
  ),
  -- New vs returning visits в текущем месяце.
  -- New: клиент создан в этом месяце (или first_visit_at попадает в месяц).
  -- Используем самый ранний paid-визит клиента как «первый визит».
  client_first_visit as (
    select client_id, min(visit_at) as first_at
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid' and client_id is not null
    group by client_id
  ),
  new_vs_returning as (
    select
      count(*) filter (
        where cfv.first_at >= v_cur_start and cfv.first_at < v_now
      ) as new_visits,
      count(*) filter (
        where cfv.first_at < v_cur_start
      ) as returning_visits,
      count(*) filter (
        where v.client_id is null
      ) as walkin_visits
    from visits v
    left join client_first_visit cfv on cfv.client_id = v.client_id
    where v.salon_id = p_salon_id and v.deleted_at is null
      and v.status = 'paid'
      and v.visit_at >= v_cur_start and v.visit_at < v_now
  ),
  staff_list as (
    select id, full_name
    from staff
    where salon_id = p_salon_id and is_active = true and deleted_at is null
    order by full_name
  ),
  services_list as (
    select id, name, default_price_cents, default_duration_min
    from services
    where salon_id = p_salon_id and is_archived = false
    order by name
  ),
  expense_categories_list as (
    select id, name
    from expense_categories
    where salon_id = p_salon_id and is_archived = false
    order by name
  ),
  cash_registers_list as (
    select
      (elem->>'id')::text as id,
      (elem->>'label')::text as label,
      coalesce(
        (
          select balance_cents
          from public.compute_all_register_balances(p_salon_id) bal
          where bal.register_id = (elem->>'id')::text
        ),
        0
      ) as balance_cents
    from public.salons s,
         jsonb_array_elements(coalesce(s.financial_settings->'cash_registers'->'items', '[]'::jsonb)) elem
    where s.id = p_salon_id
      and coalesce((elem->>'archived')::boolean, false) = false
    order by 1
  ),
  problems_data as (
    select jsonb_build_object(
      'staff_without_payout_scheme',
        (select count(*) from staff
         where salon_id = p_salon_id and is_active = true and deleted_at is null
           and payout_percent is null and coalesce(payout_fixed_cents, 0) = 0
           and coalesce(chair_rent_cents, 0) = 0),
      'pending_visits_past',
        (select count(*) from visits
         where salon_id = p_salon_id and deleted_at is null
           and status = 'pending' and visit_at < v_now),
      'clients_inactive_90d',
        (select count(*) from clients
         where salon_id = p_salon_id and deleted_at is null
           and last_visit_at < v_now - interval '90 days'),
      'unpaid_payouts_prev_month',
        (select count(*) from payouts
         where salon_id = p_salon_id and status = 'draft'
           and period_end < v_cur_start::date),
      'expenses_no_category_count',
        (select count(*) from expenses
         where salon_id = p_salon_id and deleted_at is null
           and category_id is null
           and expense_at >= (v_now - interval '30 days')::date)
    ) as data
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'current_month_start', v_cur_start,
      'now', v_now
    ),
    'current_month', (select to_jsonb(cur_period) from cur_period),
    'prev_month', (select to_jsonb(prev_period) from prev_period),
    'top_staff', (select coalesce(jsonb_agg(to_jsonb(top_staff)), '[]'::jsonb) from top_staff),
    'top_services', (select coalesce(jsonb_agg(to_jsonb(top_services)), '[]'::jsonb) from top_services),
    'top_services_by_avg_check',
      (select coalesce(jsonb_agg(to_jsonb(top_services_by_avg)), '[]'::jsonb) from top_services_by_avg),
    'expenses_current_month_cents', (select total from expenses_period),
    'clients', (select to_jsonb(client_stats) from client_stats),
    'pending_unbilled_past', (select cnt from pending_visits),
    'retention', (
      select jsonb_build_object(
        'prev_month_clients', prev_clients,
        'retained_in_current_month', retained,
        'rate_pct', case when prev_clients > 0
          then round(100.0 * retained / prev_clients)
          else null end
      )
      from retention_calc
    ),
    'churn', (
      select jsonb_build_object(
        'inactive_30_90d', churned,
        'denominator', denom,
        'rate_pct', case when denom > 0
          then round(100.0 * churned / denom)
          else null end
      )
      from churn_calc
    ),
    'new_vs_returning', (
      select to_jsonb(new_vs_returning) from new_vs_returning
    ),
    'staff_list', (select coalesce(jsonb_agg(to_jsonb(staff_list)), '[]'::jsonb) from staff_list),
    'services_list', (select coalesce(jsonb_agg(to_jsonb(services_list)), '[]'::jsonb) from services_list),
    'expense_categories', (select coalesce(jsonb_agg(to_jsonb(expense_categories_list)), '[]'::jsonb) from expense_categories_list),
    'cash_registers', (select coalesce(jsonb_agg(to_jsonb(cash_registers_list)), '[]'::jsonb) from cash_registers_list),
    'problems', (select data from problems_data)
  ) into result;

  return result;
end;
$$;

revoke all on function public.ai_salon_snapshot(uuid) from public;
grant execute on function public.ai_salon_snapshot(uuid) to authenticated, service_role;
