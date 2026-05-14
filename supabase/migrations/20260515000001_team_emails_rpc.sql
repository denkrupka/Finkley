-- =============================================================================
-- 20260515000001_team_emails_rpc.sql
-- =============================================================================
-- RPC list_salon_team — owner/admin салона может получить email + контакты
-- членов команды (joined через auth.users). Защита: caller должен быть
-- owner/admin того же салона.
-- =============================================================================

create or replace function public.list_salon_team(p_salon_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  phone text,
  role salon_role,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.salon_members
     where salon_id = p_salon_id
       and user_id = auth.uid()
       and role in ('owner','admin')
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    sm.user_id,
    u.email,
    p.full_name,
    p.phone,
    sm.role,
    sm.joined_at
  from public.salon_members sm
  left join auth.users u on u.id = sm.user_id
  left join public.profiles p on p.id = sm.user_id
  where sm.salon_id = p_salon_id;
end;
$$;

revoke all on function public.list_salon_team(uuid) from public, anon;
grant execute on function public.list_salon_team(uuid) to authenticated, service_role;
