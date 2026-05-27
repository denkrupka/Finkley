-- =============================================================================
-- T30 — salon_members.permissions jsonb + invitations.permissions
-- =============================================================================
-- Per-member matrix прав по разделам портала. Структура:
--   {
--     "income.visits": "edit",      // <category>.<subcategory>
--     "income.*":      "view",      // wildcard на всю категорию
--     "settings.profile_user": "edit"
--   }
-- Значения: 'view' | 'edit'. Отсутствие ключа = нет доступа.
--
-- Раздел/подраздел определяется фронтом (PermissionsBlock CATEGORIES). При
-- accept_invitation матрица копируется из invitation в salon_members.
-- =============================================================================

alter table public.salon_members
  add column if not exists permissions jsonb;

alter table public.salon_invitations
  add column if not exists permissions jsonb;

comment on column public.salon_members.permissions is
  'T30 — матрица прав { "<cat>.<sub>": "view"|"edit" }. NULL = дефолт по роли (см. PermissionsBlock.presetForRole).';

comment on column public.salon_invitations.permissions is
  'T30 — матрица прав которая копируется в salon_members при accept_invitation.';

-- ============================================================
-- Расширяем accept_salon_invitation: копируем permissions
-- ============================================================

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

  v_full_name := trim(coalesce(v_inv.invited_first_name, '') || ' ' || coalesce(v_inv.invited_last_name, ''));
  if v_full_name <> '' or v_inv.invited_phone is not null then
    update public.profiles
       set full_name = coalesce(nullif(full_name, ''), nullif(v_full_name, '')),
           phone = coalesce(phone, v_inv.invited_phone)
     where id = v_user;
  end if;

  -- Уже member? Обновим permissions если они пришли в invitation.
  if exists (select 1 from public.salon_members where salon_id = v_inv.salon_id and user_id = v_user) then
    if v_inv.permissions is not null then
      update public.salon_members
         set permissions = v_inv.permissions
       where salon_id = v_inv.salon_id and user_id = v_user;
    end if;
    update public.salon_invitations
      set accepted_at = now(), accepted_by = v_user
      where id = v_inv.id;
    return jsonb_build_object('ok', true, 'salon_id', v_inv.salon_id, 'already_member', true);
  end if;

  v_staff_id := v_inv.staff_id;

  if v_inv.role = 'staff' and v_staff_id is null then
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

  -- T30 — переносим permissions из приглашения в membership.
  insert into public.salon_members (salon_id, user_id, role, staff_id, permissions, joined_at)
  values (v_inv.salon_id, v_user, v_inv.role, v_staff_id, v_inv.permissions, now());

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
