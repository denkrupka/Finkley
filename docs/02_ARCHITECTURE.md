# 02. Architecture

## Цели архитектуры

1. **Дешёвый старт** — всё на free tier, апгрейд по факту нагрузки
2. **Минимум сервисов** — только GitHub + Supabase, никаких VPS, Vercel, Redis, отдельных воркеров
3. **Готовность к интеграциям** — Booksy/wFirma/OCR заложены архитектурно с дня 1, даже если включаются позже
4. **Multi-tenant с дня 1** — один user → много salons
5. **GDPR-готовность** — регион EU, экспорт и удаление данных, audit log
6. **Низкая когнитивная нагрузка для соло-разработчика** — стандартный стек, нет экзотики

## Высокоуровневая схема

```
┌──────────────────────────────────────────────────────────────────┐
│                          ПОЛЬЗОВАТЕЛЬ                             │
│  Браузер (desktop / mobile) — PWA в стадии 4                     │
└──────────────┬─────────────────────────┬─────────────────────────┘
               │                         │
               │ landing.finkley.app     │ app.finkley.app
               │ (Astro static)          │ (Vite SPA)
               ▼                         ▼
        ┌────────────────────────────────────────────┐
        │           GITHUB PAGES (free)               │
        │  /landing/   /app/                          │
        │  Custom domain через CNAME + Cloudflare DNS │
        └─────────────────────────┬───────────────────┘
                                  │ HTTPS
                                  │ (REST + Realtime)
                                  ▼
        ┌────────────────────────────────────────────┐
        │       SUPABASE (Frankfurt eu-central-1)     │
        │  ┌──────────────────────────────────────┐  │
        │  │  Postgres + RLS                      │  │
        │  │  Auth (email/Google + Telegram via   │  │
        │  │        edge function)                │  │
        │  │  Storage (чеки, логотипы)            │  │
        │  │  Realtime (опционально)              │  │
        │  └──────────────────────────────────────┘  │
        │  ┌──────────────────────────────────────┐  │
        │  │  Edge Functions (Deno):              │  │
        │  │   /stripe-webhook                    │  │
        │  │   /telegram-auth                     │  │
        │  │   /send-email                        │  │
        │  │   /export-data                       │  │
        │  │   /ocr-receipt    (стадия 3)         │  │
        │  │   /booksy-sync    (стадия 3)         │  │
        │  │   /weekly-digest  (стадия 4)         │  │
        │  └──────────────────────────────────────┘  │
        └─────────────────────────┬───────────────────┘
                                  │ HTTPS, server-side
                                  ▼
        ┌────────────────────────────────────────────┐
        │              ВНЕШНИЕ СЕРВИСЫ                │
        │  Stripe (платежи + Stripe Tax)              │
        │  Postmark (транзакционный email)            │
        │  Anthropic API (Claude Haiku — OCR)         │
        │  Groq (Llama Vision — OCR fallback)         │
        │  Booksy proxy (стадия 3 — детали в 09)      │
        │  wFirma API (стадия 3, PL only)             │
        │  Sentry (ошибки)                            │
        │  Plausible (аналитика)                      │
        └─────────────────────────────────────────────┘
```

## Стек

### Frontend SPA (`app/`)

| Компонент     | Технология            | Зачем                              |
| ------------- | --------------------- | ---------------------------------- |
| Билд          | Vite 5+               | Быстро, минимум магии, отличная DX |
| Фреймворк     | React 18              | Стандарт                           |
| Язык          | TypeScript strict     | Меньше багов в рантайме            |
| Роутинг       | React Router v6       | Стандарт для SPA                   |
| Стили         | Tailwind CSS 4        | Быстрая разработка                 |
| UI-компоненты | shadcn/ui             | Бесплатно, кастомизируется         |
| Иконки        | lucide-react          | Единый стиль с shadcn              |
| Формы         | React Hook Form + Zod | Type-safe валидация                |
| Server state  | TanStack Query v5     | Кэш, optimistic updates            |
| Графики       | recharts              | Достаточно для P&L                 |
| Даты          | date-fns + локали     | Лёгкий, tree-shakeable             |
| i18n          | react-i18next         | Стандарт для React                 |
| Тесты         | Vitest + Playwright   | Стандарт                           |

### Лендинг (`landing/`)

| Компонент | Технология                        |
| --------- | --------------------------------- |
| Билд      | Astro 4+                          |
| Стили     | Tailwind CSS (общий конфиг с app) |
| Контент   | `.astro` страницы, никакого React |
| Билд      | Чистый HTML/CSS, отлично для SEO  |

**Зачем отдельный Astro билд:** GitHub Pages не делает SSR. SPA не индексируется поисковиками (robots видят пустой div). Лендинг для маркетинга должен быть SEO-friendly. Astro — это статический генератор, идеально под эту задачу.

### Backend (Supabase)

| Компонент             | Использование                                              |
| --------------------- | ---------------------------------------------------------- |
| Postgres 15           | Основная БД (Frankfurt eu-central-1)                       |
| Auth                  | Email/password, Google OAuth, Telegram через edge function |
| Storage               | Фото чеков (стадия 3), логотипы салонов                    |
| Edge Functions (Deno) | Webhooks, секретные операции, scheduled tasks              |
| Realtime              | Опционально для live-обновления дашборда                   |

### Внешние сервисы

| Сервис        | Использование                        | Тариф старт                               |
| ------------- | ------------------------------------ | ----------------------------------------- |
| GitHub        | Репо + GitHub Pages + GitHub Actions | Free                                      |
| Supabase      | БД + auth + storage + edge           | Free (500MB БД, 1GB Storage, 500k req/mo) |
| Stripe        | Платежи + Stripe Tax                 | 1.5% + €0.25 на транзакцию                |
| Postmark      | Транзакционный email                 | 100 email/мес free, $15/мес 10k           |
| Anthropic API | OCR через Claude Haiku 4.5           | Pay-as-you-go, ~$0.001/чек                |
| Groq          | OCR fallback                         | Free tier есть                            |
| Sentry        | Мониторинг ошибок                    | Developer (free, 5k events/мес)           |
| Plausible     | Веб-аналитика                        | $9/мес после free trial, или self-hosted  |
| Cloudflare    | DNS + custom domain для GitHub Pages | Free                                      |

**Совокупная стоимость инфраструктуры на старте: €0/мес** (всё на free tier до 100+ юзеров).

## Ключевые архитектурные решения

### 1. Vite SPA, не Next.js, не SSR

GitHub Pages — статический хостинг. SSR невозможен. Поэтому:

- Приложение `app/` — это **client-only SPA**. Все страницы рендерятся в браузере после загрузки.
- Лендинг `landing/` — **статически сгенерирован Astro**, для SEO.
- Нет Server Components, нет Server Actions, нет middleware.
- Вся серверная логика — в Supabase Edge Functions, доступных по REST.

ADR: [`decisions/001-vite-vs-nextjs.md`](../decisions/001-vite-vs-nextjs.md)

### 2. Один Supabase проект (на окружение)

Все таблицы в одной БД, разделение через RLS-политики и `salon_id`. Это проще для соло-разработчика, чем мульти-проектная схема.

Окружения:

- `finkley-prod` (production)
- `finkley-staging` (для PR-превью и проверки миграций)

ADR: [`decisions/004-single-supabase-project.md`](../decisions/004-single-supabase-project.md)

### 3. Booksy интеграция — отложенная архитектура

В MVP (стадия 1-2) **нет интеграции** с Booksy. На стадии 3 будет добавлена через прокси-механизм, который владелец уже использует на своём другом проекте sasovsky. Технические детали будут уточнены при подходе к задаче — главное, что прокси-логика будет жить **внутри Supabase Edge Function**, не на отдельном сервере.

ADR: [`decisions/005-booksy-integration-strategy.md`](../decisions/005-booksy-integration-strategy.md)

### 4. Multi-salon с дня 1

Схема БД: `users` ↔ `salon_members` ↔ `salons`. Все приватные роуты — под `/salon/:salonId/...`. Активный салон — в URL, не в localStorage.

ADR: будет добавлен при необходимости (решение зафиксировано здесь и в `docs/03_DATA_MODEL.md`).

### 5. Все деньги — bigint в копейках

`amount_cents BIGINT NOT NULL`. Никогда `numeric/decimal/float`. Преобразование в UI через `lib/format-currency.ts`.

### 6. Все времена — `timestamptz` в UTC

Часовой пояс салона хранится в `salons.timezone` (IANA, `Europe/Warsaw`). Конвертация на клиенте через `date-fns-tz`.

### 7. Auth через Supabase, Telegram через Edge Function

- Email/password и Google OAuth — нативные провайдеры Supabase Auth.
- Telegram Login — стандарт Telegram Login Widget. После клика юзера, виджет POST'ит данные с подписью в нашу Edge Function `/telegram-auth`. Функция валидирует HMAC-подпись через bot_token, и создаёт/находит пользователя в Supabase Auth через service-role-key.

### 8. Дизайн-система — Hi-fi прототип Claude Design + кастомные токены поверх shadcn

Источник истины — `Design/` (Hi-fi HTML/JSX-прототип от Claude Design). Палитра, типографика, радиусы и тени из `Design/project/tokens.jsx` поднимаются в `apps/web/src/styles/globals.css` (CSS-переменные HSL) и `apps/web/tailwind.config.ts` (Tailwind-классы `bg-brand-*`, `font-display`, `font-mono`, `shadow-finsm/md/lg/xl`).

shadcn-компоненты используются «как есть», но shadcn-токены (`--primary`, `--background`, `--card`, …) **смаплены** на Finkley-палитру, чтобы дефолтные кнопки/инпуты сразу читались как фирменные.

ADR: [`decisions/007-design-tokens.md`](../decisions/007-design-tokens.md)

## Слои безопасности

```
┌─────────────────────────────────────────────────────────┐
│ Слой 1: HTTPS + HSTS (GitHub Pages, Cloudflare)          │
│   Все запросы зашифрованы в транзите                     │
├─────────────────────────────────────────────────────────┤
│ Слой 2: Supabase Auth (JWT в localStorage/cookies)       │
│   Только авторизованные пользователи делают запросы      │
├─────────────────────────────────────────────────────────┤
│ Слой 3: RLS-политики Postgres                            │
│   user видит только строки своих salons                  │
├─────────────────────────────────────────────────────────┤
│ Слой 4: Application-level encryption (для секретов)      │
│   Booksy/wFirma токены — зашифрованы серверным ключом    │
│   только в Edge Functions                                │
├─────────────────────────────────────────────────────────┤
│ Слой 5: Encryption at-rest (Supabase, default)           │
│   AES-256 на уровне диска                                │
├─────────────────────────────────────────────────────────┤
│ Слой 6: Регион Frankfurt (eu-central-1)                  │
│   Данные физически в ЕС, GDPR-compliant                  │
└─────────────────────────────────────────────────────────┘
```

Подробности — в `06_SECURITY_PRIVACY.md`.

## Окружения

| Окружение    | Где живёт фронт                         | Какой Supabase               | Когда используется        |
| ------------ | --------------------------------------- | ---------------------------- | ------------------------- |
| `local`      | `pnpm dev` на localhost:5173            | локальный Supabase через CLI | Разработка                |
| `staging`    | branch `staging` → `staging.finkley.app` | `finkley-staging`            | Превью PR + тест миграций |
| `production` | branch `main` → `app.finkley.app`        | `finkley-prod`               | Прод                      |

**Переменные окружения:**

- `.env.example` (template, в репо)
- `.env.local` (gitignored)
- В GitHub Actions — через repository secrets
- В Supabase Edge Functions — через Supabase secrets (`supabase secrets set`)

## Деплой и CI/CD

### Фронт (app + landing)

```
git push origin main
   │
   ▼
GitHub Actions:
   - pnpm install
   - pnpm typecheck
   - pnpm lint
   - pnpm test
   - pnpm build (app + landing)
   - Deploy to gh-pages branch:
       /landing/ — статика Astro
       /app/     — статика Vite SPA
   │
   ▼
GitHub Pages обновляется через 30-60 секунд
   │
   ▼
Cloudflare DNS:
   landing.finkley.app → gh-pages /landing/
   app.finkley.app     → gh-pages /app/
```

### Backend (Supabase migrations + Edge Functions)

```
git push с изменениями в supabase/
   │
   ▼
GitHub Actions:
   - supabase db push (применяет миграции к staging)
   - supabase functions deploy (деплоит Edge Functions)
   │
   ▼
[Manual approval для production]
   │
   ▼
   - supabase db push --linked --project-ref <prod>
   - supabase functions deploy --project-ref <prod>
```

Подробности — в `08_DEPLOYMENT.md`.

## Что НЕ в архитектуре MVP

- **Своя реализация Stripe checkout** — используем Stripe Checkout + Stripe Customer Portal
- **Своя email-вёрстка** — используем готовые шаблоны Postmark + переменные
- **Очереди задач (Redis/BullMQ)** — Edge Functions хватает. Если упрёмся — pg-boss поверх Postgres
- **Кэширование (Redis)** — TanStack Query на клиенте + Postgres достаточно
- **CDN для пользовательских файлов** — Supabase Storage уже за CDN
- **Нативное мобильное приложение** — PWA в стадии 4
- **Отдельный API-сервер (Express, Fastify)** — Supabase + Edge Functions покрывают все нужды
- **VPS / Docker / Kubernetes** — не нужно

## Масштабирование

Этапы и что меняем:

| Юзеров       | Меняем                                                        |
| ------------ | ------------------------------------------------------------- |
| 0–100 (бета) | Free tier везде, ничего не платим                             |
| 100–500      | Supabase Pro ($25/мес), Postmark Starter ($15/мес)            |
| 500–2000     | Compute add-on Supabase, Sentry team plan                     |
| 2000–5000    | Possibly Postgres read-replica для аналитики                  |
| 5000+        | Возможно отдельный сервис для ETL → ClickHouse для бенчмарков |

Не оптимизируем заранее. Профайлим, когда тормозит.
