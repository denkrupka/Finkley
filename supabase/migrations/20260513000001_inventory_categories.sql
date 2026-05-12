-- Standalone inventory categories for salons.
-- Раньше категория хранилась только в inventory_items.category (text). Юзер
-- хочет добавлять категории заранее — без привязки к конкретному материалу.
-- Решение: text[] колонка на salons. RLS уже есть (salon_members).

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS inventory_categories text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN salons.inventory_categories IS
  'User-defined inventory category names available in dropdowns даже когда у них ещё нет материалов.';
