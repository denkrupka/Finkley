-- Fix: admin_helpdesk_access падал с "column reference 'role' is ambiguous",
-- потому что `returns table (..., role text)` создаёт OUT-параметр role,
-- который коллизирует с `salon_members.role`. Перенаименовываем output
-- в `granted_role` и квалифицируем все ссылки на колонки таблицы.

drop function if exists public.admin_helpdesk_access(uuid);

create or replace function public.admin_helpdesk_access(p_salon_id uuid)
returns table (granted boolean, granted_role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_existing_role text;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.app_admins aa
    where aa.user_id = v_caller and aa.is_super = true
  ) then
    raise exception 'forbidden: super_admin only' using errcode = '42501';
  end if;

  if not exists (select 1 from public.salons s where s.id = p_salon_id) then
    raise exception 'salon_not_found' using errcode = '42704';
  end if;

  select sm.role::text into v_existing_role
    from public.salon_members sm
    where sm.salon_id = p_salon_id and sm.user_id = v_caller;

  if v_existing_role is null then
    insert into public.salon_members(salon_id, user_id, role)
    values (p_salon_id, v_caller, 'admin');
    return query select true as granted, 'admin'::text as granted_role;
  elsif v_existing_role not in ('owner', 'admin') then
    update public.salon_members sm
       set role = 'admin'
     where sm.salon_id = p_salon_id and sm.user_id = v_caller;
    return query select true as granted, 'admin'::text as granted_role;
  else
    return query select false as granted, v_existing_role as granted_role;
  end if;
end;
$$;

revoke all on function public.admin_helpdesk_access(uuid) from public;
grant execute on function public.admin_helpdesk_access(uuid) to authenticated;
