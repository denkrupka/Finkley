-- admin_helpdesk_access(salon_id) — super-admin only RPC которая добавляет
-- вызывающего юзера как admin в salon_members. После этого UI редиректит
-- super-admin'a в кабинет владельца, где обычные RLS-политики дают полный
-- доступ.
--
-- Юзер 02.06: «у меня (Супер-Админа) должна быть позиция HelpDesk —
-- нажмая на нее я могу попасть в кабинет владельца чтобы помочь ему
-- удалённо с полным доступом».
--
-- Security: SECURITY DEFINER + проверка app_role='super_admin' в самой функции.
-- Не SECURITY INVOKER — нам надо обходить RLS на salon_members.
--
-- Идемпотентно: если уже есть entry — обновляем role до 'admin' (на случай
-- если super-admin был ранее invited как 'member' или 'viewer').

create or replace function public.admin_helpdesk_access(p_salon_id uuid)
returns table (granted boolean, role text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_existing_role text;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Проверка app_role super_admin (profiles.app_role)
  select app_role into v_caller_role
    from public.profiles where user_id = v_caller;
  if v_caller_role is null or v_caller_role <> 'super_admin' then
    raise exception 'forbidden: super_admin only' using errcode = '42501';
  end if;

  if not exists (select 1 from public.salons where id = p_salon_id) then
    raise exception 'salon_not_found' using errcode = '42704';
  end if;

  -- Idempotent upsert
  select role::text into v_existing_role
    from public.salon_members
    where salon_id = p_salon_id and user_id = v_caller;

  if v_existing_role is null then
    insert into public.salon_members(salon_id, user_id, role)
    values (p_salon_id, v_caller, 'admin');
    return query select true as granted, 'admin'::text;
  elsif v_existing_role not in ('owner', 'admin') then
    update public.salon_members
       set role = 'admin'
     where salon_id = p_salon_id and user_id = v_caller;
    return query select true, 'admin'::text;
  else
    return query select false, v_existing_role;
  end if;
end;
$$;

revoke all on function public.admin_helpdesk_access(uuid) from public;
grant execute on function public.admin_helpdesk_access(uuid) to authenticated;
