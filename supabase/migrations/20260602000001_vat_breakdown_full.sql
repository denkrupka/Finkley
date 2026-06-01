-- VAT-разбивка по всему приложению (запрос юзера 02.06).
--
-- Бизнес-смысл:
--   * Если фирма плательщик VAT — всё считается в нетто (P&L), VAT-разница
--     (НДС доходов − НДС расходов) идёт в категорию «Налоги».
--   * Если фирма НЕ плательщик — VAT=0 везде, нетто=брутто, без расчётов.
--   * При «пропустить документ» в визите/продаже — фискального VAT нет,
--     брутто=нетто, vat_rate=null.
--
-- Колонки во ВСЕХ финансовых таблицах:
--   <amount>_cents       — БРУТТО (с НДС). Обратная совместимость.
--   <amount>_net_cents   — НЕТТО (без НДС). NULL = старая запись.
--   vat_rate_pct         — ставка НДС в %. NULL = неприменимо.

-- Флаг плательщика VAT уже есть в salons.accounting_settings.vat_payer
-- (jsonb, из миграции 20260516000002). Отдельную колонку не дублируем —
-- читаем через хук useAccountingSettings.

-- ── services (карточка услуги) ──────────────────────────────────────────
alter table public.services
  add column if not exists price_net_cents bigint,
  add column if not exists vat_rate_pct numeric(5, 2);
comment on column public.services.price_net_cents is
  'Цена услуги нетто (без НДС). NULL = старая запись. price_cents = брутто.';
comment on column public.services.vat_rate_pct is
  'Ставка НДС услуги в %. NULL = старая запись или фирма zwolnienie.';

-- ── inventory_items (карточка материала) ────────────────────────────────
-- Закупочная цена (cost) и продажная цена (sale) — обе с VAT-разбивкой.
alter table public.inventory_items
  add column if not exists cost_net_cents bigint,
  add column if not exists cost_vat_rate_pct numeric(5, 2),
  add column if not exists sale_net_cents bigint,
  add column if not exists sale_vat_rate_pct numeric(5, 2);
comment on column public.inventory_items.cost_net_cents is
  'Закупочная цена нетто. NULL = старая запись. cost_per_unit_cents = брутто.';
comment on column public.inventory_items.sale_net_cents is
  'Продажная цена нетто. sale_price_cents = брутто.';

-- ── visits (визиты + retail-продажи) ────────────────────────────────────
-- amount_cents — БРУТТО (уже было). amount_net_cents — НЕТТО.
-- vat_skipped — если юзер на этапе расчёта выбрал «пропустить документ»
-- (фискально не пробит), тогда no_vat = true и брутто = нетто.
alter table public.visits
  add column if not exists amount_net_cents bigint,
  add column if not exists vat_rate_pct numeric(5, 2),
  add column if not exists vat_skipped boolean not null default false;
comment on column public.visits.vat_skipped is
  'TRUE = на расчёте выбрано «пропустить документ» — фискально не пробит, VAT=0 в P&L.';

-- ── other_incomes (прочие доходы) ───────────────────────────────────────
alter table public.other_incomes
  add column if not exists amount_net_cents bigint,
  add column if not exists vat_rate_pct numeric(5, 2),
  add column if not exists vat_skipped boolean not null default false;

-- ── Категория «Налоги» — системная подкатегория в Расходах ─────────────
-- Не вставляем сразу, поскольку каждый салон может уже иметь свою категорию.
-- Backfill будет в коде edge function / триггере при первом расчёте VAT.
-- Просто отметим существование флага is_system на expense_categories — он
-- уже есть в схеме (с миграции 20260505).
