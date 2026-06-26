-- =============================================================================
-- 20260626000004_promo_rewards.sql
-- =============================================================================
-- ADR-036 — промокоды-награды Stripe.
--
-- Заменяем материальную награду «+14 дней» за прохождение «Настройки Finkley»
-- на одноразовый Stripe promo code €20, и добавляем реферальную награду
-- €15 рефереру за ПЕРВУЮ платную подписку приглашённого.
--
-- Эта таблица — леджер фактически сгенерированных Stripe-промокодов (купон +
-- promotion_code) и их жизненного цикла (email отправлен / код применён).
--
-- Дедуп:
--   * setup   — один на салон (на стороне edge function claim-setup-reward
--               через UNIQUE-леджер setup_reward_grants, остаётся как был).
--   * referral— один на referral_uses.id (UNIQUE partial-index ниже).
--
-- Сам Stripe-купон одноразовый (max_redemptions=1, duration=once); promotion_code
-- тоже max_redemptions=1. amount_off в центах указанной валюты.
-- =============================================================================

create table if not exists public.promo_rewards (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  kind                  text not null check (kind in ('setup', 'referral')),
  amount_cents          bigint not null,
  currency              text not null default 'eur',
  stripe_coupon_id      text,
  stripe_promo_code_id  text,
  -- Человекочитаемый код промо (promotion_code.code) — его показываем юзеру.
  code                  text,
  -- Для referral-награды: какой именно referral_uses закрыли (дедуп).
  referral_use_id       uuid references public.referral_uses(id) on delete set null,
  email_sent_at         timestamptz,
  redeemed_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists idx_promo_rewards_user on public.promo_rewards(user_id);

-- Дедуп реферала: одна награда на одно использование реф-ссылки.
-- partial unique — NULL (setup-награды) не конфликтуют между собой.
create unique index if not exists uq_promo_rewards_referral_use
  on public.promo_rewards(referral_use_id)
  where referral_use_id is not null;

alter table public.promo_rewards enable row level security;

-- Юзер видит свои промокоды (для UI «мои награды»).
create policy "own promo rewards read" on public.promo_rewards
  for select
  using (user_id = auth.uid());

-- Запись — только service_role (через edge functions claim-setup-reward /
-- stripe-webhook). RLS блокирует прямой insert/update из SPA.
create policy "service role all promo rewards" on public.promo_rewards
  for all
  to service_role
  using (true)
  with check (true);

grant select on public.promo_rewards to authenticated;
grant select, insert, update, delete on public.promo_rewards to service_role;

comment on table public.promo_rewards is
  'ADR-036. Леджер одноразовых Stripe промо-наград: setup (€20 за «Настройку '
  'Finkley») и referral (€15 рефереру за первую платную подписку приглашённого). '
  'Дедуп referral — UNIQUE(referral_use_id). Дедуп setup — внешний леджер '
  'setup_reward_grants. code = promotion_code.code (показывается юзеру).';
