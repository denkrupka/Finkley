-- inventory_items.sale_price_cents — отдельная продажная цена (брутто).
--
-- Раньше RetailSaleWizard брал unitPrice из cost_per_unit_cents (закупочная
-- цена!) — это бaг т.к. юзер ожидает продажную цену по умолчанию. Эта колонка
-- даёт явное поле для продажной цены брутто. Если null — fallback на
-- cost_per_unit_cents (старое поведение).
--
-- Связка с VAT: sale_net_cents + sale_vat_rate_pct уже есть (миграция
-- 20260602000001). sale_price_cents = брутто; sale_net_cents = нетто.

alter table public.inventory_items
  add column if not exists sale_price_cents bigint;

comment on column public.inventory_items.sale_price_cents is
  'Продажная цена брутто (per unit). NULL = fallback на cost_per_unit_cents в UI. sale_net_cents + sale_vat_rate_pct — VAT-разбивка этой цены.';
