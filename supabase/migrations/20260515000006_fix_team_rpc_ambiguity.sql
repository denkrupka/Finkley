-- =============================================================================
-- 20260515000006_fix_team_rpc_ambiguity.sql
-- =============================================================================
-- Тот же баг что в list_salon_audit (см. 20260515000005): в EXISTS-блоке
-- membership-check `user_id = auth.uid()` неоднозначно с RETURNS TABLE-
-- колонкой `user_id`. Postgres падает с «column reference "user_id" is
-- ambiguous», RPC возвращает 500 → useTeamMembers получает пустой массив
-- → таблица команды показывает только UUID-обрезку без email и имени.
--
-- Фикс: квалифицируем все колонки внутри EXISTS алиасом таблицы.
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
