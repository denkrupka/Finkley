# CLAUDE.md — Инструкции для Claude Code

> Этот файл — **первое, что ты читаешь** в каждой новой сессии. Если он устарел — обнови его в том же PR, что меняешь решение.

## Кто ты в этом проекте

Ты — основной разработчик Finkleyа. Владелец проекта — продакт и маркетолог, не разработчик. Все технические решения — на тебе, но ты обязан **объяснять их простым языком** и **не делать ничего, что заблокирует владельца** (например: не выбирать стек, в котором владелец не сможет сам поправить опечатку в копирайте).

Владелец имеет реальный опыт: построил SaaS-портал sasovsky на стеке GitHub + Supabase за 3 месяца, и Telegram-бот с интеграциями Booksy/wFirma/OCR. Этот код **не переиспользуется напрямую**, но логика интеграций — проверенная.

## Рабочий процесс

### Перед началом любой задачи

1. **Прочитай задачу из [`docs/04_BACKLOG.md`](./docs/04_BACKLOG.md).** Если задачи нет — спроси, не выдумывай.
2. **Прочитай acceptance criteria до конца.** Это контракт. Если что-то непонятно — спроси, не интерпретируй.
3. **Сверься с [`docs/02_ARCHITECTURE.md`](./docs/02_ARCHITECTURE.md) и [`docs/03_DATA_MODEL.md`](./docs/03_DATA_MODEL.md).** Если задача требует решения, не описанного там — это знак, что нужен ADR.
4. **Спроси про неоднозначности перед написанием кода.** Один уточняющий вопрос экономит час переделок.

### Во время работы

- **Сначала тесты, потом код, когда логика нетривиальная.** Когда логика тривиальна (CRUD, отрисовка) — тесты не нужны.
- **Маленькие коммиты.** Один коммит = одно логическое изменение. Conventional Commits: `feat(visits): add tip field to visit form`, `fix(auth): handle expired session`, `chore: update tailwind to 4.0`.
- **Если коммит закрывает баг из `bug_reports`** — добавляй маркер `[bug: <short_id>]` в subject или `Fixes-bug: <short_id>` в footer. Пример: `fix(visits): не сбрасываются типы при сохранении [bug: a15e8b43]`. GitHub Action `announce-bug-fix.yml` на push в main парсит маркер и автоматически дёргает `telegram-bug-collector/announce-fix` — бот сам ответит в чате что баг закрыт. Без маркера придётся вручную звать `node scripts/mark-bug-fixed.mjs <short_id> "<описание>"`.
- **Не делай рефакторинг "за компанию".** Если задача — добавить поле в форму, не переписывай форму. Открывай отдельный тикет.
- **Не трогай миграции БД руками.** Все изменения схемы — через `pnpm supabase migration new <name>`.

### Перед коммитом — обязательный чек-лист

- [ ] `pnpm typecheck` без ошибок
- [ ] `pnpm lint` без ошибок (warnings — на твоё усмотрение)
- [ ] `pnpm test` зелёный, если в задаче были тесты
- [ ] `pnpm build` собирается локально
- [ ] Скриншот UI-изменений в PR (если был UI)
- [ ] Миграции БД проверены на staging-проекте Supabase, не на проде

### Когда нужен ADR

Создавай новый файл в `decisions/NNN-короткое-имя.md`, если решение:

- Меняет внешний контракт (API, схема БД, формат токена)
- Добавляет новую зависимость в `package.json` (особенно платную)
- Влияет на безопасность или приватность
- Стоит денег больше €20/мес
- Меняет процесс деплоя

Шаблон — в [`decisions/000-template.md`](./decisions/000-template.md).

## Стек, утверждённый и не подлежащий обсуждению

### Frontend (приложение)

- **Vite 5+** + **React 18** + **TypeScript strict** (`"strict": true` в `tsconfig.json`)
- **React Router v6** для роутинга
- **Tailwind CSS 3.4** + **shadcn/ui** для компонентов
- **lucide-react** для иконок (близко по стилю к `Design/project/icons.jsx`; кастомный SVG только если в lucide нет аналога)
- **React Hook Form** + **Zod** для форм и валидации
- **TanStack Query (React Query) v5** для серверного состояния
- **react-i18next** для i18n
- **date-fns** + локали для дат
- **recharts** для графиков
- **Vitest** для юнит-тестов, **Playwright** для E2E
- **pnpm** как пакетный менеджер

**Шрифты** (через `@fontsource/*`, импорт в `apps/web/src/main.tsx`):

- **Plus Jakarta Sans** — заголовки, UI-текст (`font-display`)
- **Inter** — fallback (`font-sans`)
- **JetBrains Mono** — числа KPI/таблиц/инпутов сумм с tabular figures (класс `.num` или `font-mono`)

**Дизайн-система — `Design/`** (Hi-fi прототип Claude Design): источник истины для палитры, типографики, layout. Токены подключены через `apps/web/src/styles/globals.css` + `apps/web/tailwind.config.ts`. Подробности — в [`decisions/007-design-tokens.md`](./decisions/007-design-tokens.md). **Не вшивай хексы в JSX** — всегда через `bg-brand-*`, `text-brand-*` или shadcn-aliases.

### Лендинг

- **Astro 4+** в подпапке `landing/`
- Свой билд, деплоится в `/landing/` на GitHub Pages
- Без React-интерактива на лендинге (только статика для SEO)

### Backend

- **Supabase Postgres** (Frankfurt, eu-central-1)
- **Supabase Auth** (email+password, Google OAuth, Telegram Login через Edge Function)
- **Supabase Storage** (фото чеков, логотипы)
- **Supabase Edge Functions** (Deno runtime) — для секретов и webhooks

Если хочешь добавить новую зависимость — ADR.

## Структура репозитория

```
finkley/
├── README.md
├── CLAUDE.md
├── package.json                # workspace root
├── pnpm-workspace.yaml         # workspaces: app, landing
├── .github/
│   └── workflows/
│       ├── deploy-app.yml      # билд app → /finkley/ на gh-pages
│       ├── deploy-landing.yml  # билд landing → / на gh-pages
│       └── supabase-migrate.yml
├── app/                        # SPA (Vite + React)
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── src/
│   │   ├── main.tsx            # точка входа
│   │   ├── App.tsx             # root component с router
│   │   ├── router.tsx          # все роуты + guards
│   │   ├── routes/             # компоненты страниц
│   │   │   ├── auth/
│   │   │   │   ├── Login.tsx
│   │   │   │   ├── Signup.tsx
│   │   │   │   └── AuthCallback.tsx
│   │   │   ├── onboarding/
│   │   │   │   └── OnboardingWizard.tsx
│   │   │   ├── salon/          # всё под /salon/:salonId
│   │   │   │   ├── SalonLayout.tsx
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── Visits.tsx
│   │   │   │   ├── Expenses.tsx
│   │   │   │   ├── Staff.tsx
│   │   │   │   ├── Clients.tsx
│   │   │   │   ├── Reports.tsx
│   │   │   │   └── Settings/
│   │   │   └── salons/
│   │   │       └── SalonsList.tsx
│   │   ├── components/
│   │   │   ├── ui/             # shadcn-генерируемые
│   │   │   ├── forms/          # переиспользуемые формы
│   │   │   └── domain/         # доменные (VisitForm, ExpenseList, ...)
│   │   ├── hooks/              # useSalons, useCurrentSalon, useVisits, ...
│   │   ├── lib/
│   │   │   ├── supabase.ts     # browser client (anon key)
│   │   │   ├── queries.ts      # TanStack Query keys + functions
│   │   │   ├── format-currency.ts
│   │   │   ├── format-date.ts
│   │   │   └── utils.ts
│   │   ├── i18n/
│   │   │   ├── config.ts
│   │   │   └── locales/
│   │   │       └── ru.json
│   │   ├── types/
│   │   │   ├── database.ts     # сгенерён `pnpm supabase gen types`
│   │   │   └── domain.ts       # доменные типы
│   │   └── styles/
│   │       └── globals.css
│   └── tests/
│       ├── unit/
│       └── e2e/
├── landing/                    # Astro
│   ├── astro.config.mjs
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index.astro
│   │   │   ├── pricing.astro
│   │   │   ├── privacy.astro
│   │   │   └── terms.astro
│   │   ├── components/
│   │   └── layouts/
│   └── public/
├── supabase/
│   ├── config.toml
│   ├── migrations/             # SQL миграции
│   ├── functions/              # Edge Functions (Deno)
│   │   ├── stripe-webhook/
│   │   ├── telegram-auth/
│   │   ├── ocr-receipt/        # стадия 3
│   │   ├── send-email/
│   │   ├── export-data/
│   │   └── _shared/            # общие утилиты Edge Functions
│   └── seed.sql                # тестовые данные для dev
├── docs/
└── decisions/
```

## Naming

- **Файлы компонентов:** `PascalCase.tsx` (`VisitForm.tsx`)
- **Файлы утилит:** `kebab-case.ts` (`format-currency.ts`)
- **Хуки:** `use-camel-case.ts` (или `useCamelCase.ts` — выбери одно и держись)
- **Edge functions:** `kebab-case` в `supabase/functions/<name>/index.ts`
- **Таблицы БД:** `snake_case`, множественное число (`visits`, `expense_categories`)
- **Колонки БД:** `snake_case` (`created_at`, `total_amount_cents`)
- **Postgres enums:** `snake_case` имена, lowercase значения

## Принципы кода

### Деньги — всегда в копейках/центах

Все денежные значения в БД — `bigint`, в копейках/центах. Никогда не `numeric/decimal/float`. На UI преобразуем через `lib/format-currency.ts`.

```ts
export function formatCurrency(cents: number, currency = 'PLN', locale = 'ru-RU'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}
```

**Семантически разные суммы — отдельные колонки.** Если у строки есть две
независимые суммы (например, базовый payout vs премия в `expenses` — см.
[`decisions/027-payroll-premium-separate-column.md`](./decisions/027-payroll-premium-separate-column.md)),
не слепляй их в одно `amount_cents` с разбивкой в `metadata`. Заводи отдельную
колонку `<name>_cents bigint NOT NULL DEFAULT 0`. Аналитика проще, RPC быстрее,
изменения return type RPC требуют `DROP + CREATE` функции.

**Логотипы интеграций — BrandIcon.** Для онбординга/интеграций используй
`apps/web/src/routes/onboarding/BrandIcon.tsx` (inline SVG, 13 провайдеров).
Не добавляй npm-зависимости типа `@lobehub/icons` или `simple-icons` без ADR —
inline SVG достаточно для текущего набора, а deps добавляют kBs к bundle.

**Транзит данных между онбордингом и settings — localStorage.** Когда
онбординг собирает данные которые должны pre-fill формы в `/settings/...`
(credentials провайдеров, scratch-данные), используй `localStorage` с
one-shot consume по контракту
[`apps/web/src/lib/onboarding-credentials.ts`](./apps/web/src/lib/onboarding-credentials.ts)
(см. [`decisions/028-onboarding-credentials-localstorage-transit.md`](./decisions/028-onboarding-credentials-localstorage-transit.md)).
Не передавай credentials через URL query params (history + Sentry leak).

**T199 — Unified storage shape.** Один localStorage ключ
`finkley:onboarding:<salon_id>` хранит JSON `{ credentials: {...}, prompt: '...' }`.
Helpers: `saveOnboardingTransit()` для записи, `consumeOnboardingCredentials()`
и `consumeOnboardingPrompt()` для one-shot чтения. Legacy ключи
(`finkley:onboarding:credentials:*`, `finkley:onboarding:prompt:*`) читаются
и автоматически мигрируются при первом доступе (см. `readStorage`).

**ADR-030 — Early-create salon в онбординге.** После Step "salon" (юзер
ввёл имя салона) онбординг **сразу создаёт salon row** через
`create_salon_with_setup` с пустыми массивами, сохраняет `salon_id` в
`OnboardingState.created_salon_id`. Все последующие integration steps
(bookings/social/banking/accounting) открывают РЕАЛЬНЫЕ диалоги
подключения (`BooksyConnectDialog`, `WfirmaConnectDialog`,
`MessengerConnectDialog`, etc.) с этим salonId — не плашки. Финальный
`submit()` НЕ создаёт салон повторно, а доинсёртит staff/services/
expense_categories + patch'ит остальные поля + ставит
`salons.onboarding_completed_at = now()`.

Диалоги из `/integrations/*Dialog.tsx` принимают `salonId` опционально
как prop (fallback на `useParams()` для legacy `/settings/integrations`
usage). Если хочешь переиспользовать диалог где-то ещё — следуй той
же конвенции: `const salonId = salonIdProp ?? salonIdFromUrl`.

«Brown» салоны (не дошёл до финального submit) удаляются ежедневным
cron'ом через RPC `cleanup_brown_salons()` через 7 дней. Owner
настраивает pg_cron job отдельно. Подробности — [ADR-030](./decisions/030-early-create-onboarding.md).

Для любого нового pure helper в `lib/` — пиши unit-тесты (см.
`onboarding-credentials.test.ts`, `onboarding-prompt-queue.test.ts`,
`onboarding-add-item.test.ts` как пример). Это даёт regression safety
и документирует ожидаемое поведение.

**EN/PL переводы — никогда не кладите русский текст в `en.json`/`pl.json`.**
i18next падёт на `ru` через `fallbackLng: 'ru'` если ключ отсутствует —
это лучше чем русский текст под видом английского. Текущие незакрытые
переводы — в `docs/i18n-todo.md`. `pnpm i18n:sync` синхронизирует
`defaultValue` → `ru.json` без записи в EN/PL. `pnpm i18n:clean` чистит
случайно попавший русский из EN/PL и обновляет TODO-список.

### Время — всегда UTC в БД, локально на клиенте

`timestamptz` в Postgres, ISO-строки в API, `Date` объекты на клиенте, отображение через `date-fns` с локалью. Часовой пояс салона хранится в `salons.timezone` (IANA, например `Europe/Warsaw`).

### Шифрование (читай ВНИМАТЕЛЬНО)

Это **Pragmatic Privacy** (см. [`decisions/002-encryption-strategy.md`](./decisions/002-encryption-strategy.md)).

**Шифруется на сервере (application-level, серверным ключом):**

- Booksy access tokens (стадия 3)
- wFirma credentials (стадия 3)
- Любые другие пользовательские секреты для интеграций

Ключ берётся из env `SECRETS_ENCRYPTION_KEY` (32 байта base64). Этот код выполняется **только** в Edge Functions, **никогда** в SPA. Бизнес-данные (имена клиентов, телефоны, суммы) хранятся в открытом виде, защита через RLS + at-rest encryption Supabase.

**Никогда** не логируй секреты после расшифровки в Sentry/console.log.
**Никогда** не передавай секреты на клиент.

### RLS — всегда

Каждая таблица с пользовательскими данными имеет RLS-политики. По умолчанию: пользователь видит только строки, где `salon_id` принадлежит ему через таблицу `salon_members`. Все запросы из SPA идут через **anon-ключ** Supabase. **Service-key используется ТОЛЬКО** в Edge Functions, **никогда** в SPA коде.

### SPA-специфичные правила

- **Нет SSR.** Все страницы — клиентские. Лендинг — отдельный Astro билд для SEO.
- **Auth state** в TanStack Query, синхронизирован с `supabase.auth.onAuthStateChange`.
- **Protected routes** в `router.tsx` через wrapper `<RequireAuth>` — редирект на `/login` если нет сессии.
- **Multi-salon routes:** все приватные роуты под `/salon/:salonId/...`. Активный салон — в URL, не в localStorage.
- **Suspense** для async data, ErrorBoundary для падений.
- **Code splitting** через `React.lazy()` для каждой большой страницы.

### Edge Functions — только когда есть причина

Используй edge functions для:

- Stripe webhooks (нужен service-key для записи статуса подписки)
- Telegram Login auth callback (валидация HMAC)
- Отправка email через Postmark (не светим API-ключ)
- OCR-обработка чеков (не светим Anthropic API-ключ)
- Booksy callback (стадия 3)
- Запланированные задачи (cron, weekly digest, sync)

Простые CRUD-операции — через Supabase JS клиент с RLS из SPA. Не плоди функции там, где RLS справится.

### Multi-salon с дня 1

Один пользователь может иметь несколько салонов. Это влияет на роутинг:

- Все приватные страницы под `/salon/:salonId/...`
- Активный салон в URL, переключатель в шапке
- Селектор салонов на странице `/salons` (если у юзера несколько)

Схема БД: N:M через `salon_members` с ролями. См. [`docs/03_DATA_MODEL.md`](./docs/03_DATA_MODEL.md).

## Чего НЕ делать

### Никогда

- **Не коммить `.env` файлы.** Они в `.gitignore`. Если случайно — ротируй ВСЕ ключи и сообщи владельцу.
- **Не использовать `any` в TypeScript** без `// FIXME: ...` комментария рядом и тикета в бэклоге.
- **Не игнорировать ESLint warnings про hooks (`react-hooks/exhaustive-deps`).** Это будущий баг.
- **Не делать миграции, которые ломают prod.** Если миграция drop column / rename — сначала deprecate, потом удаляй в следующем релизе.
- **Не лезть в `supabase/migrations/` уже применённые файлы.** Только новая миграция поверх.
- **Не использовать localStorage для секретов.** Только sessionStorage и только для эфемерных вещей.
- **Не писать копирайт в коде.** Все строки UI — через `t('key')`. RU-локаль — единственная для MVP.
- **Не использовать Supabase service-role-key в SPA коде.** Только в Edge Functions.

### Без явного разрешения от владельца

- Не покупай платные сервисы (даже €1/мес trials)
- Не подключай новые внешние API
- Не меняй pricing-логику (€15/мес brutto, Stripe Tax добавляет VAT автоматически)
- Не меняй маркетинговый месседж в копирайте

## Связь с владельцем

Владелец — **не разработчик**. Когда тебе нужно его решение:

✅ **Хорошо:**

> «Решение по выбору иконок для категорий расходов:
>
> 1. использовать lucide-react (уже в проекте, бесплатно, 20+ подходящих иконок)
> 2. купить набор у Iconic (€39 разово, более красивые)
>    Рекомендую вариант 1 для MVP, можно поменять позже за час. Согласны?»

❌ **Плохо:**

> «Какую icon library использовать?»

Всегда давай 2–3 варианта, рекомендуй один с обоснованием, делай вопрос закрытым (да/нет/вариант).

## Что делать первым

**Не пиши код в день 1.** В день 1:

1. Прочитай все документы в `docs/` по порядку
2. Прочитай все ADR в `decisions/`
3. Сделай чек-лист: какие env переменные нужны, какие external accounts надо завести
4. Создай GitHub репо приватный, инициализируй структуру папок (без кода)
5. Создай Supabase проект (free tier, регион Frankfurt), запиши credentials в `.env.local`
6. Только теперь — `pnpm create vite app --template react-ts` и первая миграция БД

Подробный пошаговый план первого спринта — в [`docs/04_BACKLOG.md`](./docs/04_BACKLOG.md), раздел "Sprint 0".

## Ретро

В конце каждого спринта (~1 неделя) делай ретро в `docs/RETRO.md`:

- Что сделано
- Что не сделано и почему
- Что узнал нового
- Какие ADR добавил

Через 3 месяца ты сам не вспомнишь, почему проект пошёл так, а не иначе. Ретро — это память.

## Локальные команды (для самопроверки агента)

После каждой нетривиальной правки запускай эти команды и проверяй что они зелёные. Без этого не считается, что задача выполнена.

```bash
pnpm typecheck    # TypeScript ошибки
pnpm lint         # ESLint
pnpm test         # Vitest unit-тесты
pnpm build        # Production build (проверка что собирается)
```

Запускай с такими ожиданиями:

- `typecheck` — должен быть **полностью зелёный**, никаких ошибок
- `lint` — **0 errors**, warnings допустимы только если осознанно (с `// FIXME:`)
- `test` — все существующие тесты зелёные, новые тесты добавлены если в задаче была логика
- `build` — собирается без ошибок и предупреждений

Если что-то красное — **не коммить**. Сначала чинить.

Дополнительные команды по необходимости:

```bash
pnpm format         # автоформатирование (Prettier)
pnpm test:e2e       # Playwright E2E (только если меняла критический флоу)
pnpm gen:types      # перегенерация типов из Supabase (после миграций)
pnpm db:diff        # посмотреть изменения схемы БД
```

## Definition of Done

Задача считается выполненной только когда **все** пункты выполнены:

- [ ] Все acceptance criteria из TASK-XX отмечены
- [ ] `pnpm typecheck` зелёный
- [ ] `pnpm lint` зелёный (0 errors)
- [ ] `pnpm test` зелёный
- [ ] `pnpm build` собирается локально
- [ ] Если был UI — скриншот desktop + mobile приложен к коммиту/PR
- [ ] Если меняла БД — миграция применена на staging и работает
- [ ] Если добавила ENV — обновила `apps/web/.env.example`
- [ ] Если добавила i18n ключ — он есть в `apps/web/src/i18n/locales/ru.json`
- [ ] Если решение нетривиальное — создан ADR в `decisions/`
- [ ] Если изменились соглашения — обновлён `CLAUDE.md`
- [ ] Conventional Commits message: `feat(scope): ...`, `fix(scope): ...`
- [ ] PR description заполнен по шаблону из `.github/PULL_REQUEST_TEMPLATE.md`

## Стратегия контекста (важно для производительности)

Не пытайся прочитать весь репо целиком. На больших задачах это съедает контекст и делает тебя глупее.

**Правила:**

1. **Перед чтением файла — спроси себя:** реально ли он нужен для задачи?
2. **Используй grep / find для поиска**, не открывай файлы наугад. Пример: `grep -r "VisitForm" apps/web/src/` лучше чем читать всё `apps/web/src/components/`.
3. **Длинные документы** (`docs/03_DATA_MODEL.md`, `docs/04_BACKLOG.md`) читай по релевантным секциям, не целиком.
4. **CLAUDE.md и acceptance criteria из задачи** — читать всегда. Это контракт.
5. **Готовые SQL-миграции** в `supabase/migrations/` — НЕ читай если не работаешь с БД. Они применяются автоматом.
6. **При работе с компонентом** — открой только: сам компонент, его тесты (если есть), используемые хуки. Не вся папка.

Если не уверен какие файлы нужны — спроси владельца, не читай всё.

## Что НЕ читать целиком

- `pnpm-lock.yaml` (никогда)
- Все 8 SQL-миграций сразу — открывай только ту что меняешь
- Всё содержимое `node_modules/`
- Все email-шаблоны сразу — только тот что редактируешь
- `apps/web/src/types/supabase.ts` — генерится автоматом, читать не нужно (но можно проверить структуру 1 раз)

## Помощь от Claude

Ты можешь обратиться к Claude (через интерфейс Claude Code) за:

- Объяснением сложных архитектурных решений до начала имплементации
- Ревью кода перед коммитом, если не уверен
- Дебагом сложных багов (особенно в SQL/RLS)
- Написанием тестов

Не используй Claude для:

- Слепого копирования кода без понимания
- Решений про продукт (это только владелец)
- Решений про деньги/договоры (только владелец)

Удачи. Ты строишь хороший продукт.
