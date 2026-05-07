-- Critical security hardening: SECURITY DEFINER функции наследуют GRANT EXECUTE
-- от PUBLIC role в Postgres по умолчанию (anon role в Supabase = неавторизованный
-- юзер). Это значит **anon мог вызвать наши internal cron-функции** через REST
-- API: /rest/v1/rpc/cron_run_booksy_syncs, /rest/v1/rpc/process_weekly_digests,
-- /rest/v1/rpc/ai_salon_snapshot. Для функций, которые читают данные через
-- security definer, это эффективно RLS-bypass.
--
-- Фикс:
--  1. Cron-функции: только service_role / postgres
--  2. ai_salon_snapshot: authenticated, но добавляем membership-check внутрь
--     (security definer обходит RLS на visits/clients/staff)
--  3. set_updated_at — trigger function, никому grant не нужен
--  4. handle_new_user — trigger function на auth.users INSERT, та же история

-- 1. Cron-функции — только сервис может вызывать
revoke all on function public.cron_run_booksy_syncs() from public, anon, authenticated;
revoke all on function public.process_weekly_digests() from public, anon, authenticated;

-- 2. ai_salon_snapshot — добавляем явную проверку членства
create or replace function public.ai_salon_snapshot(p_salon_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_cur_start timestamptz := date_trunc('month', v_now);
  v_prev_start timestamptz := v_cur_start - interval '1 month';
  v_prev_end   timestamptz := v_cur_start;
  result jsonb;
begin
  -- Без membership check security definer обходит RLS — каждый
  -- авторизованный юзер мог бы спросить snapshot чужого салона.
  if v_user is null then
    raise exception 'auth_required';
  end if;
  if not exists (
    select 1 from public.salon_members
    where salon_id = p_salon_id and user_id = v_user
  ) then
    raise exception 'not_a_member';
  end if;

  with cur_period as (
    select
      coalesce(sum(amount_cents), 0) as revenue,
      count(*) as visits,
      coalesce(avg(amount_cents), 0) as avg_ticket
    from visits
    where salon_id = p_salon_id and deleted_at is null
      and status = 'paid'
      and visit_at >= v_cur_start and visit_at < v_now
  ),
  prev_period as (
    select
      coalesce(sum(amount_cents), 0) as revenue,
      count(*) as visits
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
  expenses_period as (
    select coalesce(sum(amount_cents), 0) as total
    from expenses
    where salon_id = p_salon_id and deleted_at is null
      and incurred_at >= v_cur_start::date and incurred_at < v_now::date + 1
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
  )
  select jsonb_build_object(
    'period', jsonb_build_object('current_month_start', v_cur_start, 'now', v_now),
    'current_month', (select to_jsonb(cur_period) from cur_period),
    'prev_month', (select to_jsonb(prev_period) from prev_period),
    'top_staff', (select coalesce(jsonb_agg(to_jsonb(top_staff)), '[]'::jsonb) from top_staff),
    'top_services', (select coalesce(jsonb_agg(to_jsonb(top_services)), '[]'::jsonb) from top_services),
    'expenses_current_month_cents', (select total from expenses_period),
    'clients', (select to_jsonb(client_stats) from client_stats),
    'pending_unbilled_past', (select cnt from pending_visits)
  ) into result;

  return result;
end;
$$;

revoke all on function public.ai_salon_snapshot(uuid) from public, anon;
grant execute on function public.ai_salon_snapshot(uuid) to authenticated, service_role;
