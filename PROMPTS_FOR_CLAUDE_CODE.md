# Стартовые промпты для Claude Code

> Эти промпты — для запуска первых сессий Claude Code в свежем репозитории. Скопируй промпт целиком и отправь в Claude Code.

## День 0 — подготовка (без Claude Code)

1. **Создать пустой GitHub репозиторий** (приватный) `finkley`
2. **Распаковать архив** документации в корень репо
3. **Сделать первый коммит:**
   ```bash
   git add .
   git commit -m "docs: initial documentation pack"
   git push origin main
   ```
4. **Прочитать самому** в порядке: `README.md` → `CLAUDE.md` → `docs/04_BACKLOG.md` → `docs/02_ARCHITECTURE.md`. Займёт 30–60 минут.
5. **Создать аккаунты:**
   - Supabase (https://supabase.com) — два проекта в Frankfurt: `finkley-prod` и `finkley-staging`
   - GitHub (если ещё нет)
   - Stripe (test mode на старте)
   - Postmark
   - Sentry
   - Anthropic (для будущего OCR)
6. **Установить локально:**
   - Node.js 20+
   - pnpm (`npm install -g pnpm`)
   - Supabase CLI (`brew install supabase/tap/supabase` или см. инструкцию)
   - GitHub CLI опционально (`brew install gh`)

После этого — открыть Claude Code в директории репо и запустить первый промпт.

---

## Промпт 1 — Bootstrap (Sprint 0, день 1)

```
Сессия 1: Bootstrap проекта.

Перед началом — прочитай по порядку:
1. README.md
2. CLAUDE.md (это самое важное — там стек, naming, ограничения)
3. docs/04_BACKLOG.md (секции Sprint 0 и Стадия 1)
4. docs/02_ARCHITECTURE.md
5. docs/08_DEPLOYMENT.md
6. decisions/001-vite-vs-nextjs.md
7. decisions/004-single-supabase-project.md

Стек напоминаю: Vite + React 18 + TypeScript + Tailwind + shadcn/ui, GitHub Pages, Supabase. Никакого Next.js, Vercel, VPS.

Твоя задача — выполнить Sprint 0:
- TASK-00: убедись, что прочитал документацию (этот промпт)
- TASK-01: помочь мне собрать чек-лист аккаунтов и env переменных (без записи секретов в код)
- TASK-02: инициализировать monorepo с pnpm workspaces и Vite-приложение в apps/web
- TASK-02b: настроить GitHub Actions для деплоя на GitHub Pages + 404.html SPA fallback

Перед каждым шагом — задавай вопросы, если что-то неоднозначно. Не пиши код, который не работает на GitHub Pages (никаких server actions, никакого SSR).

Начинай с чтения документации. Когда закончишь — задай вопросы или начинай TASK-02.
```

---

## Промпт 2 — Supabase schema (Sprint 0 → Стадия 1, день 2)

```
Сессия 2: Initial Supabase schema.

Прочитай:
1. docs/03_DATA_MODEL.md (целиком — это твой главный источник истины по БД)
2. docs/04_BACKLOG.md → TASK-03
3. docs/06_SECURITY_PRIVACY.md секцию "RLS — как организовано"

Задача — TASK-03:
- Создать миграции в supabase/migrations/ для всех таблиц стадии 1: profiles, salons, salon_members, services, service_categories, staff (упрощённая), expenses, expense_categories, salon_subscriptions, integration_credentials
- Включить RLS на всех таблицах
- Создать триггеры set_updated_at и handle_new_user
- Применить миграции к staging Supabase (я предоставлю credentials)
- Написать минимум 2 RLS-теста (Vitest): user A не видит salon user B; user A не может update salon user B

Все имена таблиц и колонок ровно как в docs/03_DATA_MODEL.md.

Перед началом — спроси меня credentials staging Supabase. Не коммить никаких .env.
```

---

## Промпт 3 — Auth (Стадия 1, день 3)

```
Сессия 3: Auth — email/password + Google + Telegram.

Прочитай:
1. docs/04_BACKLOG.md → TASK-04, TASK-05, TASK-06, TASK-07
2. docs/09_INTEGRATIONS.md → секцию "Telegram Login"
3. decisions/009-telegram-auth.md

Задача — выполнить TASK-04..07 в этом порядке:
- TASK-04: Supabase клиент + AuthProvider + useAuth hook
- TASK-05: страницы /signup, /login, /forgot-password, /reset-password, /auth/callback
- TASK-06: Google OAuth кнопка
- TASK-07: Telegram Login виджет + edge function telegram-auth

Используй React Hook Form + Zod для валидации. Все строки через t('key') (i18n настрой попутно — TASK-15).

После каждой подзадачи — коммитить отдельно (Conventional Commits).

E2E тест на Playwright: signup → email confirm → login → logout. Если тест не зелёный — задача не закрыта.

Если упрёшься в проблему с Supabase Auth admin API в edge function — спроси меня.
```

---

## Промпт 4 — Onboarding + Layout (Стадия 1, день 4–5)

```
Сессия 4: Онбординг визард + Layout приложения.

Прочитай:
1. docs/04_BACKLOG.md → TASK-08, TASK-09
2. docs/05_UX_FLOWS.md → Flow 1, Flow 2, и wireframes Dashboard/Visits

Задача — TASK-08 и TASK-09.

TASK-08:
- Страница /onboarding с 5-шаговым визардом
- Шаги: имя → страна → тип салона → мастера → готово
- Edge function create-salon делает всё атомарно: salon + salon_members(role='owner') + дефолтные категории на языке юзера
- После успеха — редирект на /{salonId}/dashboard

TASK-09:
- Layout под /{salonId}/* с sidebar (desktop) и bottom nav (mobile)
- SalonGuard — проверка членства
- Switcher салонов в шапке
- Drawer-sidebar на mobile

Используй shadcn defaults, не делай свой дизайн.

После каждой задачи — скриншот UI в комментарии коммита.
```

---

## Промпт 5 — Ввод визита + Дашборд (Стадия 1, день 6–8)

```
Сессия 5: Ввод визита, список визитов, расходы, дашборд.

Прочитай:
1. docs/04_BACKLOG.md → TASK-10, TASK-11, TASK-12, TASK-13, TASK-14
2. docs/05_UX_FLOWS.md → Flow 2, Flow 3
3. docs/03_DATA_MODEL.md → секция "RPC-функции" (dashboard_kpis, top_staff_by_revenue)

Задача — TASK-10 до TASK-14.

Делай в порядке. После каждой:
- Скриншот UI
- Коммит
- Краткий отчёт что сделал

Особое внимание:
- Optimistic updates через TanStack Query (TASK-10)
- Empty states по UX_FLOWS (TASK-14)
- Skeleton loading (TASK-14)
- RPC dashboard_kpis должна работать без N+1 запросов

Если RPC не возвращает данные правильно — отдельный коммит с pgtap-тестом для неё.
```

---

## Промпт 6 — Stripe + email + лендинг (Стадия 1, день 9–11)

```
Сессия 6: Stripe + Postmark + лендинг.

Прочитай:
1. docs/04_BACKLOG.md → TASK-15..19
2. docs/09_INTEGRATIONS.md → секции Stripe, Postmark
3. decisions/006-stripe-integration.md
4. decisions/008-landing-stack.md

Задача — TASK-15..19 в порядке.

TASK-16 (Stripe) — самая сложная:
- Stripe Product + Price + Tax + Customer Portal
- Edge functions create-checkout-session, stripe-webhook, create-portal-session
- Тестирование через Stripe CLI на локалке
- Особое внимание: проверка подписи webhook, идемпотентность обработки events

TASK-17 (лендинг):
- apps/landing на Astro
- Страницы: /, /pricing, /privacy, /terms
- Build merge: apps/landing/dist + apps/web/dist в один gh-pages

Когда дойдёшь до Privacy/Terms — попроси у меня шаблоны или сгенерируй базовые версии для review юристом.

После TASK-19 — это конец Стадии 1. Сделай ретро в docs/RETRO.md: что прошло хорошо, что плохо, какие ADR появились новые.
```

---

## Промпт 7 — Стадия 2 запуск (после фидбека от беты)

```
Сессия 7: Стадия 2 — старт.

Перед началом:
- Прочитай docs/RETRO.md (что узнали в стадии 1)
- Прочитай docs/04_BACKLOG.md → стадия 2
- Прочитай фидбек от бета-тестеров (я предоставлю)

Решим вместе, в каком порядке делать TASK-20..26. По умолчанию — в порядке номеров. Но если фидбек показал, что один из tasks стал критичным (например, "владелица не может найти повторяющиеся расходы и из-за этого не оплачивает") — поднимаем приоритет.

Сначала обсуди со мной приоритеты, потом делай.
```

---

## Шаблон промпта на любую новую задачу

```
Сессия N: <короткое описание>.

Прочитай:
- docs/04_BACKLOG.md → TASK-XX (и связанные)
- <другие релевантные файлы>
- <релевантные ADR>

Задача — TASK-XX. AC ровно как в backlog.

Если что-то непонятно или нужно решение — спроси перед кодом.

После выполнения — скриншот UI (если был UI), коммит по Conventional Commits, краткий отчёт.

Если упрёшься в архитектурное решение, которое нужно зафиксировать — создай ADR в decisions/.
```

---

## Что Claude Code НЕ должен делать

Это полезно повторить в каждой сессии, если поведение Claude Code дрейфует:

- ❌ Не использовать Vercel, Next.js, VPS, Docker
- ❌ Не покупать платные сервисы без явного "да" от тебя
- ❌ Не игнорировать typecheck/lint warnings
- ❌ Не коммитить .env файлы
- ❌ Не использовать `any` без `// FIXME:`
- ❌ Не лезть в применённые миграции
- ❌ Не использовать service-role-key в клиентском коде
- ❌ Не писать английские строки UI (всё через t('key'), RU-локаль)

## Если Claude Code "слетает"

Бывает, что после долгой сессии Claude Code забывает про CLAUDE.md и начинает делать чего не должен. В этом случае — короткий промпт-перезапуск:

```
Стоп. Перечитай CLAUDE.md и docs/04_BACKLOG.md.

Что ты сейчас делаешь? Какая текущая задача?

Если ты делаешь что-то не из backlog — остановись и спроси.
Если ты делаешь не по AC — переделай по AC.
```
