-- ─────────────────────────────────────────────────────────────────────────────
-- 20260517000004_visits_inventory_item_id.sql
--
-- Retail-визиты (kind='retail') теперь могут ссылаться на конкретный товар
-- со склада. Нужно для финотчёта: подразбивка «Продажи» по категориям
-- inventory_items.category на каждый месяц.
--
-- Опциональное поле — не каждая retail-продажа привязана к товару (есть
-- ручной ввод «Прочие позиции» в RetailSaleWizard). ON DELETE SET NULL —
-- если товар удалён, связь теряется, но visit остаётся.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.visits
  add column if not exists inventory_item_id uuid
  references public.inventory_items(id) on delete set null;

create index if not exists idx_visits_inventory_item
  on public.visits(inventory_item_id)
  where inventory_item_id is not null and deleted_at is null;

comment on column public.visits.inventory_item_id is
  'Для retail-визитов (kind=retail) — товар со склада. Используется в '
  'финотчёте для подразбивки «Продажи» по категориям inventory_items.category.';
