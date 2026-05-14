-- =============================================================================
-- 20260515000004_accept_invite_auto_staff.sql
-- =============================================================================
-- Image #28/#27. Раньше в UI invite-формы было поле «Связать с мастером»,
-- через которое owner выбирал staff row для нового сотрудника. По ТЗ владельца
-- это поле убрано (мастера управляются в Справочнике, не в Команде). Чтобы
-- staff-роль продолжала работать (зарплата, отчёт по мастерам), accept-invite
-- сам создаёт staff row если её ещё нет.
--
-- Логика:
--   - role='staff' AND staff_id IS NULL → создаём staff(salon_id, full_name)
--   - full_name берём из приглашения (invited_first_name + last_name) или из
--     profile приглашённого, fallback на email
--   - связываем salon_members.staff_id с новой строкой
-- =============================================================================

create or replace function public.accept_salon_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_inv record;
  v_email text;
  v_full_name text;
  v_staff_id uuid;
  v_profile_full_name text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'auth_required');
  end if;

  select email into v_email from auth.users where id = v_user;

  select * into v_inv from public.salon_invitations
  where token = p_token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_found');
  end if;
  if v_inv.accepted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_accepted');
  end if;
  if v_inv.cancelled_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invitation_cancelled');
  end if;
  if v_inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'invitation_expired');
  end if;
  if lower(v_inv.email) <> lower(v_email) then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;

  -- Применяем имя/фамилия/телефон из приглашения на profile приглашённого.
  -- COALESCE сохраняет уже введённое юзером значение.
  v_full_name := trim(coalesce(v_inv.invited_first_name, '') || ' ' || coalesce(v_inv.invited_last_name, ''));
  if v_full_name <> '' or v_inv.invited_phone is not null then
    update public.profiles
       set full_name = coalesce(nullif(full_name, ''), nullif(v_full_name, '')),
           phone = coalesce(phone, v_inv.invited_phone)
     where id = v_user;
  end if;

  -- Уже member?
  if exists (select 1 from public.salon_members where salon_id = v_inv.salon_id and user_id = v_user) then
    update public.salon_invitations
      set accepted_at = now(), accepted_by = v_user
      where id = v_inv.id;
    return jsonb_build_object('ok', true, 'salon_id', v_inv.salon_id, 'already_member', true);
  end if;

  -- Auto-staff для role='staff'. Если invitation уже привязал staff_id —
  -- используем его; иначе создаём новую staff row. Имя — из приглашения,
  -- fallback на profile.full_name, fallback на email-локальную часть.
  v_staff_id := v_inv.staff_id;

  if v_inv.role = 'staff' and v_staff_id is null then
    -- Имя в порядке убывания приоритета
    select full_name into v_profile_full_name from public.profiles where id = v_user;

    insert into public.staff (salon_id, full_name)
    values (
      v_inv.salon_id,
      coalesce(
        nullif(v_full_name, ''),
        nullif(v_profile_full_name, ''),
        split_part(v_email, '@', 1),
        'Новый мастер'
      )
    )
    returning id into v_staff_id;
  end if;

  -- Создаём membership
  insert into public.salon_members (salon_id, user_id, role, staff_id, joined_at)
  values (v_inv.salon_id, v_user, v_inv.role, v_staff_id, now());

  update public.salon_invitations
    set accepted_at = now(), accepted_by = v_user
    where id = v_inv.id;

  return jsonb_build_object(
    'ok', true,
    'salon_id', v_inv.salon_id,
    'staff_id', v_staff_id
  );
end;
$$;

revoke all on function public.accept_salon_invitation(text) from public, anon;
grant execute on function public.accept_salon_invitation(text) to authenticated, service_role;
