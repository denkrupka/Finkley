# ADR-031: Богатая модель `bank_tx_rules` (имя + условия + действия)

## Статус

`Accepted`

Дата: 2026-06-03

## Контекст

Изначальная модель `bank_tx_rules` (ADR не было, миграция
`20260603000016_bank_tx_rules.sql`) была минимальной: одно правило =
`counterparty_pattern` + `action ∈ {auto_create, ignore}` + опциональный
`category_id`. В UI это рендерилось как две вкладки «Авто-категории» и
«Игнорировать» — без имён правил, без вкл/выкл, без операторов, без
поддержки «применимо к доходу/расходу».

На практике у владельца к концу первого года активного использования
банк-интеграции набирается 10-30 правил. Без имени их не различить в
списке. Без вкл/выкл (toggle) приходится удалять и пересоздавать.
Без множественных условий (`Контрагент содержит "TRANSGOURMET"
**И** Сумма больше 500 PLN`) — нельзя обработать частые кейсы вроде
«крупные закупки от X идут в категорию A, мелкие — в категорию B».
Без operator-разнообразия (`содержит / равно / начинается с / regex /
больше / меньше`) — даже один пользователь bookysync-bot уже упирался
в это: пришлось делать suffix-исключения через костыли.

Скриншоты эталонного UI (которые владелец прислал 03.06) показывают
шаблон богатого редактора правил, привычного по wfirma/Manager.io/
Money Lover: имя, тоггл `enabled`, выбор «Доход/Расход», N условий
(field+operator+value), N действий (set-category / set-counterparty /
ignore), кнопки Сохранить/Отмена/Удалить.

## Решение

Расширяем существующую таблицу `bank_tx_rules` миграцией поверх (не
удаляем старые колонки в этой же миграции — сохраним совместимость
работы старого `banking-sync` Edge Function до его обновления).

### Новые колонки

- `name text` — имя правила (показывается в списке).
- `enabled boolean default true` — тоггл вкл/выкл.
- `applies_to text check in ('income','expense','both') default 'expense'` —
  к какому типу транзакций применять. (`debit` = expense, `credit` = income.)
- `conditions jsonb default '[]'::jsonb` — массив условий, AND между ними.
  Контракт элемента:
  ```json
  {
    "field": "counterparty" | "description" | "amount" | "amount_abs",
    "op": "contains" | "not_contains" | "equals" | "starts_with" | "ends_with"
        | "regex" | "gt" | "gte" | "lt" | "lte",
    "value": string | number
  }
  ```
  Текстовые поля (counterparty, description) поддерживают текстовые ops
  (contains, not_contains, equals, starts_with, ends_with, regex).
  Числовое поле (amount, amount_abs) поддерживает числовые ops (gt, gte,
  lt, lte, equals). amount хранится в центах (как и `amount_cents` в БД),
  но UI вводит в PLN — конверсия в редакторе.
- `actions jsonb default '[]'::jsonb` — массив действий, выполняются по
  порядку. Контракт элемента:
  ```json
  { "type": "set_category", "category_id": "uuid" }
  { "type": "set_counterparty", "counterparty": "TRANSGOURMET" }
  { "type": "ignore" }
  ```
  Если в actions есть `ignore` — `bank_transactions.is_personal=true` и
  expense НЕ создаётся (даже если есть `set_category`). `set_category`
  без `ignore` → создаём expense с этой категорией.
- `sort_order int default 0` — порядок применения правил (как в скрине 3
  drag-handle). При вычислении совпадения проходим правила в порядке
  `sort_order asc, created_at asc`. Первый match — применяет действия,
  останавливаемся.

### Старые колонки

Оставляем как deprecated на 1 релиз:

- `counterparty_pattern` — будет заполняться NULL для новых правил, но
  пока в БД присутствует на случай если что-то откатимся.
- `action` — same.
- `category_id` — same.

После того как owner-feedback подтвердит «работает» (1-2 недели), отдельной
миграцией удалим устаревшие колонки.

### Бэкфилл

В миграции `20260603000016_bank_tx_rules_rich.sql` для всех существующих
строк генерируем `name`, `applies_to`, `conditions`, `actions` из старых
колонок:

- `name` = `counterparty_pattern` (плюс суффикс если есть дубль).
- `enabled` = `true`.
- `applies_to` = `'both'` (старая модель не разделяла; пользователь сам
  поправит при первом редактировании).
- `conditions` = `[{ "field": "counterparty", "op": "contains", "value": counterparty_pattern }]`.
- `actions`:
  - если `action='auto_create'`: `[{ "type": "set_category", "category_id": category_id }]`
    (если `category_id IS NULL` — пустой массив, такое правило не будет ничего делать
    кроме матчинга, но и старая модель такое не давала, так что edge case).
  - если `action='ignore'`: `[{ "type": "ignore" }]`.

### Изменения в `banking-sync` Edge Function

`applyBankTxRules` переписывается под новый матчер:

1. Загружаем все `enabled=true` правила, отфильтрованные по `applies_to`
   (`credit` → income/both; `debit` → expense/both).
2. Сортируем по `sort_order asc, created_at asc`.
3. Для каждой новой tx — пробегаем правила, проверяем conditions (все
   должны пройти — AND), если match — выполняем actions.
4. Если в actions есть `ignore` → `is_personal=true`, expense НЕ создаём.
5. Если есть `set_counterparty` — обновляем `bank_transactions.counterparty`.
6. Если есть `set_category` (и нет `ignore`) — создаём expense с дедупом
   как раньше (±3 дня, ±100 центов).

### Изменения в UI

- `BankRulesDialog.tsx` → переименовать в `BankRulesListDialog.tsx`,
  становится списком правил по образцу скрина 3 («Автоправила»):
  кнопка `Добавить`, drag-handle (опционально на v1: пока без DnD,
  просто стрелочки или sort_order через инлайн-поле), имя правила,
  дата создания, тоггл `enabled`, иконка карандаша → открыть редактор.
- Новый компонент `BankRuleEditDialog.tsx` (скрины 1-2):
  имя правила, тоггл `enabled`, пиллы Доход/Расход/Оба, секция
  «Условие» (динамический список field+op+value+корзина+«+ Добавить
  ещё одно условие»), секция «Выбрать» (динамический список actions с
  типом и value-селектором), кнопки Сохранить/Отмена/Удалить.

### Изменения в хуках

`apps/web/src/hooks/useBankTxRules.ts` обновляется:

- `BankTxRule` тип — новая форма.
- `useBankTxRules(salonId)` — без изменений, только select полей.
- `useCreateBankTxRule(salonId)` — принимает `{name, enabled, applies_to,
conditions, actions, sort_order?}`.
- `useUpdateBankTxRule(salonId)` — новая, для редактора.
- `useToggleBankTxRule(salonId)` — новая, для свитча `enabled` в списке.
- `useDeleteBankTxRule(salonId)` — без изменений.

Zod-схемы `RuleConditionSchema`, `RuleActionSchema`, `BankTxRuleSchema`
лежат в `apps/web/src/lib/bank-rules-schema.ts` — для валидации и для
переиспользования в редакторе формой.

### Pure-helper `matchRule` для тестов и для Edge Function

`apps/web/src/lib/bank-rules-match.ts` — pure-функция:

```ts
matchRule(tx: { counterparty?, description?, amount_cents, type }, rule: BankTxRule): boolean
```

Используется в UI (для будущего preview/dry-run) и в `_shared/` Edge
Function. Покрыта юнит-тестами на все ops.

## Альтернативы, которые рассматривали

- **A. Оставить старую модель, только новый UI.** Отклонён: невозможно
  сделать функционал с операторами и множественными условиями без новых
  колонок; UI как на скринах не получится; владелец явно подтвердил
  Вариант A с полной переделкой.
- **B. Отдельная таблица `bank_tx_rule_conditions` (1-N) вместо jsonb.**
  Отклонён: переусложнение. У 99% правил будут 1-2 условия. JSONB даёт
  атомарную запись/чтение в одну строку и проще для UI (сразу деструктурим
  массив). PostgreSQL GIN-индекс по jsonb даёт быстрый поиск если
  понадобится (но пока не нужен — правил мало).
- **C. Использовать `pg_jsonschema` для валидации jsonb на стороне БД.**
  Отклонён: extension не нужен — валидируем в `useCreate/UpdateBankTxRule`
  через Zod. Если поломанный JSON попадёт в БД через прямой SQL,
  banking-sync проигнорирует правило и залогирует.

## Последствия

### Положительные

- UI как на эталонном скриншоте — узнаваемый владельцем паттерн.
- Поддержка сложных правил: «крупные закупки от TRANSGOURMET → закупка
  материалов; мелкие → продукты для перекуса».
- Тоггл `enabled` — можно отключить правило на время без удаления.
- `applies_to='income'` — впервые правила для доходов (раньше только
  expense). Например: «Контрагент содержит ZUS → пометить как
  возврат страховых».
- Pure-функция матчера → unit-тесты + переиспользование в UI/EF.

### Отрицательные

- Старые колонки остаются в БД ещё 1 релиз → cluttery.
- Bookings/UX: drag-handle для sort_order не реализуем в v1; пока числовой
  sort_order, drag добавим в v2 (если будет 20+ правил).
- Edge Function `banking-sync` нужно тестировать вручную: миграция не
  пересоздаёт triggers, sync должна работать на старых и новых правилах
  параллельно (в момент деплоя).

### Что мониторим

- Если у юзеров правил окажется >50 на салон → подумать про lazy load
  - поиск по имени в списке.
- Если matcher тормозит на batch sync (200+ tx × 30 правил) → пере-
  написать на SQL в виде RPC (но пока всё в JS на стороне Edge Function).
- Если jsonb валидация ломается на проде → добавить CHECK constraint
  или migration `pg_jsonschema`.
