# ADR-027: Premium в expenses — отдельная колонка, не часть amount_cents

## Статус

`Accepted`

Дата: 2026-05-28

## Контекст

Владелец просит в Отчёты → Зарплаты колонку «Премия» между «Чаевые» и
«Начислено», а в ExpenseFormModal (при категории `is_payroll=true`) — отдельное
поле «Премия» сверху базового payout.

Премия — это бонус сверх договорной payout-схемы мастера (`percent_revenue` /
`fixed` / etc.). Она не считается через RPC из выручки, а **назначается
руководителем вручную**.

Две принципиальные схемы хранения:

1. Премия = часть `amount_cents` (слепить в одну сумму на UI разносить).
2. Премия = отдельная колонка `premium_cents`.

## Решение

Вариант 2: новая колонка `expenses.premium_cents bigint NOT NULL DEFAULT 0`.

База `amount_cents` хранит базовый payout (как раньше). `premium_cents`
хранит бонус. Поле появляется только когда категория `is_payroll=true`.

RPC `calculate_payouts_for_period` расширен новой колонкой `premium_cents` в
return table — это **сумма** `expenses.premium_cents` за период по мастеру:

```sql
where e.salon_id = p_salon_id
  and e.payroll_staff_id is not null
  and e.deleted_at is null
  and e.premium_cents > 0
  and coalesce(e.payroll_period_end, e.payroll_period_start) >= p_period_start
  and coalesce(e.payroll_period_start, e.payroll_period_end) <= p_period_end
```

`Начислено` (UI: `accruedCents`) = `payout_cents` + `premium_cents`.

## Альтернативы, которые рассматривали

- **Слепить в `amount_cents` + хранить разбивку в `metadata jsonb`** —
  отклонён: при пересчёте `payout` в Отчётах фронту пришлось бы парсить
  metadata, а агрегация в RPC через jsonb — медленная и хрупкая.
- **Отдельная таблица `expense_premiums`** — отклонён: 1:1 связь не оправдывает
  отдельную таблицу, а join в RPC замедлит расчёт.
- **Премия как отдельная expense-row с `sub_article='premium'`** — отклонён:
  два expense на один factual «зарплатный акт» ломают UX (выписка для бухгалтера,
  частичные оплаты).

## Последствия

### Положительные

- `payout_cents` (договорная зарплата) и `premium_cents` (бонус) — независимы.
  В аналитике легко считать ratio «бонусной» части от ФОТ.
- Default 0 → backward-compatible: все старые расходы продолжают работать.
- Один SQL `SUM(premium_cents)` в RPC — без join'ов.
- В PayoutsPage показываем тремя колонками: `Чаевые / Премия / Начислено`,
  где `Начислено = payout + premium`. Это сразу видно владельцу.

### Отрицательные

- RPC return type изменился — пришлось `DROP + CREATE` функции (миграция
  `20260528100000_payroll_premium.sql`). Любой downstream-код (если бы он был)
  получил бы 42P13 «cannot change return type».
- Если когда-нибудь премия станет «частью договора» (например, KPI-бонус) —
  придётся либо хранить две конкурирующие сущности, либо переделать.

### Что мониторим

- Если появятся premium-категории сверх ЗП (KPI квартальные бонусы, retention
  bonus за клиента) — пересмотреть и подумать про polymorphic `bonus_kind` enum.
- Если RPC `calculate_payouts_for_period` начнёт занимать > 500 ms на p95 —
  материализованное view или денормализация в `payouts` таблицу.
