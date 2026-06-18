-- =============================================================================
-- 20260618000002_subscription_plan.sql
-- =============================================================================
-- T7 — многоуровневая тарифная модель. Добавляем salon_subscriptions.plan.
--
-- Планы: demo | free | t19 | t49 | t69 | t99 (см. apps/web/src/lib/entitlements.ts).
-- Дефолт 'demo' (полный доступ) — чтобы существующие/ручные/бонусные подписки
-- не теряли доступ при включении гейтинга. Реальный план платной подписки
-- проставляет stripe-webhook из price_id (price→plan map).
--
-- Гейтинг — на UI-уровне (как RBAC); RLS остаётся реальным бэкстопом данных.
-- =============================================================================

alter table public.salon_subscriptions
  add column if not exists plan text not null default 'demo';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_salon_subscriptions_plan'
  ) then
    alter table public.salon_subscriptions
      add constraint chk_salon_subscriptions_plan
      check (plan in ('demo', 'free', 't19', 't49', 't69', 't99'));
  end if;
end$$;
