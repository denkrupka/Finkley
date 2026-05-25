# ADR-024: Банковская интеграция через Enable Banking (PSD2 AIS)

## Статус

`Accepted`

Дата: 2026-05-25

## Контекст

Владельцы салонов вручную дублируют каждую банковскую операцию в Finkley как
«расход» или «доход». Это:

1. Занимает время (10–20 минут на еженедельную выписку).
2. Приводит к пропускам — «оплатил, но расход не внёс».
3. Создаёт расхождение между фактической выпиской и P&L в системе.

Цель — автоматизировать импорт транзакций из банка клиента и связать каждую
транзакцию с расходом/визитом/прочим доходом, чтобы:

- Если расход уже внесён — авто-привязка к транзакции (подтверждение оплаты).
- Если нет — создание расхода из транзакции в один клик с auto-prefill.
- Симметрия для credit-операций (доходов): связь с визитом / прочим доходом.

PSD2 (Payment Services Directive 2) обязывает банки ЕС открывать API для
AIS-провайдеров (Account Information Services). Нам нужен AIS-агрегатор, потому
что прямая интеграция с каждым польским/немецким/чешским банком — нереально.

## Решение

Использовать **Enable Banking** как PSD2 AIS-провайдера (одобрено для прода
2026-05-12). Архитектура:

### Схема БД (миграция `20260509000002_bank_integration.sql`)

```
bank_connections    1 ─── N  bank_accounts    1 ─── N  bank_transactions
   (PSD2 consent)             (IBAN, currency)            (debit/credit, raw)
                                                              │ ├── expense_id        → expenses
                                                              │ ├── linked_visit_id   → visits
                                                              │ └── linked_other_income_id → other_incomes
                                                              │   (CHECK chk_bank_tx_single_link: только один из трёх)
                                                              └── needs_review boolean
```

Зеркальная колонка `expenses.bank_transaction_id` (для unique FK на стороне
расхода — расход может быть привязан только к одной tx). Для visits / other*incomes
зеркала нет: связь живёт только на стороне `bank_transactions.linked*\*\_id`,
JOIN'им через hook `useBankLinkedIncomeIds(salonId)`который собирает все
связанные id в`Set` за один запрос.

### Sync (cron + manual)

- `banking-sync` edge function — синкает одну connection. Тащит свежие
  транзакции через Enable Banking API, дедупит по `(account_id, external_id)`,
  применяет auto-link скоринг к новым строкам, создаёт expenses для debit'ов
  без матча.
- Cron `cron_run_banking_syncs()` — каждые 15 минут выбирает due connections
  (где `last_synced_at + sync_interval_minutes` уже прошёл) и шлёт async POST
  через `pg_net`. Per-connection `sync_interval_minutes` (range 60..1440,
  default 360 = 6h) — юзер выбирает в UI (`BankingSection.tsx`).
- Юзер может в любой момент дёрнуть ручной sync через `useBankSyncNow`.

### Auto-link скоринг (этап 2)

Для каждой свежей debit-транзакции ищем кандидата expense в окне ±14 дней
без `bank_transaction_id`. Скоринг (нужно ≥ 3 баллов):

- `amount_cents` exact match: +3
- `document_number` входит в `description` транзакции: +3
- `counterparty.nip` входит в `description`: +3
- `counterparty.name` fuzzy в counterparty транзакции: +2 (или +1 если только в description)

Логика:

- score ≥ 5 → auto-link, `needs_review = false`
- score 3-4 → link, `needs_review = true` (оператор подтверждает)
- score < 3 → не линкуем, создаём новый expense с `needs_review = true`

Для credit-транзакций — авто-матчинг с `other_incomes` по amount + comment.

### UI

- **Вкладка «Банкинг»** в Расходах (debit) и Доходах (credit). Колонки:
  Дата | Контрагент | Сумма | Назначение | Связано с | Действие.
- **Маркеры**:
  - «Банк» (Landmark icon) на расходе/визите/доходе если привязан к tx.
  - `AlertTriangle` (амбер) если `needs_review = true`.
- **Двунаправленные модалки**:
  - `LinkTransactionDialog` — с транзакции пикаем расход/визит/доход.
  - `LinkExpense/Visit/OtherIncomeToBankDialog` — обратно: со страницы
    сущности пикаем неpривязанную tx.
- **Частичная оплата**: `expenses.paid_amount_cents` + чекбокс «частичная
  оплата» в форме. Если расход привязан к bank-tx — trigger авто-пересчёта
  `paid_amount_cents` по сумме linked tx (миграция `bank_tx_paid_amount_trigger`).

## Альтернативы, которые рассматривали

- **Прямые интеграции с банками (Millennium API, mBank API, …)** — отклонены:
  кардинально дольше (3-6 месяцев на банк), нет единого SLA, требуют отдельных
  contract'ов с каждым банком. Не масштабируется на DE/CZ/FR.
- **Truelayer / Tink / GoCardless как PSD2-провайдер** — рассматривались.
  Tink дороже (€0.40/tx vs €0.05 Enable Banking при сравнимом покрытии PL+EU),
  Truelayer слабее покрывает Польшу, GoCardless фокусирован на UK/SEPA payments
  а не AIS.
- **CSV-импорт выписки вместо API** — отклонён как основной канал: формат
  PDF/CSV у каждого банка свой, парсинг ломается при редизайнах выписки,
  юзер должен помнить экспортировать каждую неделю. Может быть добавлен как
  fallback позже.
- **Полное зеркалирование visits.bank_transaction_id / other_incomes.bank_transaction_id**
  (как у expenses) вместо JOIN-hook — отклонено для MVP: требует двух
  дополнительных миграций + sync-trigger, выигрыш только в ~50ms на render.
  При росте связей > 10k tx/салон стоит вернуться.

## Последствия

### Положительные

- Owner получает «банк автомат вписывает расходы» — главное болевая точка
  закрыта end-to-end.
- Симметричный flow для credit-операций (визиты/продажи/прочее) — единая
  модель учёта в одном месте.
- `needs_review` маркер на обоих концах (tx + связанная сущность) даёт
  visual audit trail.
- Per-connection sync interval позволяет owner'у балансировать актуальность
  vs Enable Banking rate-limit (1h / 3h / 6h / 12h / 24h).

### Отрицательные

- PSD2 consent истекает каждые 90-180 дней — нужен flow переподключения
  (есть: `BankingSection` показывает баннер при < 14 дней).
- Enable Banking платный — €0.05 за tx (на 10 салонов × 200 tx/месяц = ~€10/мес,
  входит в €15/мес pricing).
- Auto-link скоринг 3-4 (needs_review) даёт false positive — юзеру надо
  проверять. Снижение порога до ≥5 жёстко отдаёт false negative (создаются
  duplicate expenses).
- Зависимость от Enable Banking как vendor — если они закроются, переезд на
  Tink/Truelayer требует переписать `banking-sync` edge function и схему
  hooks. Сам схема БД vendor-agnostic.

### Что мониторим

- Если Enable Banking рейзит цены > €0.15/tx — пересматриваем (искать аналоги).
- Если > 20% всех auto-link'ов попадают в `needs_review` — пересмотреть пороги
  скоринга.
- Если `cron_run_banking_syncs` начинает занимать > 30 секунд / tick — вынести
  в отдельный pg_cron job per-bank или per-салон partition.
- Если PSD2 регулирование ужесточит требования (например, обязательный QSeal
  сертификат для всех AIS) — переоценить экономику.

## Ссылки

- Документация Enable Banking: https://enablebanking.com/docs/
- Миграции: `supabase/migrations/20260509000002_bank_integration.sql`,
  `20260509000003_banking_sync_cron.sql`, `20260509000004_banking_expiry_notify.sql`,
  `20260525130000_bank_transactions_income_link.sql`,
  `20260525191522_bank_sync_interval.sql`
- Edge functions: `supabase/functions/banking-{aspsps,connect,callback,sync,disconnect,expiry-notify}/`
- Frontend: `apps/web/src/routes/banking/*`, `apps/web/src/routes/integrations/BankingSection.tsx`,
  `apps/web/src/hooks/useBanking.ts`
- Тесты: `apps/web/tests/unit/banking-rls.test.ts`, `bank-sync-interval.test.ts`
