-- =============================================================================
-- expenses.payroll_* — расширение для зарплатных расходов.
-- =============================================================================
-- Когда категория = «Зарплата», бухгалтер хочет указать:
--   - какому мастеру выплата
--   - аванс или окончательный расчёт
--   - за какой период (start..end даты)
--
-- Эти поля используются в Reports → Зарплаты для расчёта остатка:
--   зарплата мастера за период минус выданные авансы.
-- =============================================================================

create type payroll_kind as enum ('advance', 'final');

alter table public.expenses
  add column if not exists payroll_staff_id  uuid references public.staff(id) on delete set null,
  add column if not exists payroll_kind      payroll_kind,
  add column if not exists payroll_period_start date,
  add column if not exists payroll_period_end   date;

create index if not exists idx_expenses_payroll_staff
  on public.expenses(payroll_staff_id, payroll_period_start)
  where payroll_staff_id is not null;

comment on column public.expenses.payroll_staff_id is
  'Мастер которому выплата (заполняется когда категория = зарплата). Связь soft — при удалении мастера запись остаётся, но staff_id обнуляется.';
comment on column public.expenses.payroll_kind is
  '«Аванс» (advance) или «окончательный расчёт» (final).';
comment on column public.expenses.payroll_period_start is
  'Период за который начисляется выплата. Для аванса — обычно текущий месяц до сегодня.';

-- =============================================================================
-- expense_categories.is_payroll — флаг что эта категория «зарплатная».
-- =============================================================================
-- Используется UI: при выборе категории с is_payroll=true показываем
-- payroll-поля. По умолчанию помечаем категорию «Зарплата мастерам».

alter table public.expense_categories
  add column if not exists is_payroll boolean not null default false;

-- Backfill: помечаем существующие зарплатные категории по имени.
update public.expense_categories
   set is_payroll = true
 where lower(name) like '%зарплат%'
    or lower(name) like '%payroll%'
    or lower(name) like '%wynagrodz%'
    or lower(name) like '%salary%';

comment on column public.expense_categories.is_payroll is
  'true → при выборе категории в форме расхода появляются поля мастера/типа/периода.';
