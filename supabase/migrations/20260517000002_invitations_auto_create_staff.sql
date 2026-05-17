-- ─────────────────────────────────────────────────────────────────────────────
-- 20260517000002_invitations_auto_create_staff.sql
--
-- Multi-role support: пользователь может быть «Админ-Мастер» (или
-- «Бухгалтер-Мастер») — это admin (или accountant) роль + привязка к
-- staff-карточке. accept_salon_invitation сейчас создаёт staff row
-- автоматически ТОЛЬКО при role='staff'. Расширяем: если invitation
-- имеет флаг auto_create_staff=true ИЛИ staff_id уже задан — создаём/
-- привязываем staff независимо от role.
--
-- Schema-impact: одна новая колонка salon_invitations.auto_create_staff
-- (default false → старые инвайты ведут себя как раньше).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.salon_invitations
  add column if not exists auto_create_staff boolean not null default false;

comment on column public.salon_invitations.auto_create_staff is
  'true → accept_salon_invitation создаст новую staff-карточку для приглашённого '
  'даже если role не staff (multi-role «Админ-Мастер» и т.п.).';

-- Обновляем accept_salon_invitation: учитываем флаг.
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

  if exists (select 1 from public.salon_members where salon_id = v_inv.salon_id and user_id = v_user) then
    update public.salon_invitations
      set accepted_at = now(), accepted_by = v_user
      where id = v_inv.id;
    return jsonb_build_object('ok', true, 'salon_id', v_inv.salon_id, 'already_member', true);
  end if;

  -- Auto-staff: если staff_id явно передан — используем; иначе создаём
  -- если role='staff' ИЛИ auto_create_staff=true (multi-role flow).
  v_staff_id := v_inv.staff_id;

  if v_staff_id is null and (v_inv.role = 'staff' or v_inv.auto_create_staff) then
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
