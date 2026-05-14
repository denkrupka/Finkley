-- =============================================================================
-- 20260514150000_admin_salon_actions.sql
-- =============================================================================
-- Super-admin actions для салонов:
--   1. salons.blocked_at — мягкая блокировка салона (Q2: вариант A)
--   2. salon_subscriptions: ручное продление демо без Stripe (Q11/Q12):
--      - stripe_* колонки делаем nullable (был not null + unique)
--      - source: 'stripe' | 'manual_admin'
--      - bonus_until: бонусные дни поверх активной Stripe-подписки
--      - granted_by / granted_reason: кто и почему продлил
--
-- «Активен ли салон» теперь = blocked_at is null AND (
--   status IN ('active','past_due') OR
--   (status='trialing' AND trial_ends_at > now()) OR
--   bonus_until > now()
-- )
-- =============================================================================

-- ---- salons.blocked_* ----
alter table public.salons
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text,
  add column if not exists blocked_by uuid references auth.users(id);

create index if not exists idx_salons_blocked_at on public.salons(blocked_at)
  where blocked_at is not null;

-- RLS: пользователи не видят свой салон, если он заблокирован.
-- Тут используем расширение существующей политики — добавим WHERE blocked_at is null
-- в SELECT-политику. Существующая policy "members can read their salons" уже
-- проверяет deleted_at is null; добавляем сюда blocked_at is null.
drop policy if exists "members can read their salons" on public.salons;
create policy "members can read their salons" on public.salons
  for select using (
    id in (select salon_id from public.salon_members where user_id = auth.uid())
    and deleted_at is null
    and blocked_at is null
  );

-- ---- salon_subscriptions: ручные продления ----
alter table public.salon_subscriptions
  alter column stripe_customer_id drop not null,
  alter column stripe_subscription_id drop not null,
  alter column stripe_price_id drop not null;

-- unique constraint stripe_subscription_id → partial unique index (NULL допустим)
do $$
declare
  cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.salon_subscriptions'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) like '%(stripe_subscription_id)%';
  if cname is not null then
    execute format('alter table public.salon_subscriptions drop constraint %I', cname);
  end if;
end$$;

create unique index if not exists salon_subscriptions_stripe_sub_uk
  on public.salon_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.salon_subscriptions
  add column if not exists source text not null default 'stripe',
  add column if not exists bonus_until timestamptz,
  add column if not exists granted_by uuid references auth.users(id),
  add column if not exists granted_reason text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_salon_subscriptions_source'
  ) then
    alter table public.salon_subscriptions
      add constraint chk_salon_subscriptions_source
      check (source in ('stripe', 'manual_admin'));
  end if;
end$$;

create index if not exists idx_salon_subscriptions_bonus_until
  on public.salon_subscriptions(bonus_until)
  where bonus_until is not null;
