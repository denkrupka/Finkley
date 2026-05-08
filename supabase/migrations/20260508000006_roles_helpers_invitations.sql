-- TASK-37 + TASK-38 — Roles, permissions, email invitations.
--
-- Роли (уже определены в enum salon_role):
--   owner       — создал салон, полный контроль, единственный кто может
--                 удалить салон, передать ownership, управлять биллингом
--   admin       — полный доступ к данным + управление командой, но НЕ
--                 биллинг/удаление
--   accountant  — read+edit финансовых данных (visits/expenses/payouts/
--                 reports), НЕ управление командой/настройками салона
--   staff       — мастер: видит только свои визиты + клиентов которых
--                 он обслуживал, может добавлять/редактировать свои
--                 визиты. Не видит чужие зарплаты/расходы.
--
-- Связь staff-роли с конкретной staff-записью — через salon_members.staff_id.

-- =============================================================================
-- Helper functions для RLS — security definer чтобы избежать рекурсии
-- =============================================================================

create or replace function public.salon_role_of(p_salon_id uuid)
returns salon_role
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select role from public.salon_members
  where salon_id = p_salon_id and user_id = auth.uid()
  limit 1
$$;

revoke all on function public.salon_role_of(uuid) from public, anon;
grant execute on function public.salon_role_of(uuid) to authenticated, service_role;

create or replace function public.is_salon_admin(p_salon_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.salon_members
    where salon_id = p_salon_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  )
$$;

revoke all on function public.is_salon_admin(uuid) from public, anon;
grant execute on function public.is_salon_admin(uuid) to authenticated, service_role;

create or replace function public.is_salon_owner(p_salon_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.salon_members
    where salon_id = p_salon_id
      and user_id = auth.uid()
      and role = 'owner'
  )
$$;

revoke all on function public.is_salon_owner(uuid) from public, anon;
grant execute on function public.is_salon_owner(uuid) to authenticated, service_role;

-- Какой staff_id привязан к auth.uid() в этом салоне (для staff-роли)
create or replace function public.my_staff_id(p_salon_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select staff_id from public.salon_members
  where salon_id = p_salon_id and user_id = auth.uid()
  limit 1
$$;

revoke all on function public.my_staff_id(uuid) from public, anon;
grant execute on function public.my_staff_id(uuid) to authenticated, service_role;

-- =============================================================================
-- Расширяем RLS на visits — staff видит только свои визиты
-- =============================================================================

drop policy if exists "members access visits" on public.visits;

-- read: admin/accountant видят все, staff — только свои
create policy "visits read by role" on public.visits for select using (
  case
    when public.is_salon_admin(salon_id) then true
    when public.salon_role_of(salon_id) = 'accountant' then true
    when public.salon_role_of(salon_id) = 'staff' then staff_id = public.my_staff_id(salon_id)
    else false
  end
);

-- insert/update/delete: admin/accountant — все. staff — только свои.
create policy "visits write by role" on public.visits for insert with check (
  case
    when public.is_salon_admin(salon_id) then true
    when public.salon_role_of(salon_id) = 'accountant' then true
    when public.salon_role_of(salon_id) = 'staff' then staff_id = public.my_staff_id(salon_id)
    else false
  end
);

create policy "visits update by role" on public.visits for update using (
  case
    when public.is_salon_admin(salon_id) then true
    when public.salon_role_of(salon_id) = 'accountant' then true
    when public.salon_role_of(salon_id) = 'staff' then staff_id = public.my_staff_id(salon_id)
    else false
  end
);

create policy "visits delete by role" on public.visits for delete using (
  case
    when public.is_salon_admin(salon_id) then true
    when public.salon_role_of(salon_id) = 'accountant' then true
    when public.salon_role_of(salon_id) = 'staff' then staff_id = public.my_staff_id(salon_id)
    else false
  end
);

-- =============================================================================
-- Расходы / Зарплаты — только admin/accountant видят
-- staff НЕ должен видеть финансы салона
-- =============================================================================

drop policy if exists "members access expenses" on public.expenses;
create policy "expenses by admin or accountant" on public.expenses for all using (
  public.is_salon_admin(salon_id) or public.salon_role_of(salon_id) = 'accountant'
) with check (
  public.is_salon_admin(salon_id) or public.salon_role_of(salon_id) = 'accountant'
);

-- =============================================================================
-- Settings (salons table) — только admin/owner может update
-- =============================================================================

drop policy if exists "owners can update their salons" on public.salons;
create policy "admins update salon" on public.salons for update using (
  public.is_salon_admin(id)
);

-- Удалять салон может только owner — проверим в RPC delete_salon (есть отдельная)

-- =============================================================================
-- Salon members — admin может приглашать/удалять, owner может назначать admin
-- =============================================================================

-- Расширяем существующую select-policy: admin тоже видит всех members
drop policy if exists "members can see own membership rows" on public.salon_members;
create policy "members visibility" on public.salon_members for select using (
  user_id = auth.uid() or public.is_salon_admin(salon_id)
);

-- Admin может удалить участника (кроме owner; owner неудаляем)
create policy "admins remove members" on public.salon_members for delete using (
  public.is_salon_admin(salon_id) and role <> 'owner'
);

-- Admin может изменить роль участника (но не сделать кого-то owner — это
-- через отдельную RPC transfer_ownership)
create policy "admins update member role" on public.salon_members for update using (
  public.is_salon_admin(salon_id)
) with check (
  public.is_salon_admin(salon_id) and role <> 'owner'
);

-- =============================================================================
-- TASK-38 — Email invitations
-- =============================================================================

create table if not exists public.salon_invitations (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  email text not null,
  role salon_role not null default 'staff',
  staff_id uuid references public.staff(id) on delete set null,
  token text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz
);

create index if not exists idx_salon_invitations_token on public.salon_invitations(token);
create index if not exists idx_salon_invitations_salon on public.salon_invitations(salon_id);
create unique index if not exists ux_salon_invitations_pending
  on public.salon_invitations(salon_id, lower(email))
  where accepted_at is null and cancelled_at is null;

alter table public.salon_invitations enable row level security;

-- Admin/owner салона видит все приглашения салона
create policy "admins read invitations" on public.salon_invitations for select using (
  public.is_salon_admin(salon_id)
);

-- Admin/owner может создать приглашение
create policy "admins create invitations" on public.salon_invitations for insert with check (
  public.is_salon_admin(salon_id) and invited_by = auth.uid()
);

-- Admin/owner может отменить приглашение
create policy "admins cancel invitations" on public.salon_invitations for update using (
  public.is_salon_admin(salon_id)
);

grant select, insert, update on public.salon_invitations to authenticated;
grant all on public.salon_invitations to service_role;

-- RPC: принять приглашение по токену. Через security definer,
-- доступно anon (т.к. юзер кликает на ссылку до login — тогда он
-- регистрируется и потом дёргает RPC).
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

  -- Уже member?
  if exists (select 1 from public.salon_members where salon_id = v_inv.salon_id and user_id = v_user) then
    -- помечаем приглашение использованным, но не дублируем membership
    update public.salon_invitations
      set accepted_at = now(), accepted_by = v_user
      where id = v_inv.id;
    return jsonb_build_object('ok', true, 'salon_id', v_inv.salon_id, 'already_member', true);
  end if;

  -- Создаём membership
  insert into public.salon_members (salon_id, user_id, role, staff_id, joined_at)
  values (v_inv.salon_id, v_user, v_inv.role, v_inv.staff_id, now());

  update public.salon_invitations
    set accepted_at = now(), accepted_by = v_user
    where id = v_inv.id;

  return jsonb_build_object('ok', true, 'salon_id', v_inv.salon_id);
end;
$$;

revoke all on function public.accept_salon_invitation(text) from public, anon;
grant execute on function public.accept_salon_invitation(text) to authenticated, service_role;
