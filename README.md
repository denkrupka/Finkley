# Finkley

Управленческий учёт для малых салонов красоты. Ниша между Excel и Booksy: владелица видит **прибыль**, а не запись клиентов.

> «Booksy показывает твоих клиентов. Мы показываем твою прибыль.»

## Стадия

MVP. Один разработчик через Claude Code. Старт: май 2026.

## Стек

- **Frontend:** Vite + React 18 + TypeScript + Tailwind 3.4 + shadcn/ui (SPA)
- **Хостинг фронта:** GitHub Pages (через GitHub Actions)
- **Лендинг:** Astro в подпапке репо (на стадии 1 task TASK-17)
- **Бэкенд:** Supabase (Postgres + Auth + Storage + Edge Functions), регион **Frankfurt**
- **CI/CD:** GitHub Actions
- **Платежи:** Stripe + Stripe Tax
- **Email:** Postmark
- **Аналитика:** Goatcounter (free) → Plausible
- **Ошибки:** Sentry (free tier)
- **AI/OCR:** Claude Haiku 4.5 (primary), Groq Llama Vision (fallback)

**Что НЕ используем:** Vercel, Next.js, VPS, Docker. Только GitHub + Supabase.

## Быстрый старт

### День 0 (без Claude Code)

```bash
# 1. Создай GitHub репо (приватный) и распакуй этот пакет в корень
git init && git add . && git commit -m "chore: initial documentation and skeleton"
git remote add origin git@github.com:<user>/finkley.git
git push -u origin main

# 2. Установи зависимости
nvm use            # Node 20 (см. .nvmrc)
npm install -g pnpm@9
pnpm install       # установит deps + Husky хуки

# 3. Скопируй env файлы
cp apps/web/.env.example apps/web/.env.local
# заполни VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (после создания Supabase проекта)

# 4. Локальный Supabase (требует Docker)
pnpm db:start              # запускает локальный Postgres + Auth
pnpm db:reset              # применит миграции + seed.sql

# 5. Регенерация TypeScript типов
pnpm gen:types:local

# 6. Запуск
pnpm dev                   # http://localhost:5173
```

### Тестовый аккаунт после `db:reset`

- Email: `test@finkley.local`
- Пароль: `testpassword123`
- Тестовый салон с 30 визитами и 15 расходами уже есть — дашборд сразу покажет цифры

### Первая сессия с Claude Code

Открой `PROMPTS_FOR_CLAUDE_CODE.md` → запусти **Промпт 1** в Claude Code.

## Документация

### Главное (читать в порядке)

1. [`CLAUDE.md`](./CLAUDE.md) — инструкции для Claude Code (Definition of Done, локальные команды, стратегия контекста)
2. [`AGENTS.md`](./AGENTS.md) — **для тебя**: как работать с Claude Code, режимы, анти-паттерны
3. [`PROMPTS_FOR_CLAUDE_CODE.md`](./PROMPTS_FOR_CLAUDE_CODE.md) — готовые стартовые промпты
4. [`docs/CLAUDE_CODE_SETUP.md`](./docs/CLAUDE_CODE_SETUP.md) — настройка MCP, branch protection, GitHub Secrets
5. [`docs/01_PRODUCT_BRIEF.md`](./docs/01_PRODUCT_BRIEF.md) — что строим и для кого
6. [`docs/02_ARCHITECTURE.md`](./docs/02_ARCHITECTURE.md) — стек, схема слоёв
7. [`docs/03_DATA_MODEL.md`](./docs/03_DATA_MODEL.md) — Postgres-схема, RLS
8. [`docs/04_BACKLOG.md`](./docs/04_BACKLOG.md) — задачи MVP с AC
9. [`docs/05_UX_FLOWS.md`](./docs/05_UX_FLOWS.md) — флоу основных экранов
10. [`docs/06_SECURITY_PRIVACY.md`](./docs/06_SECURITY_PRIVACY.md) — GDPR, шифрование
11. [`docs/07_I18N.md`](./docs/07_I18N.md) — i18n структура
12. [`docs/08_DEPLOYMENT.md`](./docs/08_DEPLOYMENT.md) — CI/CD, секреты, rollback
13. [`docs/09_INTEGRATIONS.md`](./docs/09_INTEGRATIONS.md) — Stripe/Postmark/Booksy/wFirma/Telegram
14. [`docs/10_LAUNCH_CHECKLIST.md`](./docs/10_LAUNCH_CHECKLIST.md) — чек-лист до запуска

### Справочники

- [`docs/COMPONENTS.md`](./docs/COMPONENTS.md) — каталог UI-компонентов
- [`docs/TESTING.md`](./docs/TESTING.md) — стратегия тестов
- [`docs/runbook.md`](./docs/runbook.md) — что делать когда сломалось

### Готовые файлы

- **Скелет проекта:** `apps/web/` — Vite + React + TS + Tailwind + shadcn (готов к старту)
- **8 SQL-миграций:** `supabase/migrations/` — схема БД для стадии 1
- **Seed данные:** `supabase/seed.sql` — тестовый салон с данными
- **Edge functions config:** `supabase/config.toml`
- **CI/CD:** `.github/workflows/` — ci, deploy-web, deploy-supabase
- **Permissions для Claude Code:** `.claude/settings.json`
- **Pre-commit/pre-push:** `.husky/`
- **Email шаблоны:** `docs/email-templates/` — 5 HTML для Postmark
- **Юр документы:** `docs/legal/` — Privacy Policy и Terms templates RU
- **Скрипты:** `scripts/generate-encryption-key.sh`

### ADR

В [`decisions/`](./decisions/) — почему выбрали Vite, не Next.js; Pragmatic Privacy не E2EE; и т.д.

## Структура репо

```
finkley/
├── apps/
│   ├── web/                    # Vite + React SPA (готовый скелет)
│   │   ├── src/                # компоненты, hooks, lib, i18n
│   │   ├── tests/              # unit + e2e
│   │   ├── public/             # CNAME, 404.html (SPA fallback)
│   │   └── package.json
│   └── landing/                # Astro (создаётся в TASK-17)
├── supabase/
│   ├── migrations/             # 8 SQL миграций (готовы)
│   ├── functions/              # Edge functions (создаются по задачам)
│   ├── seed.sql                # тестовые данные
│   └── config.toml
├── .claude/
│   └── settings.json           # permissions для Claude Code
├── .github/
│   ├── workflows/              # CI + Deploy
│   └── PULL_REQUEST_TEMPLATE.md
├── .husky/                     # pre-commit + pre-push
├── scripts/                    # утилиты
├── docs/                       # документация
└── decisions/                  # ADR
```

## Локальные команды

```bash
pnpm dev               # Vite dev server
pnpm build             # production build
pnpm typecheck         # TypeScript проверка
pnpm lint              # ESLint
pnpm test              # Vitest (unit)
pnpm test:e2e          # Playwright (E2E)
pnpm format            # Prettier (write)
pnpm format:check      # Prettier (check)

pnpm db:start          # локальный Supabase
pnpm db:reset          # сбросить + применить миграции + seed
pnpm db:push           # применить миграции на linked (staging/prod)
pnpm db:diff           # diff между schema и миграциями
pnpm gen:types         # регенерация TS типов из БД
pnpm gen:types:local   # то же из локального Supabase

pnpm functions:serve   # локальный запуск edge functions
pnpm functions:deploy  # деплой edge functions (через CLI)
```

## Скоуп MVP

- **Стадия 1:** auth, multi-salon, ручной ввод визитов и расходов, дашборд, Stripe
- **Стадия 2:** клиенты, мастера+зарплата, аналитика, отчёты, экспорт
- **Стадия 3:** Booksy, OCR расходов, wFirma, CSV
- **Стадия 4:** AI-инсайты, бенчмарки, PWA
- **Стадия 5:** роли и права, мультисалон Pro, мультиязычность

Детали — в `docs/04_BACKLOG.md`.

## Лицензия

Proprietary. См. [`LICENSE`](./LICENSE).
