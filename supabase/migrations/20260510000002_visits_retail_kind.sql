-- =============================================================================
-- 20260510000002_visits_retail_kind.sql
-- =============================================================================
-- TASK 40452a62: продажи косметики и доп.услуг.
--
-- Решение: добавляем `visits.kind` enum-like text {visit | retail} вместо
-- отдельной таблицы retail_sales. Причины:
--   * dashboard / reports / payouts уже агрегируют по visits — retail
--     автоматически попадает в выручку без переписывания всех RPC
--   * кассовый поток (выручка + чаевые + скидка + способ оплаты) тот же
--   * payouts по % от выручки могут включать или исключать retail —
--     это решение настраивается в схеме мастера (TODO when payouts get
--     a "include_retail" flag; пока — включается всё)
--
-- Для retail-визита:
--   service_id IS NULL, service_name_snapshot = название товара/доп.услуги,
--   kind = 'retail', staff_id опционален.
-- =============================================================================

alter table public.visits
  add column if not exists kind text not null default 'visit'
    check (kind in ('visit', 'retail'));

create index if not exists idx_visits_kind on public.visits(salon_id, kind, visit_at desc);

comment on column public.visits.kind is
  'visit (default) — обычная услуга мастера; retail — продажа косметики или доп. услуги, может быть без staff_id и service_id.';
