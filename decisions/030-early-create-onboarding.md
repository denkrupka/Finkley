# ADR-030: Early-create salon в онбординге

## Статус

`Accepted`

Дата: 2026-05-29

## Контекст

До этого решения весь онбординг собирал данные в локальном React state
(`OnboardingState`), а реальное создание салона + всех интеграций
происходило только в финальном `submit()` (Step5Done). Integration steps
(bookings/social/banking/accounting) показывали чек-боксы «хочу подключить»
и собирали credentials в `pending_credentials` — реальная авторизация
происходила после онбординга в `/settings/integrations` через prompt-queue.

Владелец предъявил жёсткий фидбек:

> ОНБОРДИНГ СДЕЛАН ЧТО БЫ СРАЗУ ВСЕ ПОДКЛЮЧИТЬ (подключить = авторизоваться
> и сразу подключить чтобы все работало, а не просто добавить дебильный
> тег «подключено»)

Кроме того, owl-фичи опирались на реальные данные:

- WOW-шаг + AI-summary должны показывать инсайты на основе реальных
  visits/staff/services (которые подтянутся из Booksy после auth).
- Мастера из Booksy «должны были подтянуться» — Step2Staff / Step3Services
  должны видеть импортированные строки.

Все эти диалоги (`BooksyConnectDialog`, `BankingSection`, `MessengerConnectDialog`,
`TelegramUserbotConnectDialog`, `WfirmaConnectDialog`, `KsefConnectDialog`)
требуют реальный `salon_id` для запросов в БД (RLS), для callback URL у
OAuth-flow (PSD2 redirect возвращается на `/banking/callback` с
`salon_id` в state), и для записи credentials в зашифрованную
`salon_integrations` таблицу.

Без реального `salon_id` они работать не могут.

## Решение

После Step **"salon"** (когда юзер ввёл имя салона ≥ 2 символа) онбординг
**атомарно создаёт салон** через существующий RPC
`create_salon_with_setup` с пустыми массивами `p_staff=[]`, `p_services=[]`,
`p_expense_categories=[]`. Возвращённый `salon_id` сохраняется в
`OnboardingState.created_salon_id`.

Все последующие integration steps (`integrations_bookings`,
`integrations_social`, `integrations_banking`, `accounting`) проверяют
`created_salon_id`:

- Если есть — рендерят `LiveIntegrationCategoryStep` (или `Step3Accounting`
  в live-режиме), который открывает РЕАЛЬНЫЕ диалоги подключения. После
  успешного OAuth/login → запись в `salon_integrations` + триггер
  фонового sync (Booksy 2-минутный cron, banking webhooks, etc.).
- Если нет (юзер пропустил salon step, или RPC упал) — fallback на
  старый `IntegrationCategoryStep` который собирает credentials в
  `pending_credentials`, применяемые в финальном `submit()`.

Финальный `submit()`:

- Если `created_salon_id` есть → НЕ создаёт салон повторно. Доинсёртит
  staff/services/expense_categories через прямые `INSERT` в таблицы
  (RPC не умеет «дополнять» существующий салон). Затем patch'ит
  оставшиеся поля (`address`, `nip`, `opening_hours`, `logo_url`,
  `financial_settings`) одним `UPDATE salons`.
- Если `created_salon_id === null` (юзер прошёл онбординг как раньше) →
  legacy путь: один `create_salon_with_setup` со всеми данными.

`StepWowAi` и `StepAiSummary` принимают `salonId` пропом и передают в
`ai-onboarding-preview` edge function. Та при наличии `salon_id`
параллельно тянет 9 метрик из БД (visits/staff/services/clients
counts + top-5 услуг/мастеров + connected integrations) и подаёт
Claude'у в prompt как `real_data` ground-truth блок. Без `salon_id` —
fallback на старый prompt только по metadata.

Все диалоги (`BooksyConnectDialog`, `WfirmaConnectDialog`,
`KsefConnectDialog`, `/integrations/ConnectIntegrationDialog`)
адаптированы принимать `salonId` опционально как prop с fallback на
`useParams()`. Это позволило переиспользовать их в онбординге без
монтирования внутри `/:salonId/...` роута.

## Последствия

### Положительные

- Юзер реально подключает интеграции в онбординге, не «галочки».
- Booksy import (мастера + услуги + клиенты + история визитов)
  начинается ДО WOW-шага. AI получает реальные данные.
- Code reuse: один комплект диалогов для онбординга и для
  `/settings/integrations`.

### Отрицательные / риски

- **«Brown» салоны.** Если юзер бросает онбординг между Step salon и
  финальным submit — в БД остаётся салон с пустыми staff/services/
  expense_categories. Это видно в `/salons` если у юзера есть другие
  салоны. Mitigation: `salons.onboarding_completed_at` (TODO в
  следующей миграции) + admin job `delete from salons where
onboarding_completed_at is null and created_at < now() - interval
'7 days'`.
- **Race condition на name change.** Если юзер на Step salon ввёл
  имя X, нажал «Далее» (создалось), вернулся назад, поменял имя на
  Y, нажал «Далее» — `ensureSalonCreated()` UPDATE'ит салон с
  новым name/country/type. Корректно, но запросов больше чем
  нужно. Mitigation: добавить equality-check в `ensureSalonCreated`.
- **Stripe Checkout window.** При `subscribe_after_submit=true`
  финальный submit редиректит в Stripe. Если юзер не оплачивает —
  салон уже существует, доступен в `/salons`. Это OK — соответствует
  ADR-006 «trial без карты».
- **Расходы на edge functions.** Каждый онбординг теперь делает
  +1 RPC call + N integrations sync. Booksy sync = +1 hCaptcha
  proof + 1 Apollo browser session. Bounded (юзер делает онбординг
  1 раз), но если массовый attack — нужен rate-limit на
  `create_salon_with_setup` (10/час per user).

## Альтернативы рассмотренные

- **OAuth-state без salon_id**: можно было передавать `pending`
  через cookie/sessionStorage и применять в `/banking/callback`
  после создания салона. Но Booksy/wFirma требуют real-time API
  call который не toleruje отложенной apply (creds expire, captcha
  нужен заново).
- **Отдельный RPC `create_salon_stub`**: создавал бы только
  `salons` + `salon_members` без RPC. Отверг — `create_salon_with_setup`
  уже принимает дефолтные `[]` для всех массивов, не нужно дублировать.
- **Локальная переменная instead of state**: `let createdSalonId =
null` в closure. Отверг — `OnboardingState` нужен для navigate
  back/forward consistency и для передачи в дочерние компоненты
  через props.

## Файлы

- `apps/web/src/routes/onboarding/OnboardingPage.tsx` — state.created_salon_id,
  `ensureSalonCreated()`, branch в submit().
- `apps/web/src/routes/onboarding/LiveIntegrationCategoryStep.tsx` — новый
  компонент, рендерит реальные диалоги если есть salonId.
- `apps/web/src/routes/onboarding/Step3Accounting.tsx` — dual-mode по salonId.
- `apps/web/src/routes/integrations/{Booksy,Wfirma,Ksef,Connect}Dialog.tsx` —
  принимают salonId опционально.
- `supabase/functions/ai-onboarding-preview/index.ts` — fetchRealData
  - grounded prompt.
