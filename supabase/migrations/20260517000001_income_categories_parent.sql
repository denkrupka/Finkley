-- ─────────────────────────────────────────────────────────────────────────────
-- 20260517000001_income_categories_parent.sql
--
-- Иерархия в справочнике «Доходы»: other_income_categories.parent_id
-- ссылается на другую категорию того же салона (на N уровней). Запрос
-- владельца — match с «Инвестициями» в справочнике Финансы (ParametersCard
-- умеет parent_id для подкатегорий).
--
-- ON DELETE CASCADE — если родителя физически удаляют, удаляются и
-- подкатегории. Логически юзер делает архив (soft-delete через
-- is_archived), а не физическое удаление.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.other_income_categories
  add column if not exists parent_id uuid
  references public.other_income_categories(id) on delete cascade;

create index if not exists idx_other_income_categories_parent
  on public.other_income_categories(parent_id)
  where parent_id is not null;

comment on column public.other_income_categories.parent_id is
  'Родительская категория для иерархии (см. справочник Финансы → Доходы).';
