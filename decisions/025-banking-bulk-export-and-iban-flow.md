# ADR-025: Bulk-export переводов в банк + IBAN flow

## Статус

`Accepted`

Дата: 2026-05-26

## Контекст

ADR-024 закрыл базовый pipeline банкинга (импорт транзакций + связывание с
expense/visit/other_income). Открытыми остались **два direction'а**:

1. **Outbound payments** — у владельца множество запланированных платежей
   (`scheduled_payments` со status='pending'). Каждый месяц он вручную
   вбивает их в банк-клиент один за другим. Хочется массовая выгрузка
   файлом для импорта.
2. **IBAN на сущностях** — для bulk-export нужен IBAN получателя, а его
   негде хранить: `counterparties` без него, `scheduled_payments` без него,
   `expenses` тоже. Каждый раз вписывать вручную = плохой UX.

## Решение

### 1. IBAN на трёх сущностях + cross-fill flow

Миграция `20260526002416_bank_account_iban.sql`:

- `counterparties.bank_account_iban TEXT` (опц)
- `scheduled_payments.bank_account_iban TEXT` (опц)
- `scheduled_payments.counterparty_id uuid REFERENCES counterparties` (раньше
  было только `vendor_name text`)
- `expenses.bank_account_iban TEXT` (опц)

Cross-fill flow в `ExpenseFormModal`:

1. **Auto-fill при выборе counterparty** — useEffect наблюдает за
   `counterparty_id`; если у counterparty есть `bank_account_iban` и поле
   IBAN формы пусто → подставляется автоматически.
2. **Confirm-prompt при submit** — если введён IBAN ≠ counterparty.iban
   (или counterparty.iban=null) → `window.confirm("Сохранить IBAN
контрагенту?")`. На «Да» → UPDATE counterparties + invalidate cache.
   На следующих платежах этому контрагенту IBAN auto-fill сам.

Auto-fill из внешних источников:

- **OCR** (`ocr-receipt` edge function) — Claude Haiku 4.5 vision prompt
  расширен полем `vendor_iban`. На фактуре EB ищет «Numer konta / IBAN»,
  возвращает строку без пробелов. Заполняется в form + опц в CounterpartyEditModal prefill.
- **KSeF** (`ksef-proxy.parseInvoiceXml`) — экстракт `<NrRBPL>` (PL-приоритет)
  или `<NrRB>` из FA(2)/FA(1) XML. При insert expense сразу пишется в
  `expenses.bank_account_iban`.

### 2. Bulk-export — SEPA XML + Elixir-O

Frontend-генерация файла, без edge function (нет смысла грузить server).

**SEPA XML pain.001.001.03** (`lib/banking/sepa-xml.ts`):

- ISO 20022 стандарт, принимают все EU банки (PKO BP, Santander, mBank,
  ING, Pekao, Millennium, Alior, Citi Handlowy, BNP Paribas, Crédit Agricole,
  Deutsche Bank, Sparkasse, Commerzbank, …).
- Multi-currency: payments группируются по валюте в разные `<PmtInf>` блоки
  внутри одного `<CstmrCdtTrfInitn>` (ограничение стандарта — одна валюта
  на PmtInf).
- XML-escape + slice до 35/140 символов по спеке.

**Elixir-O** (`lib/banking/elixir-o.ts`):

- Польский текстовый формат, 14 запятыми разделённых полей. Принимают все
  основные PL банки.
- Только PLN→PLN (PL-IBAN с обеих сторон). 4×35 escape для длинных имён
  через `|` separator. CRLF line endings, ISO-8859-2 совместимый.
- Опция для юзеров чьим банкам SEPA XML почему-то не нравится (legacy
  установки PKO/Santander иногда требуют именно Elixir-O).

**UI flow в `ExpensesPage` → tab «Не оплачено»**:

1. Кнопка «Экспорт в банк» → toggle mode выбора (чекбоксы перед строкой)
2. При selectedIds.size > 0 → primary-кнопка «Экспорт (N)»
3. Модалка `BankExportDialog`:
   - Счёт-источник: либо select из подключённых через Enable Banking
     `bank_accounts` (auto-pick первого), либо manual IBAN
   - Дата исполнения (default = next business day)
   - Формат — SEPA XML / Elixir-O
   - Summary с подсветкой платежей без IBAN получателя (skip)
4. «Скачать файл» → Blob+anchor.click() триггерит download. Юзер вручную
   загружает в bank-клиент.

### 3. Embed страниц в Link-модалки (UX-симметрия)

Симметрично выбору расхода/дохода для связи: вместо мини-пикера
(`LinkTransactionDialog`) и обратной (`LinkExpense/Visit/OtherIncomeToBankDialog`)
теперь embed полноценные страницы в широкой модалке (1100px).

- `LinkTransactionDialog` direction='debit' → embed `ExpensesPage` без
  таба «Банкинг» (recursive UX), с props `embedded` / `pickerSalonId` /
  `onPickExpense` / `hideBankingTab`. Локальный state вместо URL params
  чтобы не дёргать history родителя.
- `LinkTransactionDialog` direction='credit' → embed `IncomePage` с теми же
  props (+ `onPickVisit` / `onPickOtherIncome`). Forced list-view в
  VisitsPage (в календаре пикать неудобно).
- `LinkExpense/Visit/OtherIncomeToBankDialog` (обратные) → embed
  `BankingTransactionsTable` с props `onPickTransaction` / `unlinkedOnly`.

## Альтернативы, которые рассматривали

- **Backend-генерация SEPA XML через edge function** — отклонено: нет PII
  на сервере не нужно, frontend генерация дешевле (€0 vs edge func runtime),
  user может в DevTools посмотреть что мы отправляем (transparency).
- **Сохранение истории экспортов в БД** (`payment_export_batches` таблица) —
  отклонено для MVP. Юзер скачивает файл, дальше его responsibility
  не загружать дважды. Если статистика «когда экспортировал» будет нужна —
  добавим отдельной миграцией.
- **MT940 формат** — отклонён: это формат **выписки** (bank → клиент),
  а не **инструкции платежа** (клиент → bank). Перепутан в multiple online
  guides, но реально для outbound нужны pain.001 / Elixir-O.
- **Per-bank custom форматы** (PKO Elixir-O legacy v1, mBank CSV) — пока
  не нужны, SEPA XML + Elixir-O покрывают 95%+ кейсов. Если конкретный
  банк откажется — добавим отдельным форматом.
- **Жёсткая валидация IBAN на DB-level через CHECK** — отклонена: разные
  страны имеют разную длину (15..34), наш CHECK ошибочно мог бы blokować
  валидные IBAN. Валидация ISO-13616 mod-97 на клиенте + опц в `BankExportDialog`
  (с UI warning при невалидном).

## Последствия

### Положительные

- Закрывает второй болевой паттерн: «у меня 10 платежей на месяц, я их
  весь час вбиваю в банк» → 1 минута на экспорт + загрузку.
- IBAN cross-fill убирает повторное вписывание для одного и того же
  поставщика.
- OCR/KSeF auto-fill IBAN — для бухгалтерских клиентов IBAN заполняется
  сам без касания юзера.
- Embed страниц в Link-модалки даёт привычный UX (фильтры/структура/табы
  как на основной странице), не нужно учить отдельный pickeр.

### Отрицательные

- SEPA XML требует валидного IBAN дебитора + бенефициара. Без них
  bulk-export не сработает — добавлен summary с подсветкой невалидных
  строк, но UX-friction есть.
- Confirm-prompt через `window.confirm` — не цивилизованная Radix-модалка.
  Если будут жалобы на UX — заменим на полноценную дочернюю модалку.
- Embed страниц в модалки удваивает контекст (loaded UI + child UI). Лимит
  пока 1100px на DialogContent — на мобильных устройствах может быть тесно.
  Сейчас банкинг тестируется на десктопе, мобильная адаптация — отдельная задача.

### Что мониторим

- Если конкретный PL банк откажется принимать SEPA XML — добавляем native
  per-bank формат (PKO Elixir-O, mBank CSV).
- Если confirm-prompt при IBAN-cross-fill раздражает юзеров — заменяем
  на молчаливый upsert + undo-toast.
- Если OCR vendor_iban даёт false positive (читает левую цифру за IBAN) —
  добавляем ISO-13616 mod-97 валидацию на сервере перед записью в БД.

## Ссылки

- ADR-024: `decisions/024-banking-enable-banking-psd2.md` (базовая
  архитектура банкинга — этот ADR расширяет outbound-side).
- Миграции: `supabase/migrations/20260526002416_bank_account_iban.sql`
- Frontend: `apps/web/src/lib/banking/{sepa-xml,elixir-o,iban,extract-document-number}.ts`,
  `apps/web/src/routes/expenses/BankExportDialog.tsx`,
  `apps/web/src/routes/expenses/ExpensesPage.tsx` (embed + bulk-export UI),
  `apps/web/src/routes/income/IncomePage.tsx` + `VisitsPage` + `SalesTab`
  (embed props),
  `apps/web/src/routes/banking/{LinkTransactionDialog,LinkExpenseToBankDialog,
 LinkVisitToBankDialog,LinkOtherIncomeToBankDialog,BankingTransactionsTable}.tsx`
  (embed-mode).
- Edge functions: `supabase/functions/ocr-receipt/index.ts` (vendor_iban в prompt),
  `supabase/functions/ksef-proxy/api.ts` (sellerIban в parseInvoiceXml).
- Тесты: `apps/web/src/lib/banking/{iban,sepa-xml,elixir-o,extract-document-number}.test.ts`
  (53 unit-теста).
- Стандарт SEPA pain.001.001.03: https://www.iso20022.org/iso-20022-message-definitions
- Стандарт Elixir-O: https://elixir.kir.pl/standard-elixir/
