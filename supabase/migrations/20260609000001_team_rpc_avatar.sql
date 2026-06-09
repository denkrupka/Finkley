-- =============================================================================
-- 20260609000001_team_rpc_avatar.sql
-- =============================================================================
-- Карточка участника команды теперь редактируется сразу (без read-only шага)
-- и поддерживает аватар. Чтобы модалка показывала текущий аватар члена,
-- list_salon_team должен возвращать profiles.avatar_url.
--
-- Меняется return type функции → требуется DROP + CREATE (CREATE OR REPLACE
-- не умеет менять сигнатуру RETURNS TABLE).
-- =============================================================================

drop function if exists public.list_salon_team(uuid);

create function public.list_salon_team(p_salon_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  phone text,
  avatar_url text,
  role salon_role,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.salon_members m
     where m.salon_id = p_salon_id
       and m.user_id = auth.uid()
       and m.role in ('owner','admin')
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    sm.user_id,
    u.email::text as email,
    p.full_name,
    p.phone,
    p.avatar_url,
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
