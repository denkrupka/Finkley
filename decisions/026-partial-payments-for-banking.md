# ADR-026: Partial payments для расходов и доходов через installments + trigger

## Статус

`Accepted`

Дата: 2026-05-26

## Контекст

Пользователь при привязке банковской транзакции к расходу/доходу часто
сталкивается с **несовпадением сумм** — фактура на 1234 PLN, а в банке три
платежа: 500 + 500 + 234. До этого решения система требовала либо:

- ровного совпадения сумм tx ≡ entity (нереально для рассрочки),
- либо изменения суммы entity под tx (искажает учёт).

Также нужна **история частичных оплат** — кто/когда/чем оплачивал,
с возможностью просмотра и удаления отдельной операции.

Решение должно быть **симметричным для income** (visit/other_income): клиент
может платить в рассрочку, банк-tx приходит частями.

## Решение

### Слой 1: данные

Две новые таблицы — `expense_payment_installments` (миграция 20260526114212)
и `income_payment_installments` (миграция 20260526160000). Структура:

```
id, expense_id|visit_id|other_income_id (polymorphic, ровно один FK),
paid_at, amount_cents, payment_method, cash_register_id, bank_transaction_id,
comment, created_by, created_at
```

На `(expense|visit|other_income).paid_amount_cents bigint NULL` — кэш суммы
всех installments. NULL = «полностью оплачено» (legacy default до этого ADR).

### Слой 2: trigger

`recalc_expense_paid_amount` / `recalc_income_paid_amount` — AFTER INSERT/
UPDATE/DELETE на installments-таблице. Пересчитывает `SUM(amount_cents)` и:

- если `SUM >= entity.amount_cents` → `paid_amount_cents = NULL` (полностью)
- иначе → `paid_amount_cents = SUM` (частично)

Для visits net считается как `amount - discount + tip`.

### Слой 3: helpers + UI

- `effectivePaidCents(expense)` — учитывает partial для расходов.
- `effectiveReceivedFromVisit(v) / effectiveReceivedFromOtherIncome(o)` —
  для доходов. Используются в **CashFlowTab, FinancialReportTab (fact),
  SalesTab, VisitsPage, DashboardPage paymentTotals** чтобы отчёты
  показывали **фактически полученное**, а не планируемое.
- `PartiallyPaidExpenseDialog` / `PartiallyPaidIncomeDialog` — модалка при
  клике на частично-оплаченную сущность из picker'а. Показывает историю
  installments + три кнопки в зависимости от соотношения tx vs remaining:
  - `tx == remaining` → «Привязать (полностью оплачено)»
  - `tx < remaining` → «Частично» / «Изменить сумму расхода»
  - `tx > remaining` → «Увеличить сумму расхода»

При клике «Частично» создаётся новый installment + ставится
`bank_transactions.expense_id` (legacy FK) — trigger сам пересчитает
paid_amount_cents.

### Слой 4: multi-link

Когда одна tx покрывает несколько сущностей (одна оплата за два расхода),
используем `bank_tx_splits` (ADR из миграции 20260526120616). Splits не
изменяют paid_amount_cents — они только связь tx → entity с указанной
суммой. Учёт по-прежнему делает installment, который юзер создаёт через
PartiallyPaid\*Dialog или прямой ввод формой.

## Альтернативы, которые рассматривали

- **Хранить total_paid прямо в entity без installments-таблицы:** отклонён —
  нет истории «когда платили», нельзя удалить отдельную оплату.
- **Audit-таблица без trigger, считать paid на лету в SELECT:** отклонён —
  каждый report делал бы GROUP BY с JOIN, медленно при больших таблицах.
- **Хранить как массив JSONB на entity:** отклонён — нельзя RLS изолировать,
  невозможен FK на bank_transaction_id для cascade.

## Последствия

### Положительные

- Юзер видит полную историю оплат каждого расхода/дохода с привязкой к
  bank-tx, может удалить ошибочный installment.
- Reports/Dashboard автоматически переходят на «фактическое» через
  effective\*-helpers без изменения логики тестов (которые сидят на raw
  amount_cents).
- Симметричная архитектура expense / income — меньше когнитивной нагрузки
  на чтение кода (`recalc_expense_paid_amount` и `recalc_income_paid_amount`
  ведут себя одинаково).
- Multi-link через splits не конфликтует с partial — это независимые слои:
  splits отвечают «какие сущности оплачивает tx», installments — «сколько
  и когда пришло на эту сущность».

### Отрицательные

- Дублирование (paid_amount_cents = derived от installments) — если кто-то
  напрямую UPDATE paid_amount_cents без installment, БД будет inconsistent.
  Это lawless path — намеренно оставляем, чтобы не блокировать ручной ввод
  через ExpenseFormModal в legacy-мире.
- Trigger на каждый INSERT installment делает SUM + UPDATE — линейный
  overhead. Допустимо при ~единицах installments на entity.

### Что мониторим

- Если юзер начнёт делать ручные UPDATE expense.paid_amount_cents мимо
  installments (через прямой SQL или ExpenseFormModal partial-checkbox) и
  при этом trigger пересчитает поверх — данные разойдутся. Если такие
  кейсы повторятся → добавить trigger BEFORE UPDATE на expenses который
  валидирует paid_amount_cents = SUM(installments) или null.
- Если число installments на одну entity начнёт превышать ~50 (рассрочка),
  переключить trigger с SUM(\*) на инкрементальный (paid_amount_cents += NEW.amount).
