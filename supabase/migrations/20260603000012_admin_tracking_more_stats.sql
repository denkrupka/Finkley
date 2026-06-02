-- Дополнения для admin tracking:
-- 1. admin_list_all_salons() — super-admin RPC возвращающая ВСЕ салоны
--    (включая те где он не member). Нужно для dropdown-фильтра.
-- 2. admin_tracking_timeline() — events grouped по часам/дням
--    для маленького графика активности.
-- 3. admin_tracking_top_users() — топ-10 юзеров по активности.
-- 4. admin_tracking_overview_v2() — расширенный overview с разбивкой по
--    событиям и сегодня/неделя/всё время.

-- =====================================================================
-- 1. List all salons for super-admin
-- =====================================================================
create or replace function public.admin_list_all_salons()
returns table (id uuid, name text, owner_email text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.app_admins aa
    where aa.user_id = auth.uid() and aa.is_super = true
  ) then
    raise exception 'forbidden: super_admin only' using errcode = '42501';
  end if;

  return query
  select
    s.id,
    s.name,
    (
      select au.email::text
      from public.salon_members sm
      join auth.users au on au.id = sm.user_id
      where sm.salon_id = s.id and sm.role = 'owner'
      order by sm.created_at asc
      limit 1
    ) as owner_email,
    s.created_at
  from public.salons s
  where s.deleted_at is null
  order by s.name asc;
end;
$$;

revoke all on function public.admin_list_all_salons() from public;
grant execute on function public.admin_list_all_salons() to authenticated;

-- =====================================================================
-- 2. Timeline — events grouped по дням (для графика)
-- =====================================================================
create or replace function public.admin_tracking_timeline(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_salon_id uuid default null
)
returns table (
  bucket date,
  total_events bigint,
  unique_users bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.app_admins aa
    where aa.user_id = auth.uid() and aa.is_super = true
  ) then
    raise exception 'forbidden: super_admin only' using errcode = '42501';
  end if;

  return query
  select
    (te.created_at at time zone 'UTC')::date as bucket,
    count(*) as total_events,
    count(distinct te.user_id) as unique_users
  from public.tracking_events te
  where (p_date_from is null or te.created_at >= p_date_from)
    and (p_date_to is null or te.created_at <= p_date_to)
    and (p_salon_id is null or te.salon_id = p_salon_id)
    and te.event_type = 'page_view'
  group by bucket
  order by bucket asc;
end;
$$;

revoke all on function public.admin_tracking_timeline(timestamptz, timestamptz, uuid) from public;
grant execute on function public.admin_tracking_timeline(timestamptz, timestamptz, uuid) to authenticated;

-- =====================================================================
-- 3. Top users по активности
-- =====================================================================
create or replace function public.admin_tracking_top_users(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_salon_id uuid default null,
  p_limit int default 10
)
returns table (
  user_id uuid,
  user_email text,
  total_events bigint,
  unique_pages bigint,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.app_admins aa
    where aa.user_id = auth.uid() and aa.is_super = true
  ) then
    raise exception 'forbidden: super_admin only' using errcode = '42501';
  end if;

  return query
  select
    te.user_id,
    coalesce(au.email::text, '(удалён)') as user_email,
    count(*) as total_events,
    count(distinct te.path) as unique_pages,
    max(te.created_at) as last_seen_at
  from public.tracking_events te
  left join auth.users au on au.id = te.user_id
  where (p_date_from is null or te.created_at >= p_date_from)
    and (p_date_to is null or te.created_at <= p_date_to)
    and (p_salon_id is null or te.salon_id = p_salon_id)
    and te.event_type = 'page_view'
    and te.user_id is not null
  group by te.user_id, au.email
  order by total_events desc
  limit p_limit;
end;
$$;

revoke all on function public.admin_tracking_top_users(timestamptz, timestamptz, uuid, int) from public;
grant execute on function public.admin_tracking_top_users(timestamptz, timestamptz, uuid, int) to authenticated;

-- =====================================================================
-- 4. Overview v2 — добавлены today_events, week_events, avg_per_user
-- =====================================================================
drop function if exists public.admin_tracking_overview_v2(timestamptz, timestamptz, uuid);
create or replace function public.admin_tracking_overview_v2(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_salon_id uuid default null
)
returns table (
  total_events bigint,
  total_users bigint,
  total_salons bigint,
  events_today bigint,
  events_week bigint,
  avg_events_per_user numeric,
  top_path text,
  top_path_clicks bigint,
  least_used_path text,
  least_used_path_clicks bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_top_path text;
  v_top_clicks bigint;
  v_least_path text;
  v_least_clicks bigint;
begin
  if not exists (
    select 1 from public.app_admins aa
    where aa.user_id = auth.uid() and aa.is_super = true
  ) then
    raise exception 'forbidden: super_admin only' using errcode = '42501';
  end if;

  -- top + least paths
  select te.path, count(*) into v_top_path, v_top_clicks
  from public.tracking_events te
  where (p_date_from is null or te.created_at >= p_date_from)
    and (p_date_to is null or te.created_at <= p_date_to)
    and (p_salon_id is null or te.salon_id = p_salon_id)
    and te.event_type = 'page_view'
  group by te.path
  order by count(*) desc
  limit 1;

  select te.path, count(*) into v_least_path, v_least_clicks
  from public.tracking_events te
  where (p_date_from is null or te.created_at >= p_date_from)
    and (p_date_to is null or te.created_at <= p_date_to)
    and (p_salon_id is null or te.salon_id = p_salon_id)
    and te.event_type = 'page_view'
  group by te.path
  order by count(*) asc
  limit 1;

  return query
  select
    (select count(*)::bigint from public.tracking_events te
       where (p_date_from is null or te.created_at >= p_date_from)
         and (p_date_to is null or te.created_at <= p_date_to)
         and (p_salon_id is null or te.salon_id = p_salon_id)
         and te.event_type = 'page_view'),
    (select count(distinct te.user_id)::bigint from public.tracking_events te
       where (p_date_from is null or te.created_at >= p_date_from)
         and (p_date_to is null or te.created_at <= p_date_to)
         and (p_salon_id is null or te.salon_id = p_salon_id)
         and te.event_type = 'page_view'),
    (select count(distinct te.salon_id)::bigint from public.tracking_events te
       where (p_date_from is null or te.created_at >= p_date_from)
         and (p_date_to is null or te.created_at <= p_date_to)
         and (p_salon_id is null or te.salon_id = p_salon_id)
         and te.event_type = 'page_view'),
    (select count(*)::bigint from public.tracking_events te
       where te.created_at >= (now() - interval '1 day')
         and (p_salon_id is null or te.salon_id = p_salon_id)
         and te.event_type = 'page_view'),
    (select count(*)::bigint from public.tracking_events te
       where te.created_at >= (now() - interval '7 days')
         and (p_salon_id is null or te.salon_id = p_salon_id)
         and te.event_type = 'page_view'),
    coalesce((
      select round((count(*)::numeric / nullif(count(distinct te.user_id), 0))::numeric, 1)
      from public.tracking_events te
      where (p_date_from is null or te.created_at >= p_date_from)
        and (p_date_to is null or te.created_at <= p_date_to)
        and (p_salon_id is null or te.salon_id = p_salon_id)
        and te.event_type = 'page_view'
    ), 0::numeric),
    coalesce(v_top_path, '—'),
    coalesce(v_top_clicks, 0),
    coalesce(v_least_path, '—'),
    coalesce(v_least_clicks, 0);
end;
$$;

revoke all on function public.admin_tracking_overview_v2(timestamptz, timestamptz, uuid) from public;
grant execute on function public.admin_tracking_overview_v2(timestamptz, timestamptz, uuid) to authenticated;
