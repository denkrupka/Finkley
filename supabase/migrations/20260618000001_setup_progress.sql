-- =============================================================================
-- 20260618000001_setup_progress.sql
-- =============================================================================
-- Gamified «Настройка Finkley» — серверный трекинг прогресса первичной
-- настройки + награда «+14 дней демо» за прохождение на 100% в течение 7 дней.
--
-- Принципы (важно):
--   * Completion считается на СЕРВЕРЕ из реальных событий (визиты/расходы/
--     подключённые интеграции), НЕ из кликов клиента.
--   * Награда требует МИНИМУМ реальных данных: >=1 визит И >=1 расход.
--   * Один приз на Stripe customer / NIP (а не на аккаунт) — дедуп через
--     UNIQUE-леджер setup_reward_grants(dedup_key). Сам грант + лимит выдачи
--     живут в edge function claim-setup-reward (service-role + Sentry-лог).
--
-- Награда реализована как salon_subscriptions.bonus_until (тот же механизм,
-- что у ручного admin-продления — миграция 20260514150000). Это работает и
-- для implicit-trial салонов (нет Stripe-подписки), и поверх Stripe-триала,
-- без обращения к Stripe API.
-- =============================================================================

-- ---- salons: трекинг «открыт дашборд» + отметка выданной награды ----
alter table public.salons
  add column if not exists dashboard_opened_at timestamptz,
  add column if not exists setup_reward_granted_at timestamptz;

-- ---- Леджер выданных наград (анти-абуз: один приз на dedup_key) ----
-- dedup_key: 'cus:<stripe_customer_id>' | 'nip:<normalized>' | 'user:<uuid>'
create table if not exists public.setup_reward_grants (
  id          uuid primary key default gen_random_uuid(),
  salon_id    uuid not null references public.salons(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  dedup_key   text not null unique,
  bonus_days  int  not null default 14,
  granted_at  timestamptz not null default now()
);

create index if not exists idx_setup_reward_grants_salon
  on public.setup_reward_grants(salon_id);

alter table public.setup_reward_grants enable row level security;

-- Участники салона могут видеть факт выдачи награды своему салону (для UI).
-- Запись — только service_role (через edge function claim-setup-reward).
create policy "members read own setup reward" on public.setup_reward_grants
  for select
  using (salon_id in (select salon_id from public.salon_members where user_id = auth.uid()));

grant select on public.setup_reward_grants to authenticated;
grant select, insert, update, delete on public.setup_reward_grants to service_role;

-- ---- RPC: серверный прогресс настройки ----
-- security invoker (default) → RLS на visits/expenses/salon_integrations/
-- bank_connections/salons применяется, юзер видит только свой салон.
create or replace function public.setup_progress(p_salon_id uuid)
returns table (
  salon_created      boolean,
  has_visit          boolean,
  has_expense        boolean,
  booksy_connected   boolean,
  bank_connected     boolean,
  dashboard_opened   boolean,
  created_at         timestamptz,
  reward_granted_at  timestamptz
)
language sql
stable
as $$
  select
    true as salon_created,
    exists (
      select 1 from public.visits v
       where v.salon_id = p_salon_id and v.deleted_at is null
    ) as has_visit,
    exists (
      select 1 from public.expenses e
       where e.salon_id = p_salon_id and e.deleted_at is null
    ) as has_expense,
    exists (
      select 1 from public.salon_integrations si
       where si.salon_id = p_salon_id
         and si.provider = 'booksy'
         and si.status = 'connected'
    ) as booksy_connected,
    exists (
      select 1 from public.bank_connections bc
       where bc.salon_id = p_salon_id and bc.status = 'connected'
    ) as bank_connected,
    (s.dashboard_opened_at is not null) as dashboard_opened,
    s.created_at,
    s.setup_reward_granted_at as reward_granted_at
  from public.salons s
  where s.id = p_salon_id;
$$;

revoke all on function public.setup_progress(uuid) from public;
grant execute on function public.setup_progress(uuid) to authenticated, service_role;

-- ---- RPC: отметить «открыт дашборд» (реальное серверное событие) ----
-- security definer — ставит метку без широких прав на UPDATE salons; идемпотентно
-- (coalesce — первый раз фиксирует время, дальше не меняет). Только участник салона.
create or replace function public.mark_dashboard_opened(p_salon_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.salon_members
     where salon_id = p_salon_id and user_id = auth.uid()
  ) then
    return; -- не участник — молча игнорируем
  end if;
  update public.salons
     set dashboard_opened_at = coalesce(dashboard_opened_at, now())
   where id = p_salon_id;
end;
$$;

revoke all on function public.mark_dashboard_opened(uuid) from public;
grant execute on function public.mark_dashboard_opened(uuid) to authenticated, service_role;
