-- ─────────────────────────────────────────────────────────────────────────────
-- 20260516000007_expense_categories_kind_budget.sql
--
-- Унифицируем источник категорий: раньше Бюджеты тянули список из
-- financial_settings.fixed/variable (jsonb), а форма расхода — из таблицы
-- expense_categories. Из-за этого «факт vs план» не считался — категории
-- в разных источниках.
--
-- Решение:
--   - Добавляем expense_categories.kind ('fixed' | 'variable')
--   - Добавляем expense_categories.monthly_budget_pct (для variable —
--     процент от выручки)
--   - В useCategoryBudgets/BudgetsCard читаем expense_categories как
--     единственный источник, группируем по kind.
--
-- financial_settings.fixed/variable остаются для legacy-репортов
-- (P&L, ДДС), но Бюджеты больше на них не смотрят.
-- ─────────────────────────────────────────────────────────────────────────────

alter table expense_categories
  add column if not exists kind text not null default 'fixed'
    check (kind in ('fixed', 'variable')),
  add column if not exists monthly_budget_pct numeric;

-- monthly_budget_cents уже добавлено более ранней миграцией; убедимся что
-- оно есть и nullable.
alter table expense_categories
  add column if not exists monthly_budget_cents bigint;

comment on column expense_categories.kind is
  'Тип категории: fixed (бюджет в деньгах) или variable (бюджет в % от выручки).';
comment on column expense_categories.monthly_budget_pct is
  'Плановый месячный лимит в % от выручки (для variable категорий).';
comment on column expense_categories.monthly_budget_cents is
  'Плановый месячный лимит в копейках (для fixed категорий).';

create index if not exists idx_expense_categories_salon_kind
  on expense_categories(salon_id, kind)
  where is_archived = false;
