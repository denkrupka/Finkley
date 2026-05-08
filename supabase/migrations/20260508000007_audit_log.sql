-- TASK-39 — Audit log: запись всех значимых действий пользователей салона
-- (вход, изменение визита/расхода/настроек, приглашения и т.п.). Видит
-- только owner/admin. Хранится 365 дней (cleanup cron — тех.долг).

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid references public.salons(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,           -- 'visit.create', 'expense.update', 'team.invite' etc.
  entity_type text,                -- 'visit' / 'expense' / 'staff' / 'salon' / 'invitation'
  entity_id text,                  -- uuid строкой (entity может быть из разных таблиц)
  payload jsonb,                   -- detail (changed fields, old/new values)
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_salon_created
  on public.audit_log(salon_id, created_at desc);
create index if not exists idx_audit_user_created
  on public.audit_log(user_id, created_at desc);

alter table public.audit_log enable row level security;

-- Только admin/owner видит лог салона
create policy "audit read by admin" on public.audit_log for select using (
  salon_id is not null and public.is_salon_admin(salon_id)
);

-- Inserts только через триггеры с service_role (фактически — bypass RLS)
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;

-- =============================================================================
-- Универсальные триггеры на ключевые таблицы.
-- =============================================================================

create or replace function public.audit_visits_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
  v_payload jsonb;
begin
  if TG_OP = 'INSERT' then
    v_action := 'visit.create';
    v_payload := jsonb_build_object(
      'amount_cents', new.amount_cents,
      'staff_id', new.staff_id,
      'visit_at', new.visit_at,
      'source', new.source
    );
    insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
    values (new.salon_id, new.created_by, v_action, 'visit', new.id::text, v_payload);
  elsif TG_OP = 'UPDATE' then
    -- логируем только если поменялись финансовые поля или статус
    if old.amount_cents is distinct from new.amount_cents
       or old.tip_cents is distinct from new.tip_cents
       or old.discount_cents is distinct from new.discount_cents
       or old.status is distinct from new.status
       or old.payment_method is distinct from new.payment_method
       or (old.deleted_at is null) is distinct from (new.deleted_at is null) then
      v_action := case when new.deleted_at is not null and old.deleted_at is null
                       then 'visit.delete'
                       else 'visit.update' end;
      v_payload := jsonb_build_object(
        'old', jsonb_build_object(
          'amount_cents', old.amount_cents,
          'status', old.status,
          'payment_method', old.payment_method
        ),
        'new', jsonb_build_object(
          'amount_cents', new.amount_cents,
          'status', new.status,
          'payment_method', new.payment_method
        )
      );
      insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
      values (new.salon_id, auth.uid(), v_action, 'visit', new.id::text, v_payload);
    end if;
  end if;
  return null;
end;
$$;

create trigger trg_audit_visits
  after insert or update on public.visits
  for each row execute procedure public.audit_visits_change();

create or replace function public.audit_expenses_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_action text;
begin
  if TG_OP = 'INSERT' then
    v_action := 'expense.create';
    insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
    values (
      new.salon_id, new.created_by, v_action, 'expense', new.id::text,
      jsonb_build_object('amount_cents', new.amount_cents, 'category_id', new.category_id)
    );
  elsif TG_OP = 'UPDATE' and (
    old.amount_cents is distinct from new.amount_cents
    or (old.deleted_at is null) is distinct from (new.deleted_at is null)
  ) then
    v_action := case when new.deleted_at is not null and old.deleted_at is null
                     then 'expense.delete' else 'expense.update' end;
    insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
    values (
      new.salon_id, auth.uid(), v_action, 'expense', new.id::text,
      jsonb_build_object('old_amount', old.amount_cents, 'new_amount', new.amount_cents)
    );
  end if;
  return null;
end;
$$;

create trigger trg_audit_expenses
  after insert or update on public.expenses
  for each row execute procedure public.audit_expenses_change();

create or replace function public.audit_members_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
    values (
      new.salon_id, auth.uid(), 'team.member_added', 'member', new.id::text,
      jsonb_build_object('role', new.role, 'added_user_id', new.user_id)
    );
  elsif TG_OP = 'UPDATE' and old.role is distinct from new.role then
    insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
    values (
      new.salon_id, auth.uid(), 'team.role_changed', 'member', new.id::text,
      jsonb_build_object('old_role', old.role, 'new_role', new.role, 'target_user_id', new.user_id)
    );
  elsif TG_OP = 'DELETE' then
    insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
    values (
      old.salon_id, auth.uid(), 'team.member_removed', 'member', old.id::text,
      jsonb_build_object('role', old.role, 'removed_user_id', old.user_id)
    );
  end if;
  return null;
end;
$$;

create trigger trg_audit_members
  after insert or update or delete on public.salon_members
  for each row execute procedure public.audit_members_change();

create or replace function public.audit_invitations_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
    values (
      new.salon_id, new.invited_by, 'team.invitation_sent', 'invitation', new.id::text,
      jsonb_build_object('email', new.email, 'role', new.role)
    );
  elsif TG_OP = 'UPDATE' then
    if new.accepted_at is not null and old.accepted_at is null then
      insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
      values (
        new.salon_id, new.accepted_by, 'team.invitation_accepted', 'invitation', new.id::text,
        jsonb_build_object('email', new.email, 'role', new.role)
      );
    elsif new.cancelled_at is not null and old.cancelled_at is null then
      insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
      values (
        new.salon_id, auth.uid(), 'team.invitation_cancelled', 'invitation', new.id::text,
        jsonb_build_object('email', new.email)
      );
    end if;
  end if;
  return null;
end;
$$;

create trigger trg_audit_invitations
  after insert or update on public.salon_invitations
  for each row execute procedure public.audit_invitations_change();

create or replace function public.audit_salons_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'UPDATE' and (
    old.name is distinct from new.name
    or old.timezone is distinct from new.timezone
    or old.currency is distinct from new.currency
    or (old.deleted_at is null) is distinct from (new.deleted_at is null)
  ) then
    insert into public.audit_log(salon_id, user_id, action, entity_type, entity_id, payload)
    values (
      new.id, auth.uid(),
      case when new.deleted_at is not null and old.deleted_at is null
           then 'salon.deleted' else 'salon.updated' end,
      'salon', new.id::text,
      jsonb_build_object(
        'old_name', old.name, 'new_name', new.name,
        'old_currency', old.currency, 'new_currency', new.currency
      )
    );
  end if;
  return null;
end;
$$;

create trigger trg_audit_salons
  after update on public.salons
  for each row execute procedure public.audit_salons_change();
