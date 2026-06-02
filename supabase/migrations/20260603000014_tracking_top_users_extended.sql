-- Расширение admin_tracking_top_users: добавлены first_name/last_name из
-- profiles и список салонов через salon_members. Также новый RPC
-- admin_tracking_user_pages для модалки (клик по топ-юзеру → разбивка
-- его кликов по страницам).

drop function if exists public.admin_tracking_top_users(timestamptz, timestamptz, uuid, int);

create or replace function public.admin_tracking_top_users(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_salon_id uuid default null,
  p_limit int default 10
)
returns table (
  user_id uuid,
  user_email text,
  first_name text,
  last_name text,
  salon_names text[],
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
    coalesce(p.first_name, '') as first_name,
    coalesce(p.last_name, '') as last_name,
    coalesce(array_agg(distinct s.name) filter (where s.name is not null), '{}'::text[]) as salon_names,
    count(*)::bigint as total_events,
    count(distinct te.path)::bigint as unique_pages,
    max(te.created_at) as last_seen_at
  from public.tracking_events te
  left join auth.users au on au.id = te.user_id
  left join public.profiles p on p.id = te.user_id
  left join public.salon_members sm on sm.user_id = te.user_id
  left join public.salons s on s.id = sm.salon_id and s.deleted_at is null
  where (p_date_from is null or te.created_at >= p_date_from)
    and (p_date_to is null or te.created_at <= p_date_to)
    and (p_salon_id is null or te.salon_id = p_salon_id)
    and te.event_type = 'page_view'
    and te.user_id is not null
  group by te.user_id, au.email, p.first_name, p.last_name
  order by count(*) desc
  limit p_limit;
end;
$$;

revoke all on function public.admin_tracking_top_users(timestamptz, timestamptz, uuid, int) from public;
grant execute on function public.admin_tracking_top_users(timestamptz, timestamptz, uuid, int) to authenticated;


-- Разбивка кликов конкретного юзера по страницам (для модалки).
create or replace function public.admin_tracking_user_pages(
  p_user_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_salon_id uuid default null
)
returns table (
  path text,
  clicks bigint,
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
    te.path,
    count(*)::bigint as clicks,
    max(te.created_at) as last_seen_at
  from public.tracking_events te
  where te.user_id = p_user_id
    and te.event_type = 'page_view'
    and (p_date_from is null or te.created_at >= p_date_from)
    and (p_date_to is null or te.created_at <= p_date_to)
    and (p_salon_id is null or te.salon_id = p_salon_id)
  group by te.path
  order by clicks desc
  limit 200;
end;
$$;

revoke all on function public.admin_tracking_user_pages(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.admin_tracking_user_pages(uuid, timestamptz, timestamptz, uuid) to authenticated;
