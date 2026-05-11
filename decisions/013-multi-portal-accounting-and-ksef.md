# 013 — Multi-portal accounting + прямой коннект к КСеФ

**Статус:** Принято · 2026-05-10
**Зависимые ADR:** ADR-002 (Pragmatic Privacy), ADR-011 (wFirma encryption), ADR-012 (wFirma auto-login)

## Контекст

После TASK-31 (wFirma) появилась потребность подключить ещё несколько польских бухгалтерских порталов: **Fakturownia**, **iFirma**, **360Księgowość**, **inFakt**. Параллельно — **прямой коннект к КСеФ** (Krajowy System e-Faktur, государственный реестр).

Главные форcы:

1. С 1 апреля 2026 КСеФ **обязателен** для всех VAT-плательщиков в PL. Любая фактура поставщика к VAT-салону **уже** оседает в его учётной системе через КСеФ-pull (если она есть).
2. **Многие маленькие салоны не выставляют фактуры — только чеки** (paragony fiskalne). У них нет wFirma/Fakturownia. Для них КСеФ — единственный канал получить фактуры **от поставщиков** (косметики, аренды, рекламы) автоматически. Делаем им прямой коннект.
3. Один и тот же расход **может прийти из нескольких источников**: КСеФ (структурированный), wFirma/Fakturownia (синкают КСеФ + добавляют категорию), банкинг (платёж зашёл), OCR (юзер сфотографировал чек). Нужна детерминированная дедупликация.
4. Шифрование секретов — мы уже сделали для wFirma (ADR-011, AES-256-GCM в Edge Function). Эту же модель применяем к новым порталам — каждому свой ключ.

## Решение

### A. Множественные провайдеры через один паттерн

Все новые порталы используют ту же таблицу `salon_integrations` (provider — text, не enum, добавление новых не требует миграции). Каждый портал получает свою edge function `<portal>-proxy` со стандартными actions: `connect_*`, `sync`, `push_expense`, `disconnect`, `cron_sync_one`. Каждому свой cron + триггер-таблица (`<portal>_sync_triggers`).

Поддерживаемые порталы (на момент ADR):

| Provider id         | Auth                                     | Pull faktur | Push expense | Status                                 |
| ------------------- | ---------------------------------------- | ----------- | ------------ | -------------------------------------- |
| `wfirma`            | accessKey/secretKey/appKey               | ✓           | ✓            | done (TASK-31)                         |
| `ksef`              | NIP + token из «Mój KSeF» (sessionToken) | ✓           | —            | TASK-46                                |
| `fakturownia`       | subdomain + api_token                    | ✓           | ✓            | TASK-47                                |
| `infakt`            | api_token (партнёрский доступ)           | ✓           | ✓            | TASK-50 (заявка отправлена 2026-05-11) |
| ~~`ifirma`~~        | —                                        | —           | —            | отменено 2026-05-11 решением владельца |
| ~~`ksiegowosc360`~~ | —                                        | —           | —            | отменено 2026-05-11 решением владельца |

### B. Прямой КСеФ — только pull, только token-auth (KSeF API 2.0)

Решение пользователя: **только pull входящих фактур**. Push своих фактур (если салон выставляет) — отдельный TASK когда понадобится. 95% салонов своих фактур не выставляют (только paragony) — push не приоритет.

**Используется KSeF API 2.0** (текущая версия, спецификация https://github.com/CIRFMF/ksef-api). Старый KSeF API 1.0 deprecated.

Аутентификация — **только токен** из «Mój KSeF»:

1. Юзер логинится в [`ksef.mf.gov.pl`](https://ksef.mf.gov.pl) через Profil Zaufany
2. В разделе «Tokeny» создаёт authentication token (роли: «Wgląd w faktury»)
3. Копирует в наш onboarding-dialog → мы его шифруем и сохраняем

Альтернативные методы (XAdES signature через `/auth/xades-signature`, ePUAP-печать) — **не делаем**. Они требуют upload .p12 файла или серверной интеграции с госуслугой; для 90% юзеров это слишком сложно.

**KSeF 2.0 auth flow** (см. `supabase/functions/ksef-proxy/api.ts`):

1. `GET /security/public-key-certificates` — динамически берём актуальный RSA сертификат (usage=`KsefTokenEncryption`, самый свежий `validFrom`)
2. `POST /auth/challenge` (empty body) → `{ challenge, timestamp (ms) }`
3. Encrypt `${token}|${timestampMs}` через RSA-OAEP-SHA256 публичным ключом сертификата → base64
4. `POST /auth/ksef-token { challenge, encryptedToken, contextIdentifier: { type: 'nip', value }, publicKeyId }` → `{ authenticationToken.token (JWT), referenceNumber }`
5. `POST /auth/token/redeem` с `Authorization: Bearer <authenticationToken>` → `{ accessToken, refreshToken }`
6. Все последующие: `Authorization: Bearer <accessToken>`
7. При истечении — `POST /auth/token/refresh` (на будущее; для cron-sync проще получить новую сессию)

**Среды (KSeF API 2.0):**

- `KSEF_DEFAULT_ENV=test` → `https://api-test.ksef.mf.gov.pl` (тестовая)
- `KSEF_DEFAULT_ENV=demo` → `https://api-demo.ksef.mf.gov.pl` (pre-production)
- `KSEF_DEFAULT_ENV=prod` → `https://api.ksef.mf.gov.pl` (боевая)

**Invoice endpoints (2.0):**

- `POST /invoices/query/metadata` — список фактур с фильтрами (`subjectType=Subject2` для входящих, `dateRange.from/to`, pageOffset/pageSize)
- `GET /invoices/ksef/{ksefNumber}` — скачать одну фактуру (XML FA(2))

Тестовый NIP для разработки — из `memory/wfirma_test_account.md` (тестовая компания владельца).

### C. Шифрование секретов — отдельный ключ на провайдер

По образцу ADR-011, каждый портал имеет свой `*_SECRETS_KEY` (32 байта base64) в Supabase Edge Function secrets:

- `WFIRMA_SECRETS_KEY` — есть
- `KSEF_SECRETS_KEY` — новый, шифрует token
- `FAKTUROWNIA_SECRETS_KEY` — новый, шифрует api_token
- `IFIRMA_SECRETS_KEY` — новый, шифрует api_key
- `KSIEGOWOSC360_SECRETS_KEY` — новый, шифрует api_token
- `INFAKT_SECRETS_KEY` — новый (когда добьёмся партнёрского доступа)

Отдельные ключи а не один общий — компрометация одного не задевает другие. AES-256-GCM, IV per row, `base64(iv ‖ ciphertext_with_tag)` — паттерн из `wfirma-proxy/crypto.ts`.

### D. Source-of-truth priority и дедупликация по `ksef_id`

Когда юзер подключил **wFirma + КСеФ + банкинг**, одна фактура в принципе может прийти **трижды**:

1. КСеФ-pull добавил → `expenses.source='ksef'`, `external_id=<ksef_referenceNumber>`, `metadata.ksef_id=<NumerKSeF>`
2. wFirma уже синкнула эту же фактуру (КСеФ → wFirma → expenses) → `expenses.source='wfirma'`, тот же `metadata.wfirma_ksef_id=<NumerKSeF>`
3. Банкинг увидел платёж к этому фактору → может создать черновую expense с `metadata.bank_tx_id=...`

Дедуп — **по `ksef_id`**, который уникален в реестре. Алгоритм:

1. Каждая интеграция при создании expense пишет `ksef_id` в `metadata` (даже КСеФ-pull сам — там же есть NumerKSeF).
2. Перед инсертом sync-функция чеатает: «есть ли уже expense в этом салоне с тем же `ksef_id`?». Если есть и приоритет нового источника **выше** — обновляем, иначе скипаем.
3. Приоритет источников (от высшего к низшему): `wfirma > fakturownia > ifirma > ksiegowosc360 > infakt > ksef > ocr > manual`. Бухгалтерские системы знают категорию (контировку), КСеФ — нет; OCR угадывает; ручной ввод — самый низкий, его юзер делает только когда нет других каналов.
4. Банкинг **никогда** не создаёт expense — только связывает платёж с существующим (отдельный flow в `banking-sync`).

Формализация в SQL (миграция TASK-51):

```sql
-- Уникальный частичный индекс: одна фактура с этим ksef_id на салон
create unique index idx_expenses_salon_ksef_id
  on public.expenses ((metadata->>'ksef_id'))
  where metadata->>'ksef_id' is not null and deleted_at is null;
```

Конфликт при insert → catch UNIQUE_VIOLATION → решение по приоритету.

### E. UI: страница `/integrations` — категории

Сейчас все провайдеры свалены в одну сетку. Делим на 4 секции:

1. **Бухгалтерия и фактуры** — wFirma, Fakturownia, iFirma, 360Księgowość, inFakt, KSeF
2. **Запись и календарь** — Booksy, Fresha, Treatwell, YCLIENTS
3. **Банкинг** — Salt Edge (одна спец-секция, multi-bank)
4. **Документы и OCR** — настройки распознавания чеков

Сделано в TASK-45.

## Альтернативы, которые рассматривали

- **Один универсальный «accounting» провайдер с adapter-pattern.** Отклонено: API отличаются настолько (REST/SOAP, auth, pagination, error-shapes), что общий слой превращается в большой switch. Лучше копия-паста с явной структурой per-provider, чем фейковая абстракция.
- **Push своих фактур через КСеФ из Finkley.** Отклонено для MVP: салоны без wFirma фактур не выставляют (только чеки); для тех, у кого wFirma — push идёт через wFirma. Включим если будут запросы.
- **OAuth-flow для КСеФ.** Отклонено: КСеФ не даёт OAuth консьюмерам. Только token-based + qualified signature. Token — easy path.
- **pgsodium для шифрования secrets.** Отклонено по тем же причинам что в ADR-011: усложняет миграции, AES в Edge Function — банальнее и легче ротации.
- **Comarch Optima ERP.** Отклонено: десктопный ERP для средних компаний, не для салонов; XML-RPC через лицензированный модуль. Reality-check ушёл против.

## Последствия

### Положительные

- Юзер выбирает удобную ему точку входа: бухгалтер → wFirma/Fakturownia/...; самозанятый-без-бухгалтера → КСеФ direct; полностью оффлайн → OCR.
- Дедупликация по `ksef_id` детерминирована — не зависит от очерёдности sync.
- Шифрование per-portal — взлом одного ключа не открывает остальные.
- Каждый портал — отдельный edge function + cron, легко отключить если API сломалось.

### Отрицательные

- 5 новых edge functions + 5 миграций (cron + sync triggers) + 5 connect-dialogs. Кодовая база ~+3 KLOC.
- Юзер с подключёнными КСеФ + wFirma может видеть «дублёров» в первые 1-2 sync до момента когда `ksef_id` в обоих сравняется. Митигация — sync-ы wFirma/Fakturownia всегда **первыми** в cron-последовательности (priority=1), КСеФ — **после** них (priority=2).
- inFakt — заблокирован партнёрским доступом, может затянуться.

### Что мониторим

- Если в Sentry начнут массово появляться `KSEF_TOKEN_EXPIRED` (KSeF 2.0 токены могут протухать чаще) — добавим автоматическое продление через `auth/SessionRefresh`.
- Если в `expenses` появятся «дублёры» (одинаковый `ksef_id` в разных строках) — баг в дедуп-логике, чиним.
- Если КСеФ-API изменит контракт (FA(2) → FA(3)) — следим за анонсами на `ksef.mf.gov.pl`, обновляем парсер.

## Ссылки

- [ADR-002 Pragmatic Privacy](./002-encryption-strategy.md)
- [ADR-011 wFirma credentials encryption](./011-wfirma-credentials-encryption.md)
- [ADR-012 wFirma auto-login](./012-wfirma-auto-login.md)
- [KSeF API documentation (PL)](https://ksef.mf.gov.pl/api/Help)
- [Fakturownia API](https://app.fakturownia.pl/api)
- [iFirma API](https://api.ifirma.pl/)
- [360Księgowość API](https://www.360ksiegowosc.pl/api/)
