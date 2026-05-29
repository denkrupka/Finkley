# ADR-017: Booksy full sync — scope, ownership, tiered intervals

**Статус:** Принято · 2026-05-19
**Контекст:** Расширяем существующую Booksy-интеграцию (ADR-008) с минимального синка staff/services/visits до полного двустороннего источника правды по каталогу + clients + history. Параллельно — фиксируем модель «portal-owned» жизненного цикла визитов, чтобы починить три бага, повторявшиеся в прошлой Excel-автоматизации владельца (дубли при синке, наложение визитов, перетирание ручных правок при изменении/удалении в Booksy).

Решение опирается на закрытый опрос владельца (см. конец документа, раздел «Утверждённый выбор»).

---

## 1. Scope синка — что тянем

| Сущность                               | Tier                                  | Источник Booksy                                                        | Anti-overwrite   |
| -------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| Услуги (имя, длительность, цена)       | hourly                                | `/me/businesses/{biz}/service_categories` + `dry_run`                  | Да               |
| Мастера: имя, email, телефон           | hourly                                | `/me/businesses/{biz}/resources` + `/me/resources/{id}` (см. §13)      | Да               |
| Мастера: рабочие часы (weekly)         | hourly                                | `/me/businesses/{biz}/shifts/resources/{staff_id}/working_hours`       | Да               |
| Мастера: commission % (service+retail) | hourly                                | `/me/businesses/{biz}/pos/commissions/resource/{staff_id}` (см. §13.5) | Да               |
| Часы работы салона (weekly)            | hourly                                | `/me/businesses/{biz}/shifts/opening_hours`                            | Да               |
| Клиенты: имя, телефон, email, скидка   | 20 минут                              | `/me/businesses/{biz}/customers?page=N&per_page=20&compact=true`       | Да               |
| История визитов клиента                | initial bootstrap + ленивая подгрузка | `/customers/{id}/bookings?state=active\|inactive`                      | Дубль-защита     |
| Визиты + статус оплат                  | user-interval (2..1440 мин)           | `/calendar` + `/appointments/{uid}` + `baskets`                        | **Portal-owned** |

«Anti-overwrite» = если запись уже создана локально и поле было редактировано вручную (`updated_at > created_at + 1s` или явный флаг), Booksy при синке **не** перезаписывает это поле. См. §4.

«Portal-owned» = визит после первичной записи в портал **полностью** отрывается от Booksy. Никакие правки, удаления, изменения статуса в Booksy на него не влияют. См. §3.

---

## 2. Tiered cron — один pg_cron, внутренние таймеры

**Решение:** оставляем существующий `booksy-auto-sync` (каждые 2 минуты) как единственный job. Внутри `cron_run_booksy_syncs()` для каждой интеграции считаем что именно due:

```
visits   due ⇔ now() - last_sync_at         ≥ sync_interval_minutes (user-выбор)
clients  due ⇔ now() - last_clients_sync_at ≥ 20 минут
catalog  due ⇔ now() - last_catalog_sync_at ≥ 60 минут
```

Если due ≥ 1 секции — кикаем edge function с `{action:'cron_sync_one', salon_id, token, tiers: ['visits','clients','catalog']}`. Edge function проходится по перечисленным tier'ам в одном запросе, обновляет соответствующие `last_*_sync_at`.

**Почему один cron:** дешевле (один tick = один net.http_post), проще операционно (нет race condition между тремя независимыми job'ами на одну интеграцию), не плодим rendezvous-токены.

**Почему не делаем «visits=user-interval тянем ТОЛЬКО новые визиты»** как отдельный tier синтаксически: это и так делается в самом синке через bulk-load `existingVisits` (см. `syncVisits`). Tier для визитов — это **частота запроса календаря**, а не «только новые vs всё». Календарь всё равно сравнивается с локальной БД через `external_id`.

---

## 3. Portal-owned жизненный цикл визитов

Главный сдвиг архитектуры. Booksy перестаёт быть источником правды на визите с момента, когда визит впервые попал к нам.

### 3.1 Правила записи

При синке `/calendar`:

1. **Создание:** если в локальной БД нет визита с `(salon_id, source='booksy', external_id='subbk:{b.id}')` — `INSERT`. Цена/статус/payment_method берём из Booksy с учётом флагов из §5.
2. **Существует:** **полный skip**. Никакого `UPDATE`. Это `onConflict: ignoreDuplicates`. Текущий код уже так делает (`{ onConflict: 'salon_id,source,external_id', ignoreDuplicates: true }`) — фиксируем как контракт.
3. **Удаление в Booksy:** при флаге `booksy_can_delete_visits=true` (см. §5) визит, ранее импортированный — **не удаляем** локально, даже если Booksy вернул `status='X'` (cancelled) или вообще убрал бронь из `/calendar`. При флаге `false` — то же поведение (мы не пытаемся «синхронизировать удаления», слишком рискованно). Удаление локального visit — только ручная операция в портале.

### 3.2 Защита от «наложения» (один из багов Excel-бота)

Причина бага: один Booksy `appointment_uid` мог дать несколько subbookings, и при разных форматах external_id один визит писался дважды на одну временную точку.

Защита:

- **Единый формат external_id**: `subbk:{calendar_booking.id}` (один subbooking = одна visit-запись). Уже введён.
- **`UNIQUE (salon_id, source, external_id)` на `visits`** — уже есть в init-миграции.
- **Доп. проверка при INSERT**: если в течение ±1 минуты на том же `staff_id` и `client_id` уже есть визит — пишем warning в `sync_logs` и пропускаем. Это страховка от Booksy-side дублей (когда юзер сам создал две брони в одну минуту).

### 3.3 Защита от перетирания ручных правок (второй баг Excel-бота)

Поскольку §3.1.2 запрещает любой `UPDATE` существующих визитов из Booksy — баг невозможен by design. Ручные правки `amount_cents`, `status`, `payment_method`, `staff_id`, `discount_cents` живут вечно.

Edge case: если визит ещё не оплачен (`status='pending'`) и юзер хочет, чтобы Booksy всё-таки обновлял цену когда он там её проставит — **отдельная фича в будущем**, не в MVP. В MVP — строгий portal-owned.

---

## 4. Anti-overwrite для каталога (мастера/услуги/часы/клиенты)

В отличие от визитов, каталог разумно держать в синке — юзер ожидает, что переименование услуги в Booksy подтянется. Но он также ожидает, что если он переопределил `payout_percent` мастера в портале (Booksy его не знает или знает иначе), его правка не сотрётся.

### 4.1 Правило перезаписи

Для полей, которые синкаем из Booksy: перезаписываем только если **локальное значение совпадает с предыдущим значением из Booksy** (т.е. не было ручной правки). Реализация:

В `staff_integration_state` (новая таблица; см. §6) храним snapshot последнего Booksy-значения по каждому полю. При следующем синке:

```
if booksy_now != booksy_prev:               # Booksy изменил
    if local_value == booksy_prev:           # юзер не трогал
        local_value := booksy_now            # → обновляем
    else:                                    # юзер переопределил
        log "manual override preserved"      # → не трогаем
    booksy_prev := booksy_now                # snapshot обновляется всегда
```

То же для `services` и `clients`. Поля под этим правилом:

- `staff`: `full_name`, `is_active`, `payout_percent`, `email`, `weekly_schedule`
- `services`: `name`, `default_price_cents`, `default_duration_min`
- `clients`: `name`, `phone`, `email`, `discount_percent`
- `salons`: `working_hours`

Snapshot хранится как jsonb `external_snapshot` на каждой записи (минимальные поля, не вся Booksy-структура).

### 4.2 Удаления каталога в Booksy

- Если мастер исчез/деактивирован в Booksy → ставим `staff.is_active = false`. Не удаляем (на нём могут висеть исторические визиты).
- Если услуга исчезла → ставим `services.is_archived = true`. То же.
- Если клиент исчез → не трогаем (клиент в нашем портале живёт собственной жизнью).

---

## 5. Onboarding-вопросы — флаги логики

После успешного `login` (но **до** первого full sync) показываем модалку с текстом:

> Эта информация нужна, чтобы правильно настроить логику синхронизации. Мы не будем менять что-либо в твоём Booksy.
>
> 1. **Ты отмечаешь статусы оплаты визитов в Booksy?** (`да` / `нет`)
> 2. **Ты иногда удаляешь визиты, которые фактически состоялись, в Booksy?** (`да` / `нет`)

Сохраняем в `salon_integrations.config jsonb`:

```json
{ "booksy_owns_payment_status": true|false,
  "booksy_can_delete_visits": true|false }
```

### 5.1 Эффект `booksy_owns_payment_status = false` (юзер НЕ отмечает) — выбор владельца 3б

С момента подключения **полностью игнорируем** поле `status` из Booksy. Все новые визиты создаём со статусом `pending`. Booksy `appointment.status='F'` (paid) → у нас всё равно `pending`. Юзер пометит оплату вручную в портале.

Логика: «у меня в Booksy всё неоплаченное висит вечно — это шум, а не сигнал».

### 5.2 Эффект `booksy_can_delete_visits = true` (юзер удаляет состоявшиеся) — выбор владельца 4а

Описано в §3.1.3. После создания локального visit — никогда не soft-delete'им и не помечаем cancelled из-за поведения Booksy.

Логика: «удаления в Booksy — это попытка оптимизировать их комиссию, не реальный жизненный цикл визита».

### 5.3 Эффект `false`/`false`

Если юзер ответил «да-да-нет», т.е. он использует Booksy «как положено»:

- Статусы оплат тянем при создании (`status='F' → 'paid'`, иначе `'pending'`). После создания всё равно portal-owned: не обновляем (§3.1.2).
- Удаления в Booksy всё равно **не** удаляют локальные визиты — мы принципиально консервативны.

### 5.4 Хранение и UI

- Флаги показываем в settings интеграции (юзер может изменить мнение).
- Изменение флага задним числом не пересчитывает уже импортированные визиты — оно влияет только на новые `INSERT`. (Альтернатива — бэкфилл — слишком рискованна; не делаем без отдельного запроса.)

---

## 6. Изменения в схеме (миграция)

Новый файл: `supabase/migrations/20260519000001_booksy_full_sync.sql`.

### 6.1 `clients.discount_percent`

```sql
alter table public.clients
  add column if not exists discount_percent numeric(5,2)
    check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100));

comment on column public.clients.discount_percent is
  'Персональная скидка клиента (0..100%). Автоматически предзаполняется в форме визита, юзер может снять.';
```

Выбор владельца 1а: percent, не cents.

### 6.2 `staff.email`, `staff.invite_sent_at`, `staff.invite_token`, `staff.commission_external_synced`

```sql
alter table public.staff
  add column if not exists email text,
  add column if not exists invite_sent_at timestamptz,
  add column if not exists invite_token uuid,
  add column if not exists external_snapshot jsonb;

create index if not exists idx_staff_invite_token on public.staff(invite_token)
  where invite_token is not null;
```

Email тянем из Booksy (выбор владельца 5). `external_snapshot` хранит snapshot последнего Booksy-значения (см. §4.1).

### 6.3 `services.external_snapshot`, `clients.external_snapshot`

```sql
alter table public.services add column if not exists external_snapshot jsonb;
alter table public.clients  add column if not exists external_snapshot jsonb;
```

### 6.4 `salons.working_hours`

```sql
alter table public.salons
  add column if not exists working_hours jsonb not null default jsonb_build_object(
    'mon', jsonb_build_object('start','09:00','end','19:00','off',false),
    'tue', jsonb_build_object('start','09:00','end','19:00','off',false),
    'wed', jsonb_build_object('start','09:00','end','19:00','off',false),
    'thu', jsonb_build_object('start','09:00','end','19:00','off',false),
    'fri', jsonb_build_object('start','09:00','end','19:00','off',false),
    'sat', jsonb_build_object('start','09:00','end','19:00','off',true),
    'sun', jsonb_build_object('start','09:00','end','19:00','off',true)
  ),
  add column if not exists working_hours_external_snapshot jsonb;
```

Тот же формат, что у `staff.weekly_schedule` — UI переиспользуем (выбор владельца 6а).

### 6.5 `salon_integrations.config` + tiered timestamps

```sql
alter table public.salon_integrations
  add column if not exists config jsonb not null default '{}'::jsonb,
  add column if not exists last_clients_sync_at timestamptz,
  add column if not exists last_catalog_sync_at timestamptz;
```

`config` для booksy: `{ booksy_owns_payment_status, booksy_can_delete_visits }`. Другие провайдеры могут хранить своё (например, wFirma).

Расширяем `salon_integrations_public` view:

```sql
create or replace view public.salon_integrations_public as
  select id, salon_id, provider, status, last_sync_at, last_sync_stats,
         last_error, connected_at, updated_at, sync_interval_minutes,
         config, last_clients_sync_at, last_catalog_sync_at
    from public.salon_integrations;
```

### 6.6 `cron_run_booksy_syncs` — tier-aware

Переписываем функцию: внутри одного цикла по due integrations вычисляем `tiers_to_run` массивом и шлём в edge function. Edge function в `cron_sync_one` принимает `{ tiers: ['visits','clients','catalog'] }` и проходит по ним.

---

## 7. Master invite flow

После initial sync — отдельная модалка в IntegrationsPage (или в callback после `login`):

> Booksy передал {N} мастеров и {M} email'ов. Отправить им приглашения присоединиться к порталу как сотрудники?

UI: список с чекбоксами (имя, email из Booksy), редактируемое поле email если в Booksy его не оказалось. После подтверждения — RPC `send_staff_invites(staff_ids[])` → создаёт invite_token на каждого, шлёт email через edge function `send-email`. Email содержит deeplink `/invite/{token}` → юзер логинится через email-OTP и попадает в портал как member с role='staff'.

`invite_sent_at` записывается для отображения статуса в Staff UI («приглашение отправлено», «принял», «не отправлено»).

Реализация деталей этого flow — в отдельном таске; ADR фиксирует только модель данных и RPC-контракт.

---

## 8. Discount auto-apply (UI)

В `VisitForm` и `QuickEntryModal`:

- Когда юзер выбирает клиента (`client_id` меняется), грузим `clients.discount_percent`.
- Если > 0 — предзаполняем поле «Скидка» как `Math.round(amount_cents * discount_percent / 100)`.
- Поле остаётся редактируемым. Tooltip: «Из карточки клиента: {N}%».
- Если юзер уже ввёл скидку вручную — **не перезаписываем** при смене amount/услуги (флаг `discountTouched` в форме).

Выбор владельца 1а + 2а.

---

## 9. Anti-dup защита — три уровня

Чтобы повторить три бага Excel-бота было физически невозможно:

| Баг                                                        | Защита                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Дубль при синке                                            | `UNIQUE(salon_id, source, external_id)` + `onConflict: ignoreDuplicates`                                                   |
| Наложение визитов (двойной формат external_id)             | Единственный формат `subbk:{id}`, существующие by-name записи мерджатся (уже реализовано); тест на миграцию-двойной-импорт |
| Перетирание ручной правки при обновлении/удалении в Booksy | Portal-owned (§3.1.2) — никакой UPDATE на существующих, никакой DELETE из-за пропажи в Booksy                              |

Регрессионные тесты — отдельный таск (см. бэклог), но эти три кейса покрываются Vitest-тестами на функцию `syncVisits` с моком админ-клиента.

---

## 10. Что НЕ делаем сейчас

- **Push в Booksy** (создание визитов из портала → Booksy). Сейчас есть только `create_reservation` (блокирующий слот). Полноценный push — отдельная фича (риск ToS, требует ADR).
- **Cancellation sync** (изменение `status` в Booksy → soft-delete у нас). Слишком рискованно, см. §5.2.
- **Сложные ретроактивные пересчёты** при изменении флагов §5.
- **Sync продуктов / retail Booksy** — это отдельный feature scope.
- **Booksy webhook'ов** — у Booksy их нет публично, поэтому только polling.

---

## 10.1. Дробление initial sync (2026-05-30)

Изначально `action:'sync'` без `day` всегда дёргал все три tier'а в одной edge-инвокации с порядком `[catalog, clients, visits]`. Каждый tier имеет внутренний budget (catalog без лимита, clients=50s, visits=45s). На крупных салонах суммарный walltime превышал Supabase edge limit (~150s), и **visits-tier фактически не выполнялся**. Юзер импортировал мастеров через онбординг, но `/payouts` показывал «0 PLN / 0 визитов» т.к. визиты не успели импортироваться до timeout.

Фикс:

1. **Default tier order сменён на `[catalog, visits, clients]`** — critical staff/services + сами визиты идут первыми. Clients-tier (с history backfill, самый длинный) уходит в конец и при необходимости резюмируется через `clients_resume_page` (T115) при следующем cron tick.
2. **`action:'sync'` теперь принимает optional `tiers: string[]`** — позволяет UI дробить тяжёлый initial sync на отдельные edge-вызовы, каждый со своим walltime budget. `BooksyConnectDialog` после получения config делает 2 последовательных вызова: `tiers:['catalog','visits']` (ждём результат для toast), затем fire-and-forget `tiers:['clients']`.

Cron-job `cron_run_booksy_syncs` продолжает работать как раньше — он сам решает какие tier'ы due (см. §2), и Supabase edge wall для каждой due-комбинации обычно укладывается в budget.

---

## 11. Утверждённый выбор владельца (2026-05-19)

1. **Скидка клиента:** `discount_percent` (0–100).
2. **Auto-apply скидки:** предзаполняется в форме, юзер может снять.
3. **`booksy_owns_payment_status=false`:** игнорируем status из Booksy полностью, все новые → `pending`.
4. **`booksy_can_delete_visits=true`:** после создания локального visit — никогда не soft-delete из-за Booksy.
5. **Master email:** тянем из Booksy (`/staffers/{id}` или сопутствующего endpoint).
6. **Working hours:** jsonb на `salons.working_hours` и (уже есть) `staff.weekly_schedule`.
7. **История визитов клиента:** тянем все исторические визиты при матче клиента, anti-dup по external_id, окно «60 дней» снимается для импорта по клиенту.
8. **Tier-cron:** один pg_cron каждые 2 минуты, внутри решает что syncать.

---

## 13. Фильтрация Booksy resources (Recepcja/Admin) и схема `/me/resources/{id}`

Анализ HAR `111booksy.com.har` (3 ресурса из реального салона владельца) показал, что Booksy `resource` = любая «учётная единица», включая Recepcja и Administrator. Существующий sync импортирует их всех как `staff`, что неправильно.

### 13.1 Поля карточки `GET /me/resources/{id}`

```jsonc
{ "resource": {
  "id": 631299,
  "type": "S",                          // одинаковый у всех ролей — НЕ дискриминатор
  "name": "Viktoria",
  "active": true,
  "visible": true,                      // показывается клиентам для онлайн-брони
  "visible_on_calendar": true,
  "position": "",                       // у Admin/Recepcja бывает "Administrator"/"Admin"
  "description": "",
  "staff_user_exists": true,
  "is_invited": false,
  "invited": null,
  "staff_email": "sssngv00@gmail.com",  // EMAIL мастера
  "staff_cell_phone": "539 178 458",
  "staff_access_level": "staff",        // <-- 'staff' | 'manager' | 'reception' — главный дискриминатор
  "services": [2139447, ...],           // <-- пустой у не-мастеров
  "working_hours": [
    { "day_of_week": 0, "hours": [{"hour_from": "12:00", "hour_till": "20:00"}] },
    ...
  ],
  "reviews_rank_avg": 5.0,
  "photo_url": "..."
}}
```

### 13.2 Сравнение 3 ресурсов из HAR владельца

| Resource ID | name         | access_level | services | visible | Импортируем? |
| ----------- | ------------ | ------------ | -------- | ------- | ------------ |
| 631299      | Viktoria     | `staff`      | 11       | true    | ✅           |
| 266816      | Denys Krupka | `manager`    | 0        | false   | ❌           |
| 550740      | Daria        | `reception`  | 0        | true    | ❌           |

### 13.3 Правило фильтра

```ts
function shouldImportAsStaff(detail: ResourceDetail): boolean {
  // Booksy сам классифицирует — доверяем
  if (detail.staff_access_level !== 'staff') return false
  // Двойная защита: реальный мастер должен иметь хотя бы одну услугу
  return (detail.services?.length ?? 0) > 0
}
```

**Бэкфилл существующих:** при первом запуске нового sync — пройти по уже импортированным `staff` с `external_source='booksy'`, GET-нуть `/me/resources/{external_id}`, для тех кто `access_level !== 'staff'`:

- Если на staff нет визитов → hard-delete.
- Если есть визиты → `is_active=false` + пометить `external_snapshot.filtered_out=true` (не пересоздавать).

### 13.4 Endpoint strategy

`GET /me/businesses/{biz}/resources` (list) возвращает только `{id, name, is_active}` — недостаточно для фильтра. Поэтому synс работает так:

1. Получаем список IDs → `resources[]`.
2. Для каждого — `GET /me/resources/{id}` (параллельно, max 5 concurrent).
3. Применяем `shouldImportAsStaff`.
4. Для прошедших фильтр — `GET /me/businesses/{biz}/pos/commissions/resource/{id}` (см. §13.5).

N=3–20 ресурсов на салон, hourly tier → ~2N запросов в час на интеграцию. В рамках любого reasonable rate-limit Booksy.

### 13.5 Commission % — отдельный endpoint

Карточка `/me/resources/{id}` сама commission не содержит. Но есть отдельный endpoint, найденный в HAR-2 владельца:

```
GET /me/businesses/{biz}/pos/commissions/resource/{staff_id}
→ {
  "commission_defaults": {
    "service_commission_type": "%",  "service_commission_rate": "40.00",
    "product_commission_type": "%",  "product_commission_rate": "0.00",
    "egift_commission_type": "%",    "egift_commission_rate": "0.00",
    "membership_commission_type": "%", "membership_commission_rate": "0.00",
    "package_commission_type": "%",  "package_commission_rate": "0.00"
  }
}
```

Маппинг в нашу схему:

- `service_commission_rate` (когда `service_commission_type === '%'`) → `staff.payout_percent`
- `product_commission_rate` → `staff.retail_payout_percent`
- Остальные (egift/membership/package) — игнорируем в MVP, добавим если возникнет спрос.

`commission_type === 'amount'` (фиксированная сумма) — в MVP не поддерживаем (наша схема `staff.payout_percent` хранит только %). Если в данных юзера встретим — логируем warning, не трогаем локальное значение. Решим что делать когда первый юзер с fixed-amount commission подключится.

`weekly_schedule` мастера и `email` — sync'аем из `/me/resources/{id}`.

---

## 14. Полный endpoint reference (подтверждено HAR-захватами владельца)

### 14.1 Salon working hours

```
GET /me/businesses/{biz}/shifts/opening_hours
→ {
  "opening_hours": [
    {"day_of_week": 1, "hours": [{"hour_from": "10:00", "hour_till": "20:00"}]},  // Пн
    {"day_of_week": 2, "hours": [{"hour_from": "10:00", "hour_till": "20:00"}]},  // Вт
    ...
    {"day_of_week": 0, "hours": [{"hour_from": "12:00", "hour_till": "20:00"}]}   // Вс
  ],
  "hours_apply_from": "2026-05-20"
}
```

`day_of_week`: 0=Sun..6=Sat. `hours[]` может содержать несколько интервалов (lunch break). Если день отсутствует в массиве → выходной.

Маппинг в `salons.working_hours` (наш формат `{mon|tue|...: {start, end, off}}`):

- `day_of_week=0` → `sun`, `1` → `mon`, ..., `6` → `sat`
- Если у дня одна пара hours → `{start, end, off: false}`
- Если дня нет → `{start:'00:00', end:'00:00', off: true}`
- Множественные интервалы (split shift) — пока сохраняем только первый, в `external_snapshot` пишем весь raw

### 14.2 Staff working hours

```
GET /me/businesses/{biz}/shifts/resources/{staff_id}/working_hours
→ {
  "resource_id": 266816,
  "working_hours": [
    {"day_of_week": 2, "hours": [{"hour_from": "09:45", "hour_till": "19:45"}]}
  ],
  "hours_apply_from": "2026-05-20"
}
```

Тот же формат, маппинг в `staff.weekly_schedule`.

### 14.3 Customers list

```
GET /me/businesses/{biz}/customers?page=N&per_page=20&compact=true
→ {
  "count": 2592,
  "page": 1,
  "per_page": 20,
  "customers": [{
    "id": 102049610,
    "first_name": "Ada",
    "last_name": "Mroczek",
    "cell_phone": "519 137 826",
    "email": "iwantchangesnow@gmail.com",
    "blacklisted": false,
    "visit_frequency": 1,
    "no_shows": 0,
    "first_visit": false,
    "is_user": true,
    "discount": 0,                       // <-- скидка клиента (предполагаем %)
    "badge": "from_promo",
    "from_promo": true,
    "invited": false,
    "customer_profile": {                 // null если клиент не зареган в Booksy app
      "birthday": "1998-12-30",
      "full_name": "...", "first_name": "...", "last_name": "...",
      "cell_phone": "...", "email": "...",
      "marketing_agreement": true, "privacy_policy_agreement": true,
      "accepts_push": true,
      "address_line_1": "", "address_line_2": "", "city": null, "zipcode": null,
      "photo": null
    },
    ...
  }]
}
```

### 14.4 Customer detail

```
GET /me/businesses/{biz}/customers/{id}
→ {
  "customer": {
    "_id": 102049610,
    "recent_visit": "2026-02-03T12:50:00",
    "visit_frequency": 1, "no_shows": 0, "booking_count": 1, "canceled": 0,
    "revenue": 0.0,
    "business_customer": {
      "id": 102049610, "business": 135992,
      "first_name": "", "last_name": "", "full_name": "",
      "cell_phone": "+44 7726 695687", "email": "",
      "business_secret_note": "",        // приватные заметки для салона
      "blacklisted": false,
      "discount": 0,                     // <-- скидка
      "allergens": "",
      "tax_id": "",
      "client_type": "BD",
      "trusted": false,
      "bookmarked": false,
      "marketing_agreement": false,
      "privacy_policy_agreement": false
    },
    "bookings": [...]                    // последние ~10 визитов embedded
  }
}
```

### 14.5 Customer bookings (история)

```
GET /me/businesses/{biz}/customers/{id}/bookings?page=N&per_page=20&inlcude_extra_bookings=true&state=active
GET /me/businesses/{biz}/customers/{id}/bookings?page=N&per_page=20&inlcude_extra_bookings=true&state=inactive
→ {
  "count": 6,
  "page": 1, "per_page": 20,
  "bookings": [{
    "id": 614403202,                      // subbooking id
    "appointment_uid": 677539462,         // appointment id
    "type": "B",
    "booked_from": "2026-05-05T15:55",
    "booked_till": "2026-05-05T16:25",
    "booked_from_iso": "2026-05-05T15:55:00+02:00",
    "updated": "2026-05-05T13:00",
    "status": "F",                        // F=finished, C=cancelled, etc.
    "resources": [{ "id": 266813, "name": "Alina", "type": "S" }],
    "service": {
      "id": 2139432, "name": "Laminacja brwi",
      "variant": {"id": 5856633, "price": 120.00, "duration": 30},
      "staffer_ids": [266813],
      "service_category_id": 366642,
      "category_name": "Stylistka Alina"
    },
    "customer": {"id": 19262635, "name": "Denys Krupka", "phone": "...", "email": "..."},
    "payment_info": {
      "transaction_info": {
        "id": 58714772,
        "payment_type_code": "credit_card",
        "amount_text": "120,00 zł",
        "total": "120,00 zł",
        "details_line_1": "Sprzedaż, 25 maja 2024 17:16",
        "details_line_2": "Terminal płatniczy",
        "created_iso": "2024-05-25T15:16:29.406990Z",
        "receipt_number": "PL-12P-JK0",
        "payment_rows": [{
          "amount": 120.0,
          "payment_type_code": "credit_card",
          "status": "success"
        }]
      },
      "deposit_info": null,
      "booksy_pay": {...}
    },
    "total": "120,00 zł",
    "extra_bookings": [...],              // дополнительные subbookings из того же appointment
    "combo_parent_id": null,
    "combo_children": [],
    "archived": false,
    "timezone_name": "Europe/Warsaw"
  }]
}
```

Это значит: для бэкфилла истории клиента нам **не нужен** `/calendar` за прошлые годы. Достаточно пройти `/customers/{id}/bookings?state=inactive` с pagination — там вся история с полным payment_info.

### 14.6 Customer groups (tags)

```
GET /me/businesses/{biz}/customer_groups
→ {
  "groups": [
    {"name": "all_customers", "count": 2592, "label": "Wszyscy klienci"},
    {"name": "new_customers", "count": 14, "label": "Nowi klienci"},
    {"name": "most_loyal", "count": 192, "label": "Najbardziej lojalni"},
    {"name": "slipping_away", "count": 2420, "label": "Nieaktywni"},
    {"name": "blacklisted_customers", "count": 82, "label": "Zablokowani klienci"},
    ...
  ],
  "tags": [
    {"name": "#vip_00001", "count": 2},
    {"name": "#vip_00002", "count": 1},
    {"name": "#Family&Friends", "count": 2},
    ...
  ]
}
```

Built-in groups (`new_customers`, `most_loyal`, `slipping_away`) — мы их **не sync'аем** в локальную БД, у нас своя RFM-логика на `salons.retention_window_days`/`churn_window_days` (ADR-010-style retention).

Кастомные tags (#vip\_\*, #Family&Friends) — могут попадать в `clients.tags[]` если в будущем добавим маппинг (отдельный таск). В MVP не sync'аем — это enhancement.

### 14.7 Service detail

```
GET /me/businesses/{biz}/services/{service_id}
→ {
  "service": {
    "id": 6414903,
    "name": "Przedłużanie rzęs 5/8D",
    "description": "...", "description_type": "M",
    "resources": [721074],
    "padding_type": null, "padding_time": 0, "gap_time": 0,
    "tax_rate": null,
    "parallel_clients": 1,
    "color": 24,
    "variants": [{
      "id": 20708508,
      "type": "X",
      "price": "230.00",                  // как строка с точкой!
      "duration": 135,
      "time_slot_interval": 5,
      "label": "",
      "staffers": [721074]                // per-variant assignment
    }],
    "is_available_for_customer_booking": true,
    "service_code": "",
    "treatment": 265,
    "treatment_name": "Przedłużanie rzęs"
  }
}
```

В MVP синкаем `name`, `default_price_cents` (из variants[0].price \* 100), `default_duration_min` (variants[0].duration). Per-variant + per-staffer overrides — отдельный таск (нет в нашей схеме).

### 14.8 Customer discount — формат поля

В HAR-захватах у всех клиентов `discount: 0` (числовой ноль, не строка). Тип значения (%/cents) явно не задокументирован в API. Принимаем: **процент 0..100** (как и наша схема). Если первый юзер с реальной скидкой подключится и значение окажется в копейках — корректируем маппинг отдельным тикетом.

---

## 12. План имплементации (ссылка на TaskList)

1. Миграция `20260519000001_booksy_full_sync.sql` (§6)
2. `cron_run_booksy_syncs` tier-aware (§2)
3. Edge function `booksy-proxy`: разбить `syncBooksyData` на `syncCatalog` / `syncClients` / `syncVisits`, добавить anti-overwrite через `external_snapshot` (§4), применить флаги конфига (§5), добавить фильтр Recepcja/Admin (§13)
4. Бэкфилл: одноразовый sync-tick после деплоя — переотметить уже импортированных не-мастеров (§13.3)
5. UI: модалка с двумя вопросами после `login` (§5)
6. UI: поле `discount_percent` в `ClientFormModal`, auto-apply в `VisitForm`/`QuickEntryModal` (§8)
7. Master invite flow (§7) — отдельный таск
8. Регрессионные тесты на `syncVisits` + фильтр staff (§9, §13)

Готово к реализации.
