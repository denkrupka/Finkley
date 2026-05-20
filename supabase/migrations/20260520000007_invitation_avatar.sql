-- =============================================================================
-- 20260520000007_invitation_avatar.sql
-- =============================================================================
-- Поддержка аватара при отправке приглашения в команду.
-- Поток:
--   1) Owner/admin в TeamPage загружает фото в bucket salon-logos →
--      получает public URL
--   2) Передаёт URL в send-invitation → salon_invitations.invited_avatar_url
--   3) accept_salon_invitation при создании staff → staff.avatar_url := invitation.invited_avatar_url
-- =============================================================================

alter table public.salon_invitations
  add column if not exists invited_avatar_url text;

comment on column public.salon_invitations.invited_avatar_url is
  'Аватар, загруженный при отправке приглашения. После accept копируется в staff.avatar_url.';

-- ─── Обновлённый accept_salon_invitation: копирует avatar_url в staff ────────
create or replace function public.accept_salon_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_email text;
  v_inv record;
  v_staff_id uuid;
  v_full_name text;
  v_profile_full_name text;
begin
  v_user := auth.uid();
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select email into v_email from auth.users where id = v_user;

  select * into v_inv
  from public.salon_invitations
  where token = p_token
    and accepted_at is null
    and cancelled_at is null
    and expires_at > now()
  limit 1;

  if v_inv is null then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_found_or_expired');
  end if;

  if v_email is null or lower(v_email) <> lower(v_inv.email) then
    return jsonb_build_object('ok', false, 'error', 'email_mismatch');
  end if;

  v_full_name := nullif(
    trim(coalesce(v_inv.invited_first_name, '') || ' ' || coalesce(v_inv.invited_last_name, '')),
    ''
  );

  -- Если уже member — просто помечаем accepted
  if exists (
    select 1 from public.salon_members where salon_id = v_inv.salon_id and user_id = v_user
  ) then
    update public.salon_invitations
      set accepted_at = now(), accepted_by = v_user
      where id = v_inv.id;
    return jsonb_build_object('ok', true, 'salon_id', v_inv.salon_id, 'already_member', true);
  end if;

  v_staff_id := v_inv.staff_id;

  if v_inv.role = 'staff' and v_staff_id is null then
    select full_name into v_profile_full_name from public.profiles where id = v_user;
    insert into public.staff (salon_id, full_name, avatar_url, email)
    values (
      v_inv.salon_id,
      coalesce(
        nullif(v_full_name, ''),
        nullif(v_profile_full_name, ''),
        split_part(v_email, '@', 1),
        'Новый мастер'
      ),
      v_inv.invited_avatar_url,
      v_email
    )
    returning id into v_staff_id;
  elsif v_inv.auto_create_staff and v_staff_id is null then
    -- Multi-role (Admin-Master): создаём staff и attaching avatar/email
    select full_name into v_profile_full_name from public.profiles where id = v_user;
    insert into public.staff (salon_id, full_name, avatar_url, email)
    values (
      v_inv.salon_id,
      coalesce(
        nullif(v_full_name, ''),
        nullif(v_profile_full_name, ''),
        split_part(v_email, '@', 1),
        'Новый мастер'
      ),
      v_inv.invited_avatar_url,
      v_email
    )
    returning id into v_staff_id;
  elsif v_staff_id is not null and v_inv.invited_avatar_url is not null then
    -- Существующий staff_id (link) + аватар в приглашении — апдейтим только
    -- если у staff ещё нет аватара (не перезатираем ручную правку).
    update public.staff
      set avatar_url = v_inv.invited_avatar_url
      where id = v_staff_id and avatar_url is null;
  end if;

  insert into public.salon_members (salon_id, user_id, role, staff_id, joined_at)
  values (v_inv.salon_id, v_user, v_inv.role, v_staff_id, now());

  update public.salon_invitations
    set accepted_at = now(), accepted_by = v_user
    where id = v_inv.id;

  return jsonb_build_object('ok', true, 'salon_id', v_inv.salon_id, 'staff_id', v_staff_id);
end;
$$;

revoke all on function public.accept_salon_invitation(text) from public, anon;
grant execute on function public.accept_salon_invitation(text) to authenticated, service_role;
