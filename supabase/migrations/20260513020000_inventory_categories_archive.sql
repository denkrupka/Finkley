-- Soft-delete для inventory categories: вместо удаления категории и обнуления
-- items.category переносим имя в архив. Items сохраняют свой category-label —
-- исторические отчёты не теряют группировку.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS inventory_archived_categories text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN salons.inventory_archived_categories IS
  'Archived inventory categories — name preserved for historical items, hidden from new-item dropdown.';
