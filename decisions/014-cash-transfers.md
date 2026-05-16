# ADR-014: Перестановка средств между кассами (cash_transfers)

## Статус

`Accepted`

Дата: 2026-05-16

## Контекст

«Касса салона» — это не одно «место». В реальности деньги лежат в нескольких
контейнерах: рабочая наличка, сейф, банковский счёт, личный счёт владельца,
инкассатор. В течение дня деньги переходят между ними: вечером из кассы в
сейф, из сейфа на счёт через банк, со счёта обратно на мелкие расходы.

До сих пор такие операции либо не учитывались (и при сверке возникал
дисбаланс), либо проводились как фиктивные «расход + доход» — что
искажает P&L и отчёты.

`cash_registers` хранятся в `salons.financial_settings.cash_registers.items[]`
(JSONB) — динамический список под управлением owner'а, не отдельная таблица.
Поля `visits.cash_register_id` и `expenses.cash_register_id` — `text`, без FK.

`cash_shifts` — per-user (с `20260516000004`): каждый кассир ведёт свою
смену. Снапшоты `expected_*_cents` при закрытии — для устойчивости отчётов
к ретроактивным правкам.

## Решение

Завести **независимую первичную сущность** `cash_transfers` — отдельный
аудит-поток, который не влияет на P&L и не привязан к смене конкретного
кассира.

### Схема

```sql
create table cash_transfers (
  id              uuid primary key default gen_random_uuid(),
  salon_id        uuid not null references salons(id) on delete cascade,

  from_register_id text not null,   -- id из financial_settings.cash_registers.items
  to_register_id   text not null,   -- то же, не FK (registers — это JSONB)

  amount_cents    bigint not null check (amount_cents > 0),
  comment         text,
  transferred_at  timestamptz not null default now(),  -- backdate допускается

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  -- Реверсал: если эта запись — обратный перевод, ссылается на оригинал.
  reversal_of     uuid references cash_transfers(id) on delete set null,

  -- Soft-delete (только owner/admin, обязательная причина).
  deleted_at      timestamptz,
  deleted_by      uuid references auth.users(id) on delete set null,
  deleted_reason  text,

  check (from_register_id <> to_register_id)
);
```

### RPC

1. **`compute_register_balance(p_salon_id uuid, p_register_id text, p_at timestamptz default now())`**
   — возвращает `bigint` (centов). Формула:
   `+ Σ visits.amount_cents (за вычетом discount, +tip) where cash_register_id = X and visit_at <= at`
   `+ Σ other_incomes.amount_cents where cash_register_id = X and income_at <= at`
   `+ Σ cash_transfers.amount_cents where to_register_id = X and transferred_at <= at and deleted_at is null`
   `− Σ expenses.amount_cents where cash_register_id = X and spent_at <= at`
   `− Σ cash_transfers.amount_cents where from_register_id = X and transferred_at <= at and deleted_at is null`

2. **`cash_transfer_create(p_salon_id, p_from, p_to, p_amount, p_comment, p_transferred_at)`**
   — atomic: проверяет `compute_register_balance(from) >= amount`, инсёртит, возвращает строку. SECURITY DEFINER, проверка members.

3. **`cash_transfer_reverse(p_id)`**
   — создаёт обратный transfer с `reversal_of = p_id`, проверяет что баланс источника (нового from) выдержит. Используется в undo-toast.

4. **`cash_transfer_soft_delete(p_id, p_reason)`**
   — только owner/admin (через `salon_members.role`). Проставляет `deleted_at/by/reason` и **дополнительно** создаёт обратный transfer (как и `reverse`) — чтобы балансы корректно сходились. В таблице остаются обе записи: оригинал (помечен deleted) + reversal.

### RLS

- `select` — все members салона видят все transfers (для аудита)
- `insert` — все members могут создавать (для гибкости; soft-delete защитит)
- `update` — только через RPC (`cash_transfer_soft_delete`), не напрямую с клиента
- `delete` — запрещено напрямую, только soft через RPC

### UI

- Кнопка в header `/expenses` и в табе `/finance → Касса`
- Модалка `CashTransferModal`: блок карточек касс с подсветкой → форма
  (откуда/куда/сумма/комментарий/дата) → превью изменений → confirm-step
- После успеха: toast с кнопкой «Откатить» (8 сек) — вызывает
  `cash_transfer_reverse`. Карточки касс анимируются к новым суммам.
- История — таблица под формой/во второй вкладке: фильтры (период/касса/
  пользователь), пагинация 50.
- В close-shift flow (если `cash_discipline_enabled`): после успешного
  закрытия — диалог «Сделать перестановку?». Да → CashTransferModal.

### Backdate

Допускается. Закрытые смены не пересчитываются — их `expected_*` это
snapshot. Если transfer датируется днём до последнего close — UI
предупреждает «эта дата раньше последнего закрытия смены — операция
отразится только в истории трансферов, на сверки не повлияет».

## Альтернативы, которые рассматривали

- **A. Фиктивные расход+доход** — нельзя, искажает P&L и категории.
- **B. Привязать transfer к open cash_shift кассира** — отклонено: сейф/
  банк/инкассатор не имеют shift'а. Transfer — независимая ось.
- **C. Один механизм отката: или undo-toast, или soft-delete-with-reason** —
  отклонено владельцем: нужны оба (быстрый откат + формальная коррекция).
- **D. Делать FK `cash_registers` таблицей** — отклонено: это изменит
  существующую модель registers (JSONB) и потребует миграции всех `visits.cash_register_id` / `expenses.cash_register_id`. Слишком большой blast radius для одной фичи.

## Последствия

### Положительные

- Полный аудит-след внутренних перемещений
- Корректные per-register balances (новая RPC `compute_register_balance`)
- Защита от ухода в минус на уровне RPC (atomic check)
- Реверсал + soft-delete оставляют обе записи — историю не теряем
- Не влияет на P&L, на отчёты «расход/доход», на бюджеты

### Отрицательные

- Дополнительная таблица + 4 RPC, которые надо поддерживать
- `compute_register_balance` дороже чем плоский счётчик — но мы и так
  не кешируем per-register балансы, и UI запросит балансы только когда
  откроется модалка/таб
- `from_register_id` / `to_register_id` без FK (это `text` к JSONB items) —
  если owner удалит кассу из справочника, transfers с этим id останутся
  «висящими». Lookup label по id будет возвращать `null` → в UI рисуем
  «(удалённая касса)»

### Что мониторим

- Если `compute_register_balance` начнёт тормозить (>200ms на средний салон)
  — индекс на `cash_transfers(salon_id, from_register_id, transferred_at)`
  и `(salon_id, to_register_id, transferred_at)` уже стоит; следующий шаг —
  materialized view или incremental cache в `salon_register_balances`
- Если юзеры начнут регулярно делать «фиктивные расходы вместо transfers»
  — пересмотреть discoverability кнопки
