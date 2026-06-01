-- tracking_events: трекинг действий пользователей для super-admin аналитики.
--
-- Цель: понять что в портале реально используется, какие страницы популярны,
-- где юзеры теряются в онбординге.
--
-- Schema:
--   event_type — 'page_view' | 'action' | 'onboarding_step' | 'feature_open'
--   path — для page_view: route path (например '/salon/abc/visits')
--          для action: action key ('expense_save', 'visit_create')
--          для onboarding_step: step id ('salon', 'staff', 'services', ...)
--   metadata — произвольный jsonb с контекстом
--
-- Hot indexes для агрегаций admin-tracking-stats RPC.

create table if not exists public.tracking_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  salon_id uuid references public.salons(id) on delete cascade,
  event_type text not null check (event_type in ('page_view', 'action', 'onboarding_step', 'feature_open')),
  path text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_tracking_events_created
  on public.tracking_events(created_at desc);
create index if not exists idx_tracking_events_user
  on public.tracking_events(user_id, created_at desc);
create index if not exists idx_tracking_events_salon
  on public.tracking_events(salon_id, created_at desc);
create index if not exists idx_tracking_events_type_path
  on public.tracking_events(event_type, path);

-- RLS: юзер видит только свои события (для самопроверки), super-admin видит всё.
alter table public.tracking_events enable row level security;

create policy "tracking_self_select" on public.tracking_events
  for select to authenticated
  using (user_id = auth.uid());

create policy "tracking_super_admin_select" on public.tracking_events
  for select to authenticated
  using (
    exists (
      select 1 from public.app_admins a
      where a.user_id = auth.uid() and a.is_super = true
    )
  );

create policy "tracking_insert_self" on public.tracking_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- =============================================================================
-- RPC: admin_tracking_pages_stats — агрегация по path для подвкладки Портал.
-- =============================================================================
create or replace function public.admin_tracking_pages_stats(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_user_id uuid default null,
  p_salon_id uuid default null
)
returns table (
  path text,
  total_clicks bigint,
  unique_users bigint,
  unique_salons bigint,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Super-admin gate
  if not exists (
    select 1 from public.app_admins
    where user_id = auth.uid() and is_super = true
  ) then
    raise exception 'forbidden: super_admin only' using errcode = '42501';
  end if;

  return query
    select
      e.path,
      count(*)::bigint as total_clicks,
      count(distinct e.user_id)::bigint as unique_users,
      count(distinct e.salon_id)::bigint as unique_salons,
      max(e.created_at) as last_seen_at
    from public.tracking_events e
    where e.event_type = 'page_view'
      and (p_date_from is null or e.created_at >= p_date_from)
      and (p_date_to is null or e.created_at <= p_date_to)
      and (p_user_id is null or e.user_id = p_user_id)
      and (p_salon_id is null or e.salon_id = p_salon_id)
    group by e.path
    order by total_clicks desc
    limit 500;
end;
$$;

revoke all on function public.admin_tracking_pages_stats(timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.admin_tracking_pages_stats(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- =============================================================================
-- RPC: admin_tracking_onboarding_funnel — funnel по step_id для Онбординг таба.
-- =============================================================================
create or replace function public.admin_tracking_onboarding_funnel(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns table (
  step_id text,
  reached bigint,
  completed bigint,
  skipped bigint,
  drop_off bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.app_admins
    where user_id = auth.uid() and is_super = true
  ) then
    raise exception 'forbidden: super_admin only' using errcode = '42501';
  end if;

  return query
    with steps as (
      select
        e.path as step_id,
        e.user_id,
        max(case when e.metadata->>'action' = 'enter' then 1 else 0 end) as did_enter,
        max(case when e.metadata->>'action' = 'complete' then 1 else 0 end) as did_complete,
        max(case when e.metadata->>'action' = 'skip' then 1 else 0 end) as did_skip
      from public.tracking_events e
      where e.event_type = 'onboarding_step'
        and (p_date_from is null or e.created_at >= p_date_from)
        and (p_date_to is null or e.created_at <= p_date_to)
      group by e.path, e.user_id
    )
    select
      s.step_id,
      sum(s.did_enter)::bigint as reached,
      sum(s.did_complete)::bigint as completed,
      sum(s.did_skip)::bigint as skipped,
      (sum(s.did_enter) - sum(s.did_complete) - sum(s.did_skip))::bigint as drop_off
    from steps s
    group by s.step_id
    order by reached desc;
end;
$$;

revoke all on function public.admin_tracking_onboarding_funnel(timestamptz, timestamptz) from public;
grant execute on function public.admin_tracking_onboarding_funnel(timestamptz, timestamptz) to authenticated;

-- =============================================================================
-- RPC: admin_tracking_overview — top KPI для подвкладки Статистика.
-- =============================================================================
create or replace function public.admin_tracking_overview(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns table (
  total_events bigint,
  total_users bigint,
  total_salons bigint,
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
  v_top record;
  v_least record;
begin
  if not exists (
    select 1 from public.app_admins
    where user_id = auth.uid() and is_super = true
  ) then
    raise exception 'forbidden: super_admin only' using errcode = '42501';
  end if;

  select e.path, count(*) as cnt into v_top
    from public.tracking_events e
    where e.event_type = 'page_view'
      and (p_date_from is null or e.created_at >= p_date_from)
      and (p_date_to is null or e.created_at <= p_date_to)
    group by e.path
    order by cnt desc limit 1;

  select e.path, count(*) as cnt into v_least
    from public.tracking_events e
    where e.event_type = 'page_view'
      and (p_date_from is null or e.created_at >= p_date_from)
      and (p_date_to is null or e.created_at <= p_date_to)
    group by e.path
    order by cnt asc limit 1;

  return query
    select
      (select count(*) from public.tracking_events e
        where (p_date_from is null or e.created_at >= p_date_from)
          and (p_date_to is null or e.created_at <= p_date_to))::bigint,
      (select count(distinct user_id) from public.tracking_events e
        where (p_date_from is null or e.created_at >= p_date_from)
          and (p_date_to is null or e.created_at <= p_date_to))::bigint,
      (select count(distinct salon_id) from public.tracking_events e
        where (p_date_from is null or e.created_at >= p_date_from)
          and (p_date_to is null or e.created_at <= p_date_to))::bigint,
      v_top.path,
      v_top.cnt::bigint,
      v_least.path,
      v_least.cnt::bigint;
end;
$$;

revoke all on function public.admin_tracking_overview(timestamptz, timestamptz) from public;
grant execute on function public.admin_tracking_overview(timestamptz, timestamptz) to authenticated;
