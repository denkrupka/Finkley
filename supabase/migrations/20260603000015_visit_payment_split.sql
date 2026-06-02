-- Bug 02.06 (Денис): «Если выбираю Смешанная (mixed) — надо показать 2 поля
-- для ввода сколько нал а сколько картой, чтобы правильно разнести по кассам».
--
-- Добавляем JSONB колонку payment_split в visits для хранения разбивки
-- {cash_cents, card_cents} когда payment_method='mixed'. Финансы/КассаTab
-- читают эту разбивку чтобы распределить выручку по 2 кассам (нал + карта)
-- вместо одного cash_register_id.
--
-- Структура:
--   {cash_cents: int, card_cents: int, cash_register_cash: uuid?, cash_register_card: uuid?}
--
-- Когда payment_method != 'mixed' → payment_split = null.

alter table public.visits
  add column if not exists payment_split jsonb;

comment on column public.visits.payment_split is
  'Для payment_method=mixed: {cash_cents, card_cents, cash_register_cash?, cash_register_card?}. NULL для остальных методов.';

-- Index для аналитики (где payment_split is not null — для cashflow group-by)
create index if not exists idx_visits_payment_split
  on public.visits((payment_split is not null))
  where payment_split is not null;
