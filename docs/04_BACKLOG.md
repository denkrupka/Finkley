# 04. Backlog

> Главный рабочий документ Claude Code. Делай задачи **по порядку внутри стадии**. Между стадиями — ретро и фидбек от первых юзеров.

## Формат задачи

```
### TASK-NN: Название
**Стадия:** N · **Оценка:** S/M/L/XL · **Зависит от:** TASK-XX
**Цель:** одно предложение
**AC:**
- [ ] критерии
**Технические детали** (опционально)
**Тесты** (опционально)
```

Оценки: S=полдня, M=1–2 дня, L=3–5 дней, XL=неделя+

---

## Sprint 0 — Подготовка (без кода)

### TASK-00: Чтение всей документации

**Стадия:** 0 · **Оценка:** S
**AC:**

- [ ] Прочитан CLAUDE.md
- [ ] Прочитаны все файлы в docs/
- [ ] Прочитаны все ADR в decisions/
- [ ] Создан `docs/RETRO.md` для регулярных ретро
- [ ] Все вопросы записаны и заданы владельцу до начала кода

### TASK-01: Внешние аккаунты и секреты

**Стадия:** 0 · **Оценка:** S
**AC:**

- [ ] GitHub приватный репо `finkley` создан, monorepo с pnpm workspaces
- [ ] Supabase проект `finkley-prod` (Frankfurt, free tier)
- [ ] Supabase проект `finkley-staging` (Frankfurt, free tier)
- [ ] Stripe аккаунт активирован, тест-режим работает
- [ ] Postmark аккаунт + sender signature
- [ ] Anthropic API key (для будущего OCR)
- [ ] Sentry проект `finkley-web`
- [ ] Plausible: cloud trial или self-hosted позже
- [ ] Домен куплен (`finkley.app` или альтернатива), CNAME настроен на `username.github.io`
- [ ] `.env.example` со всеми ключами без значений
- [ ] `.env.local` с заполненными значениями (gitignored)

### TASK-02: Скелет monorepo

**Стадия:** 0 · **Оценка:** M
**AC:**

- [ ] `pnpm-workspace.yaml` с `apps/*`
- [ ] `apps/web` — `pnpm create vite . --template react-ts`
- [ ] `apps/landing` — `pnpm create astro@latest .` (минимальный template) — или skip до стадии 1.16
- [ ] Структура папок в `apps/web/src/` по CLAUDE.md
- [ ] Установлены deps в `apps/web`: tailwindcss, shadcn/ui (init), zod, react-hook-form, @hookform/resolvers, @tanstack/react-query, @supabase/supabase-js, react-router-dom, react-i18next, i18next, date-fns, recharts, lucide-react, @fontsource/inter
- [ ] Tailwind 3.4 настроен
- [ ] `tsconfig.json` strict
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm build` зелёные
- [ ] Базовый App.tsx с placeholder
- [ ] `.gitignore` корректный
- [ ] Первый коммит, push в main

### TASK-02b: GitHub Pages deploy + GitHub Actions

**Стадия:** 0 · **Оценка:** M · **Зависит от:** TASK-02
**AC:**

- [ ] `.github/workflows/deploy-web.yml`: на push в main → build → deploy в gh-pages branch
- [ ] `vite.config.ts`: `base: '/'` для кастомного домена
- [ ] `apps/web/public/CNAME` с доменом
- [ ] `apps/web/public/404.html` для SPA routing fallback (см. CLAUDE.md)
- [ ] GitHub Pages settings: source = `gh-pages` branch
- [ ] Открывается на `https://<твой-домен>/` показывает placeholder
- [ ] HTTPS активен, SSL валидный

**Технические детали:**

`.github/workflows/deploy-web.yml`:

```yaml
name: Deploy Web
on:
  push:
    branches: [main]
    paths: ['apps/web/**', '.github/workflows/deploy-web.yml']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter web build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_STRIPE_PUBLISHABLE_KEY: ${{ secrets.VITE_STRIPE_PUBLISHABLE_KEY }}
          VITE_SENTRY_DSN: ${{ secrets.VITE_SENTRY_DSN }}
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./apps/web/dist
          cname: finkley.app
```

`apps/web/public/404.html`:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <script>
      // GitHub Pages SPA fallback (rafgraph/spa-github-pages technique)
      var l = window.location
      l.replace(
        l.protocol +
          '//' +
          l.hostname +
          (l.port ? ':' + l.port : '') +
          '/?p=' +
          encodeURIComponent(l.pathname.slice(1) + l.search) +
          l.hash,
      )
    </script>
  </head>
  <body></body>
</html>
```

В `apps/web/index.html` (в `<head>` перед бандлом):

```html
<script>
  // Восстановление пути из 404.html
  ;(function () {
    var p = new URLSearchParams(window.location.search).get('p')
    if (p) {
      window.history.replaceState(null, null, '/' + p + window.location.hash)
    }
  })()
</script>
```

---

## Стадия 1 — Фундамент

**Релиз:** закрытая бета для 5–10 знакомых владелиц.
**Цель стадии:** доказать, что можно ввести данные и увидеть прибыль.

### TASK-03: Initial Supabase schema

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-01, TASK-02
**AC:**

- [ ] Миграция `init_auth_profiles.sql` применена
- [ ] Миграция `init_salons_members.sql` применена
- [ ] Миграция `init_services_staff.sql` применена (стадия 1 версия — упрощённая staff)
- [ ] Триггер `handle_new_user` создаёт profile при регистрации
- [ ] RLS-политики работают: user A не видит salon user B
- [ ] Локально через `pnpm supabase start` + `pnpm supabase db reset` всё перезапускается
- [ ] Миграции применены к staging Supabase

**Тесты:** Vitest + создание двух тестовых юзеров через Supabase Auth, проверка изоляции

### TASK-04: Supabase клиент + auth bootstrap

**Стадия:** 1 · **Оценка:** S · **Зависит от:** TASK-03
**AC:**

- [ ] `lib/supabase/client.ts` экспортирует singleton supabase клиент
- [ ] `hooks/use-auth.ts`: `useAuth()` возвращает `{user, session, loading, signIn, signUp, signOut}`
- [ ] AuthProvider в `App.tsx` оборачивает все роуты
- [ ] Сессия восстанавливается при перезагрузке страницы
- [ ] При signOut — редирект на `/login`

### TASK-05: Auth — email/password

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-04
**AC:**

- [ ] `/signup` форма (email, пароль ≥8, подтверждение)
- [ ] `/login` форма
- [ ] `/forgot-password` и `/reset-password`
- [ ] Валидация Zod
- [ ] Email confirmation через Supabase (Postmark как SMTP)
- [ ] `/auth/callback` обрабатывает email confirm
- [ ] После логина — `/onboarding` (если нет салонов) или `/{salonId}/dashboard`
- [ ] Logout кнопка в шапке
- [ ] PrivateRoute компонент: неавторизованных → `/login`

**Тесты:** Playwright: signup → confirm → login → logout

### TASK-06: Auth — Google OAuth

**Стадия:** 1 · **Оценка:** S · **Зависит от:** TASK-05
**AC:**

- [ ] Google Cloud Console: OAuth client ID, redirect URI на supabase.co + кастомный домен
- [ ] Supabase Auth: Google provider включён
- [ ] Кнопка "Войти через Google" на `/login` и `/signup`

### TASK-07: Auth — Telegram Login

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-05
**AC:**

- [ ] Telegram Bot создан через @BotFather для login widget
- [ ] Виджет интегрирован в `/login`
- [ ] Edge function `telegram-auth` валидирует подпись Telegram (HMAC-SHA256)
- [ ] При успешной подписи — выпускает Supabase JWT
- [ ] При первом логине — создаётся profile с `telegram_id`

**Технические детали:** Supabase Auth не поддерживает Telegram нативно. Делаем через "custom token signing":

1. Telegram widget возвращает данные пользователя на наш URL
2. Edge function валидирует подпись по `bot_token`
3. Edge function создаёт/находит юзера через `auth.admin.createUser()`
4. Возвращает access/refresh tokens
5. Клиент устанавливает их в supabase клиент через `supabase.auth.setSession()`

ADR `decisions/009-telegram-auth.md`

### TASK-08: Онбординг визард

**Стадия:** 1 · **Оценка:** L · **Зависит от:** TASK-05
**Визуал:** `Design/project/screens-4-5-mobile.jsx` → `OnboardingScreen` (виден шаг 2 «Мастера»)
**AC:**

- [ ] `/onboarding` мастер из 5 шагов (RHF + Zod), степпер сверху, ETA «≈ 2 минуты»
- [ ] **Шаг 1 «Салон»**: имя, страна (autoset валюты/timezone из country_code), тип салона (`hair`/`nails`/`spa`/`barber`/`cosmetology`/`mixed`)
- [ ] **Шаг 2 «Мастера»**: карточки мастеров в grid 3-колонки. На каждой: имя, специализации (multi-select pills), схема оплаты (pills `% от выручки` / `Фикс. ставка` / `Почасовая` — стадия 1 поддерживает только `% от выручки`, остальные показываем «появится в стадии 2»), значение % в жёлтом инпуте. Можно пропустить.
- [ ] **Шаг 3 «Услуги»**: добавить стартовые услуги (или принять seed-набор по `salon_type`). Если пропущено — пустой каталог
- [ ] **Шаг 4 «Расходы»**: подтвердить дефолтные категории (Аренда / Зарплата / Материалы / Реклама / Коммунальные / Обучение / Прочее — 7 шт. из `docs/03_DATA_MODEL.md`), можно убрать ненужные
- [ ] **Шаг 5 «Готово»**: финальный экран с кнопкой «Открыть дашборд»
- [ ] При финале: edge function `create-salon` создаёт **атомарно** в одной транзакции: `salons` + `salon_members(role='owner')` + `staff` + `services` + `service_categories` (seed по типу) + `expense_categories`
- [ ] Прогресс-бар сверху, кнопка «← Назад» между шагами, ссылка «Пропустить — добавлю потом» для шагов 2–4
- [ ] Mobile-адаптация: все шаги вертикально, grid карточек становится 1-колоночным
- [ ] Редирект на `/{salonId}/dashboard` после финиша

**Технические детали:** `create-salon` edge function (а не RPC), потому что нужно создать сразу несколько таблиц с разными RLS-контекстами. Использует service-role-key, валидирует что юзер залогинен через `auth.getUser()`. В стадии 1 у `staff.payout_scheme` всегда значение `percent_revenue`; полный enum используется с TASK-21.

### TASK-08b: Заглушки «Скоро» для будущих секций

**Стадия:** 1 · **Оценка:** S · **Зависит от:** TASK-09
**AC:**

- [ ] Страницы `/{salonId}/clients`, `/{salonId}/reports`, `/{salonId}/ai` показывают одинаковый компонент `<ComingSoon stage={N} />` с центрированным заголовком, иконкой из соответствующей секции и текстом «Эта секция доступна в стадии N. [Что нового →](changelog)»
- [ ] Sidebar показывает все 8 пунктов всегда (см. TASK-09); пункт активен и кликабелен, переход открывает заглушку
- [ ] У стадии 1 пункта (Главная, Визиты, Расходы, Мастера, Настройки) заглушки нет — там реальные страницы

**Зачем:** прототип `Design/` показывает все 8 пунктов sidebar. Пользователь видит «куда идёт продукт», а не «полупустое приложение». Реализация Клиентов/Отчётов/AI — TASK-20/23/33 в своих стадиях.

### TASK-09: Layout приложения и переключатель салонов

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-08
**Визуал:** `Design/project/chrome.jsx` (Sidebar + TopBar + FAB), `screens-4-5-mobile.jsx` → `MobileDashboard` (mobile bottom nav)
**AC:**

- [ ] Layout `/{salonId}/*`: sidebar (desktop) + main, шапка-`TopBar` с салоном/датой/period-toggle/bell/avatar
- [ ] **Sidebar** (8 пунктов в порядке прототипа): Главная (`home`) / Визиты (`calendar`) / Клиенты (`users`, **заглушка** TASK-08b) / Расходы (`expense`) / Мастера (`master`) / Отчёты (`report`, заглушка) / AI-помощник (`robot`, заглушка) / Настройки (`settings`)
- [ ] Внизу sidebar: карточка тарифа (gold-градиент, «Pro план — до DD MMM») + блок аватар/имя салона/город. **«Pro» — единственный тариф** в стадии 1, см. ADR-006; имя «Pro» — только маркетинг.
- [ ] TopBar: имя салона (`brand-navy`, bold) + дата сегодняшняя над period-toggle, в центре `PeriodToggle` (День/Неделя/Месяц/Период), справа bell с red-dot и avatar 38×38
- [ ] Period state хранится в URL search-param (`?period=month`), а не localStorage — чтобы шарить ссылки
- [ ] Salon-switcher — в TopBar `dropdown` по клику на имя салона. Переключение → URL меняется на `/{newSalonId}/dashboard`
- [ ] `<RequireSalonMembership>` guard: если `:salonId` не принадлежит юзеру (нет строки в `salon_members`) → 404 страница (не редирект — иначе race с авторизацией)
- [ ] **Mobile**: sidebar становится drawer (открывается по бургер-иконке в TopBar). Bottom nav 5 пунктов: Главная / Визиты / Расходы / AI / Ещё. **Кнопка `+` НЕ в bottom-nav** — отдельный круглый FAB над bottom-nav, snap к правому краю с 20px отступом (см. `MobileDashboard`)
- [ ] FAB-вариант для desktop: pill-кнопка «+ Визит» снизу-справа (см. `chrome.jsx` → `FAB`)

### TASK-10: Ввод визита (быстрая форма)

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-09
**Визуал:** `Design/project/screens-2-3.jsx` → `QuickEntryModal`
**AC:**

- [ ] FAB «+ Визит» в `chrome.jsx` запускает форму. На desktop — Dialog (Radix `Dialog`), на mobile — Drawer/Sheet (bottom sheet)
- [ ] Заголовок: «Новый визит» + подзаголовок «Запишется в книгу за пару секунд»
- [ ] **Дата** — по умолчанию сегодня, read-only display «6 мая 2026, понедельник» с pill «сегодня» справа (sage). Клик открывает date-picker для смены
- [ ] **Мастер** — Select (Radix `Select`) с цветным аватаром (буква на пастельном фоне) внутри триггера. По умолчанию — последний выбранный (`localStorage`), либо первый активный
- [ ] **Услуга** — typeahead (combobox `cmdk`); справа от названия показываем `≈ €{default_price}` (из `services.default_price_cents`); валюта из `salons.currency`
- [ ] **Сумма** — большой жёлтый инпут (фон `bg-brand-yellow`, бордер `border-brand-yellow-deep`, высота 64px). Слева символ валюты navy 28px, инпут JetBrains Mono 32px. По умолчанию — default_price выбранной услуги, можно перебить
- [ ] **Тип оплаты** — pills под суммой (не отдельным полем): Наличные / Карта / Перевод. Активный — navy fill белым текстом. По умолчанию — последний выбранный, либо `Карта`
- [ ] **Комментарий** (опц.) — обычный инпут, placeholder «Например: новая клиентка, по рекомендации»
- [ ] Кнопка `Сохранить визит` — navy, full-width, 52px. Под ней teal-link `Сохранить и добавить ещё` — после клика форма очищает услугу/сумму/комментарий и оставляет дату/мастера/оплату для пакетного ввода
- [ ] Сохранение через TanStack Query с optimistic update + invalidate `['visits']` и `['dashboard-kpis']`
- [ ] Toast «Визит добавлен» (sage) с кнопкой `Откатить` — последний созданный визит soft-delete'ится, тоаст показывает 5 секунд
- [ ] Валидация Zod: сумма > 0 (числовая), мастер выбран, payment_method из enum, комментарий ≤ 500 символов
- [ ] Esc закрывает модалку, спрашивает подтверждение если есть изменения

### TASK-11: Список визитов

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-10
**AC:**

- [ ] `/{salonId}/visits` страница
- [ ] Список визитов за период (default: 30 дней)
- [ ] Фильтры: период, мастер, услуга, тип оплаты
- [ ] Таблица (desktop) / карточки (mobile): дата, мастер, услуга, сумма, тип оплаты
- [ ] Клик на строку — drawer с деталями + Edit/Delete
- [ ] Soft delete с подтверждением
- [ ] Группировка по дням
- [ ] Infinite scroll (50 на страницу)

### TASK-12: Управление мастерами и услугами

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-09
**AC:**

- [ ] `/{salonId}/settings/staff` — CRUD мастеров (упрощённый: имя, % выручки)
- [ ] `/{salonId}/settings/services` — CRUD услуг и категорий
- [ ] Архивирование вместо удаления (для сохранения истории визитов)
- [ ] Валидация: имя, % 0–100

### TASK-13: Ввод и список расходов

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-09
**Визуал:** `Design/project/screens-2-3.jsx` → `ExpensesScreen`
**AC:**

- [ ] `/{salonId}/expenses` страница, period-toggle в TopBar управляет окном
- [ ] Заголовок «Расходы» + строка «Май 2026 · всего €X» (red, mono, число)
- [ ] Кнопка «+ Добавить расход» (teal, не FAB) справа от заголовка — открывает Dialog с формой расхода
- [ ] Полоса summary-карточек по 4 главным категориям (Аренда / Зарплата / Материалы / Реклама) — `border-l-4` цветом категории, иконка, имя, сумма за период (mono). Если в БД категории под другим именем — показываем по `is_system=true` категориям, иконка по маппингу
- [ ] **2 колонки** (`1.5fr 1fr` на desktop, в одну колонку на mobile):
  - Левая — карточка «Все расходы»: строки списка с `border-l-3` цветом категории, дата (mono, muted), иконка категории на цветной подложке, название + категория второй строкой, сумма красным, кнопка edit. Клик на строку — drawer с деталями + edit/delete (soft delete)
  - Правая — карточка «Структура расходов»: progress-bars по каждой категории с %; ниже — карточка-плейсхолдер AI-подсказки (gradient yellow, teal-border-left, иконка робота). **В стадии 1 AI-карточка скрыта**, появляется в TASK-33
- [ ] Форма расхода (Dialog/Sheet): дата (default — сегодня), категория (Select), сумма (жёлтый mono-инпут как в TASK-10), комментарий (опц.), тип оплаты (опц., те же 3 pills что и в визитах)
- [ ] Дефолтные категории создаются при онбординге (TASK-08, шаг 4) — 7 шт. из `docs/03_DATA_MODEL.md` с `is_system=true`. Юзер может архивировать, не удалять
- [ ] CRUD для категорий: `/{salonId}/settings/expense-categories`. Архивирование (`is_archived`), не delete

### TASK-14: Дашборд

**Стадия:** 1 · **Оценка:** L · **Зависит от:** TASK-10, TASK-13
**Визуал:** `Design/project/screen-dashboard.jsx` (desktop), `screens-4-5-mobile.jsx` → `MobileDashboard` (mobile)
**AC:**

- [ ] `/{salonId}/dashboard` — default landing после логина
- [ ] Period-toggle в TopBar (День / Неделя / Месяц / Период) управляет всем окном дашборда. State в URL `?period=`
- [ ] Hero-приветствие: «Привет, {имя} 👋» + подпись «Вот как идут дела в этом {периоде}»
- [ ] **KPI-ряд** (3 карточки в grid `1fr 1fr 1.35fr`): Выручка (sage-число) / Расходы (red-число с минусом) / **Прибыль** — большая тёмная navy-карточка с sage-glow в углу, число 48px JetBrains Mono, sublabel «чистыми в кармане», pill сравнения с прошлым периодом «↑ +12% к {период}»
- [ ] **Второй ряд** (`1.5fr 1fr`): «Выручка по мастерам» — горизонтальные progress-bars (аватар, имя, специализации, сумма) + «Тип оплаты» — donut chart (Наличные/Карта/Перевод) с центральной общей суммой
- [ ] **Топ услуг месяца**: ряд из **5** карточек-сервисов через RPC `top_services_by_revenue(p_limit=5)`. На карточке: маржа цветной точкой (sage ≥50% / gold 35–50% / red <35%), название, выручка, число визитов. Клик → переход в Аналитику (TASK-23, заглушка в стадии 1)
- [ ] **Последние записи**: таблица 5 строк через `visits` (отсортированы по `visit_at desc`): дата (mono muted), аватар+имя мастера, услуга, сумма (sage с `+`), pill оплаты. Ссылка «Показать все →» ведёт в `/{salonId}/visits`
- [ ] Топ-3 мастера через RPC `top_staff_by_revenue(p_limit=4)` (показываем 4 в прототипе)
- [ ] **Empty state**: если нет ни одного визита за всё время — показываем иллюстрацию + «Добавь первый визит, чтобы увидеть магию» + большая кнопка `+ Добавить визит`. Все остальные карточки скрыты
- [ ] **Skeleton loading**: KPI-карточки и таблица грузятся через TanStack Query, в pending — skeleton-плейсхолдеры точных размеров реальных карточек
- [ ] **Mobile** (`MobileDashboard`): прибыль большой тёмной карточкой первой, выручка/расходы 2-колоночным grid, master bars без специализаций, секция «Сегодня» с последними 2 визитами, FAB сверху bottom-nav
- [ ] **Bar-chart по дням НЕ на дашборде** — переезжает в TASK-23 «Аналитика». «Незакрытые дни ≥3» тоже в Аналитике
- [ ] Все суммы — через `formatCurrency(cents, salon.currency)`; класс `.num` (JetBrains Mono + tabular figures) на всех числах

**Тесты:** Vitest unit для логики маржи на клиенте; RPC `dashboard_kpis` и `top_staff_by_revenue` уже покрыты SQL-тестами — добавить `top_services_by_revenue` к ним (если ещё не покрыт)

### TASK-15: i18n + RU локаль

**Стадия:** 1 · **Оценка:** S · **Зависит от:** TASK-02
**AC:**

- [ ] react-i18next настроен
- [ ] `i18n/locales/ru.json` со всеми строками
- [ ] Структура ключей: `<feature>.<screen>.<element>`
- [ ] Все строки в коде через `t('key')`, никакого хардкода
- [ ] Locale switcher в шапке (только RU в стадии 1)
- [ ] `Intl.NumberFormat` и `date-fns/locale/ru` для форматирования

### TASK-16: Stripe — checkout и подписка

**Стадия:** 1 · **Оценка:** L · **Зависит от:** TASK-09
**AC:**

- [ ] Stripe Product "Finkley Standard" создан в test mode + live mode
- [ ] Stripe Tax включён (для PL/EU)
- [ ] `/pricing` page (внутри SPA или в landing)
- [ ] Кнопка "Начать триал" → Stripe Checkout (без карты, 14 дней trial)
- [ ] Edge function `stripe-webhook`: события `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_failed`
- [ ] Запись в `salon_subscriptions`
- [ ] Кнопка "Управление подпиской" → Stripe Customer Portal
- [ ] После окончания триала без оплаты: salon → read-only (баннер)
- [ ] Email уведомления через Postmark (триал заканчивается, оплата прошла, оплата не прошла)

ADR `decisions/006-stripe-integration.md`

**Тесты:** Stripe CLI для симуляции webhook events на локалке

### TASK-17: Лендинг

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-16
**AC:**

- [ ] `apps/landing` — Astro
- [ ] Страницы: `/` (hero + UTP + features + FAQ), `/pricing`, `/privacy`, `/terms`
- [ ] Деплой на тот же GitHub Pages (например, `landing.finkley.app` через CNAME поддомен) или интегрировано на `/` основного домена
- [ ] Plausible script
- [ ] Mobile-адаптация
- [ ] Все на RU
- [ ] CTA "Начать бесплатно" → `app.finkley.app/signup` (или `/signup` на главном домене если общий)

ADR `decisions/008-landing-stack.md`

### TASK-18: Settings → профиль салона

**Стадия:** 1 · **Оценка:** S · **Зависит от:** TASK-09
**AC:**

- [ ] `/{salonId}/settings/general`
- [ ] Поля: имя, страна, валюта, timezone, тип, логотип (Supabase Storage)
- [ ] Кнопка "Удалить салон" с подтверждением (ввод имени)
- [ ] Кнопка "Экспорт данных" (placeholder в стадии 1, реальная реализация — стадия 2)

### TASK-19: Email-уведомления

**Стадия:** 1 · **Оценка:** M · **Зависит от:** TASK-16
**AC:**

- [ ] Edge function `send-email` — обёртка над Postmark API
- [ ] Postmark templates: welcome, trial_ending, payment_succeeded, payment_failed, subscription_canceled
- [ ] Welcome письмо при регистрации (через trigger или handle_new_user)
- [ ] Trial ending — Supabase scheduled function за 3 дня до конца
- [ ] Письма при stripe webhook events
- [ ] Все письма на RU, бренд цветами

---

## Стадия 2 — Ядро

**Релиз:** публичный запуск.

### TASK-20: Реестр клиентов ✅ DONE (овернайт 7 мая 2026)

**Стадия:** 2 · **Оценка:** L
**AC:** CRUD клиента, список с поиском/фильтрами, drawer с историей визитов, привязка визитов через typeahead, денормализованные счётчики.

**Что в проде:** `routes/clients/*` (Page, FormModal, Drawer, Picker), `hooks/useClients.ts`, `lib/utils/format-phone.ts` (libphonenumber-js E.164 нормализация PL/UA/RU), Sheet UI-компонент. Поиск по name/phone/email, сортировка по last_visit/name/revenue. ClientPicker в QuickEntryModal с inline-create. Денорм-триггер на `visits` уже был (миграция 4). E2E `clients-flow.spec.ts` зелёный.

### TASK-21: Расширенные схемы оплаты мастерам ✅ DONE (7 мая 2026)

**Стадия:** 2 · **Оценка:** L
**AC:** UI выбора `payout_scheme`, поля для `fixed`/`percent_revenue`/`percent_service`/`chair_rent`/`mixed`, `staff_service_overrides`.

**Что в проде:** StaffEditSheet (drawer 480px) с радиокарточками 5 схем + условными полями. Per-service overrides — таблица услуг внутри drawer (видна только при `percent_service`). Минимальная форма «Добавить мастера» (только имя) — дефолт `percent_revenue 40%`. Карточки мастеров показывают summary схемы + кнопку «Изменить». Хук useStaffMutations нормализует поля под выбранную схему (лишние = null). Без миграций — schema была готова с TASK-12.

### TASK-22: Расчёт зарплат и ведомость ✅ DONE (7 мая 2026)

**Стадия:** 2 · **Оценка:** L · **Зависит от:** TASK-21
**AC:** Страница payouts, авторасчёт через RPC `calculate_payout(staff_id, period_start, period_end)`, ведомость PDF, закрытие периода с auto-expense.

**Что в проде:** Страница `/{salonId}/payouts` с месячным picker (← →). RPC `calculate_payouts_for_period` (read-only, stable, single-CTE) для всех схем включая percent_service через staff_service_overrides. Кнопка «Закрыть период»: создаёт строки в payouts (status=paid) + одну expenses-строку на каждого мастера в auto-категории «Зарплаты» (создаётся как is_system=true). Защита от двойного закрытия — unique-индекс ux_payouts_salon_staff_period. PDF — через window.print() с `print:hidden` на decoration (zero bundle weight, кросс-браузер). История закрытых периодов под основной таблицей. Миграция 20260507000005.

### TASK-23: Аналитика и отчёты ✅ DONE (7 мая 2026)

**Стадия:** 2 · **Оценка:** XL
**AC:** P&L отчёт, выручка по мастерам/услугам, типу оплаты, загрузка по дням/часам (heatmap), маржа по услугам, сравнение периодов, экспорт PDF/Excel.

**Что в проде:** Страница `/{salonId}/reports` (заменила ComingSoon, sidebar implemented=true). KPI-карточки revenue/expense/profit с дельтой к прошлому месяцу (TrendingUp/Down). Bar-list по мастерам, donut-list по способам оплаты, top-50 услуг таблица, heatmap день×час бизнес-окна 8..21 в брендовом navy gradient. PDF — через window.print(). Миграция 20260507000006: `analytics_revenue_by_payment` + `analytics_visits_heatmap` (timezone-aware через salon.timezone), KPI/staff/service переиспользуют существующие dashboard RPC.

**Доделано 8 мая 2026:**

- **Маржа по услугам** — миграция `20260508000016_service_cost_and_margin.sql`: добавлено поле `services.cost_cents` (nullable) + RPC `top_services_by_revenue` теперь возвращает `cost_cents` / `margin_cents` / `margin_pct`. Дашборд: top-services карточки используют реальную маржу (sage ≥50% / gold 35–50% / red <35%) когда задана себестоимость, иначе fallback на share-pseudo. Reports → таблица услуг получила колонку «Маржа». Settings → новая карточка `ServicesPricingCard` для inline-редактирования cost/price (полный CRUD услуг = TASK-12 отдельной задачей).
- **Excel-экспорт** — кнопка «Excel» в Reports, `downloadAsXls()` через HTML+`application/vnd.ms-excel` (без новых deps; Excel/Numbers/LibreOffice понимают). 4 листа: KPI, по мастерам, по услугам с маржой, по способам оплаты.
- **Custom date-range** — переключатель «Месяц / Период» в TopBar Reports. В режиме «Период» — два date-инпута, RPC уже принимал start/end. Сравнение к прошлому периоду в режиме range считает прошлый отрезок такой же длины.

### TASK-24: Группированный ввод и доп.поля визита ✅ DONE (8 мая 2026)

**Стадия:** 2 · **Оценка:** M
**AC:** Multi-row форма, чаевые, скидки, повторяющиеся шаблоны.

**Что в проде:** `tip_cents` / `discount_cents` в QuickEntryModal + EditVisitModal. RPC дашборда: `revenue = sum(amount - discount + tip)`. Multi-row grid — вкладка «Несколько визитов» внутри QuickEntryModal (`BulkVisitsForm`, до 10 строк, общая дата). Повторяющиеся шаблоны — таблица `visit_templates` + RPC `upcoming_visit_templates` + `useClientTemplates` хук + UI на карточке клиента (`ClientTemplatesSection`). Notification-bell показывает «у клиента N подходит время для визита по графику».

### TASK-25: Расходы — расширения ✅ DONE (8 мая 2026)

**Стадия:** 2 · **Оценка:** M
**AC:** Фото чека (Storage), повторяющиеся расходы, бюджет vs факт, остаток нала в кассе.

**Что в проде:** Storage bucket `receipts` (private, 10 MB, image/\* + PDF) с RLS scoped по `salon_id`, signed-URL viewer. `recurrence` enum + edge function `process-recurring-expenses` + pg_cron job (раз в сутки, 03:00 UTC). Бюджет vs факт — `BudgetsCard` на странице расходов (RPC `category_budgets_progress` показывает % использования бюджета по категории). Остаток нала — `CashBalanceWidget` на дашборде (RPC `compute_cash_balance` = opening_cash + cash_revenue − cash_expenses). Поле `salons.opening_cash_balance_cents` редактируется в Settings.

### TASK-26: Экспорт данных (GDPR) ✅ DONE (овернайт 7 мая 2026)

**Стадия:** 2 · **Оценка:** M
**AC:** Edge function generate-export → ZIP с CSV всех таблиц + PDF summary, signed URL TTL 24h, email со ссылкой.

**Что в проде:** Миграция 20260507000002 (таблица `export_requests` + Storage bucket `exports` 100 MB private). Edge function `generate-export` (verify-jwt) собирает 10 таблиц через service-role, упаковывает JSZip, signed URL 24h. Rate-limit 1/24h: повторный запрос отдаёт ту же ссылку. Шаблон `gdpr_export` в Resend, ссылка автоматом уходит на email юзера. Settings → «Экспорт данных» теперь работает (раньше был placeholder). **PDF summary** не сделан — был optional, ZIP с CSV + README.txt полностью покрывает GDPR Art. 20.

---

## Стадия 3 — Интеграции

### TASK-27: Booksy — research спайк ✅ DONE (7 мая 2026)

См. ADR `decisions/008-booksy-integration.md` — финализирован выбор: client-side hCaptcha + edge proxy POST вместо Playwright/VNC.

**Стадия:** 3 · **Оценка:** M
**AC:** Изучить рабочий паттерн прокси-логина владельца с sasovsky. Применить к Booksy. Решение зафиксировать в ADR `decisions/005-booksy-integration-strategy.md`. Если паттерн владельца не работает на Booksy (JS-rendering + hCaptcha) — план Б. До решения этой задачи остальные TASK-28..30 заблокированы.

### TASK-28: Booksy интеграция UI ✅ DONE (7-8 мая 2026)

`/{salonId}/integrations` карточка Booksy с invisible hCaptcha, BooksyConnectDialog, статус (connected/error/pending), частота автосинка (2 мин - 24 часа), кнопки Sync now / Очистить визиты / Disconnect.

**Стадия:** 3 · **Оценка:** L · **Зависит от:** TASK-27
**AC:** `/{salonId}/integrations/booksy` форма, спиннер логина, статус, кнопка отключить.

### TASK-29: Booksy синк визитов ✅ DONE (8 мая 2026)

Edge function `booksy-proxy` синкает staff/services/clients/visits. Per-subbooking visits с `group_key` для UI группировки multi-service appointments. pg_cron каждые 2 минуты (`booksy-auto-sync`) с rendezvous-token. Reverse iteration по неделям + 45s budget = resumable sync. Цены из basket.items (paid) → dry_run (`/pos/transactions`) → default service price (fallback). Map payment_type_code → наш enum.

**Стадия:** 3 · **Оценка:** L · **Зависит от:** TASK-28
**AC:** Edge function `booksy-sync` по cron каждые 30 мин, маппинг bookings + POS в visits, идемпотентный upsert, логирование в `integration_sync_logs`, refresh токена при 401, нотификация при 3 сбоях подряд.

### TASK-30: OCR расходов ✅ DONE

Edge function `ocr-receipt` (Anthropic Claude Haiku 4.5 vision). UI кнопка «📷 Чек» в ExpenseFormModal: upload в Storage receipts, signed URL → OCR → JSON-parsing (amount, date, vendor) → автозаполнение полей, юзер подтверждает.

**Стадия:** 3 · **Оценка:** L
**AC:** Кнопка "📷 Чек" в форме, upload в Storage, edge function `ocr-receipt` через Anthropic Claude Haiku 4.5, JSON парсинг, confirm-карточка, fallback Groq Llama Vision.

### TASK-31: wFirma (PL only) ✅ DONE (8 мая 2026)

**Стадия:** 3 · **Оценка:** XL
**AC:** UI подключения (accessKey/secretKey), синк закупочных фактур, отправка expense в wFirma, KSeF, отображается только для country_code=PL.

**Что в проде:**

- **Hybrid X3 connect-flow** (см. ADR-012): Quick-таб (email+password от wfirma.pl) → Edge function реверсит UI wFirma и автоматически создаёт приложение «Finkley», вытаскивая accessKey/secretKey. Manual-таб (3 ключа руками) — фолбэк для юзеров с 2FA или если auto-flow сломался.
- **AES-256-GCM шифрование** wFirma `secret_key` через `WFIRMA_SECRETS_KEY` (см. ADR-011). Шифр/дешифр только в edge function `wfirma-proxy`.
- **Sync** (pull): расходы wFirma → Finkley `expenses`, source='wfirma', категория «Импорт wFirma» (создаётся автоматом per salon). Cron `wfirma-auto-sync` каждые 10 минут проверяет due-integrations с дефолтным интервалом 60 минут per salon. KSeF id и contractor NIP кладутся в `expenses.metadata` для UI.
- **Push** (single expense): кнопка «Отправить в wFirma» в списке расходов (`auto:false`) + auto-push после save если есть чек и совпал `buyer_nip` (`auto:true`). Auto-match по `expenses.metadata.buyer_nip` vs `salon_integrations.credentials.company_nip` (заполняется при connect через `companies/find`). Без NIP-совпадения push скипается с tooltip-плашкой и предложением ручной кнопки.
- **OCR-расширение** (`ocr-receipt`): Vision-промпт теперь возвращает `vendor_nip`+`buyer_nip` (NIP sprzedawcy и nabywcy на польских фактурах). Используется в auto-match push.
- **Валюта**: PLN/EUR/USD/любая ISO — wFirma сама конвертирует по курсу NBP (см. документацию wFirma); никаких блокировок по currency.

### TASK-44: wFirma — хвосты (PDF, multi-company, category mapping) ✅ DONE (10 мая 2026)

См. ниже плюс TASK-46..51 — закрываем стадию 3 «Интеграции» полностью.

### TASK-45: Категории на странице `/integrations` ✅ DONE (10 мая 2026)

**Стадия:** 3 · **Оценка:** S

`/integrations` сгруппирована в 4 секции с заголовками: Бухгалтерия и фактуры / Запись и календарь / Банкинг / Документы и OCR. `INTEGRATIONS` массив в `integrations-config.ts` дополнен полем `category`. В RU/PL/EN добавлены ключи `integrations.categories.*`. BankingSection переехал в категорию banking без дубля заголовка.

### TASK-46: KSeF direct — pull входящих фактур ✅ DONE (10 мая 2026)

**Стадия:** 3 · **Оценка:** XL

**Что в проде:**

- ADR-013 «Multi-portal accounting + KSeF direct» — source-of-truth priority и дедупликация по NumerKSeF.
- Edge function `ksef-proxy/` (TokenAuth flow): AuthorisationChallenge → RSA-OAEP-SHA256 wrap → InitToken → SessionToken; Query/Invoice/Sync для subjectType=subject2 (входящие); Invoice/Get → парсер FA(2) XML + сохранение в Storage receipts. Закрытие сессии после sync.
- Шифрование KSeF token через AES-256-GCM (`KSEF_SECRETS_KEY` — добавить в Edge Function secrets).
- Миграция `20260510000006_ksef_integration.sql` — таблица `ksef_sync_triggers` + UNIQUE индекс `idx_expenses_salon_ksef_id` на `(salon_id, metadata->>'ksef_id')` (источник для cross-portal дедупа).
- Cron `ksef-auto-sync` каждые 15 минут (миграция `20260510000007_ksef_sync_cron.sql`), per-salon интервал по умолчанию 60 минут.
- UI: `KsefConnectDialog` (NIP + token + radio test/prod environment + 4-step хелп для Profil Zaufany), интеграция в IntegrationsPage, hooks `useKsefConnect`/`useKsefSync`.
- i18n RU/PL/EN: errors (invalid_nip/invalid_token/invalid_credentials/challenge_failed/api_error), dialog labels, tos.

**Аутентификация — token-only.** Qualified signature и ePUAP-печать отложены до запроса (тяжёлый onboarding для 95% юзеров).

**Push своих фактур** — отдельный TASK когда понадобится. Салоны без wFirma в основном выставляют только paragony, push не приоритет.

### TASK-47: Fakturownia integration ✅ DONE (10 мая 2026)

**Стадия:** 3 · **Оценка:** L

Edge function `fakturownia-proxy/` — pull `/api/expenses.json` (purchase invoices) + push `/api/expenses.json`. Auth через `api_token` query param. Шифрование `FAKTUROWNIA_SECRETS_KEY`. Миграция `20260510000008` — cron `fakturownia-auto-sync` каждые 15 минут. Universal `useAccountingConnect` / `useAccountingSync` хуки в `useIntegrations.ts` обслуживают Fakturownia/iFirma/360Księgowość/inFakt через один диалог `ConnectIntegrationDialog`. Маппинг wFirma-категорий на Finkley в `category-mapping.ts`.

### TASK-48: iFirma integration ❌ CANCELLED (11 мая 2026)

Отменено решением владельца — не интересуют. Edge function ifirma-proxy и миграция 20260510000009 удалены из активного кода; reverse-миграция `20260511000001_drop_ifirma_ksiegowosc360.sql` дропает cron job, trigger-таблицу и soft-delete'ит salon_integrations если кто-то успел подключиться.

### TASK-49: 360Księgowość integration ❌ CANCELLED (11 мая 2026)

Отменено решением владельца — не интересуют. Аналогично TASK-48: код и миграция удалены, reverse-миграция чистит staging если применилось.

### TASK-50: inFakt integration ✅ DONE (skeleton; partner access ожидает)

**Стадия:** 3 · **Оценка:** L

Edge function `infakt-proxy/` — `X-inFakt-ApiKey` header, REST `/v3/expenses.json` (pull/push), `/v3/account.json` (smoke). Шифрование `INFAKT_SECRETS_KEY`. Миграция `20260510000011` — cron `infakt-auto-sync`. Карточка на `/integrations` помечена `status: in_research` — кнопка connect открывает диалог, но 401 от inFakt отдаст понятный код `not_partner_yet`. Реальное подключение возможно после получения партнёрского API-доступа от inFakt (1-2 нед заявки).

### TASK-51: Source-of-truth dedup по `ksef_id` ✅ DONE (10 мая 2026)

**Стадия:** 3 · **Оценка:** M

Дедупликация фактур, пришедших из нескольких порталов (КСеФ direct + wFirma/Fakturownia/iFirma/...). Реализация:

- UNIQUE index `idx_expenses_salon_ksef_id` на `(salon_id, metadata->>'ksef_id') WHERE deleted_at IS NULL` (создан в TASK-46 миграции, пересоздан в TASK-51 после backfill).
- Backfill миграция `20260510000012_dedup_ksef_id_backfill.sql`: переносит `metadata.wfirma_ksef_id` → `metadata.ksef_id` для существующих расходов wFirma (унификация поля кросс-портал).
- Все sync-функции (КСеФ, wFirma, Fakturownia, iFirma, 360Księgowość, inFakt) пишут `ksef_id` в metadata. UNIQUE_VIOLATION (Postgres `23505`) ловится в каждом sync — расход скипается.
- Приоритет источников (зафиксирован в ADR-013 §D): wFirma > Fakturownia > iFirma > 360Księgowość > inFakt > KSeF > OCR > manual. Бухгалтерские системы знают категорию, КСеФ — нет; потому при коллизии раньше пришедший из бухгалтерии расход остаётся.

### TASK-52: Symmetry хвосты (PDF, push UI, auto-push) ✅ DONE (10 мая 2026)

**Стадия:** 3 · **Оценка:** M

После основной интеграции 4-х новых порталов закрыты feature-симметрии с wFirma:

- **PDF импорт** при sync для всех 4 порталов (Fakturownia/iFirma/360Księgowość/inFakt). Best-effort функции `<provider>GetExpensePdf` + `upload<Provider>Pdf` помещают PDF в Storage `receipts`. Если портал не отдаёт PDF (404/auth) — расход сохраняется без чека.
- **UI push-кнопка** в `ExpensesPage`: универсальная (одна на активный accounting-портал) — выбирает правильный hook через `pickActiveAccountingProvider()` (приоритет wFirma > Fakturownia > iFirma > 360Księgowość > inFakt). Toast/aria-label через `expenses.portal.*` i18n. Существующая `expenses.wfirma.*` оставлена для backward compat.
- **Auto-push после save** в `ExpenseFormModal`: если у расхода есть чек и подключён accounting-портал, расход автоматически отправляется. Для wFirma — server-side NIP-match как раньше; для остальных — отправка любого расхода с чеком (NIP-match для них пока не реализован, но edge function принимает auto flag и проверяет наличие чека).
- **Универсальный хук** `useAccountingPushExpense(provider, salonId)` в `useIntegrations.ts` — параметризованный по 4 не-wFirma порталам (wFirma имеет свой `useWfirmaPushExpense` потому что у него NIP-mismatch logic).

**Что не сделано** (для прода нужно):

- NIP-сравнение в auto-push для Fakturownia/iFirma/360Księgowość/inFakt (нужно сохранять `company_nip` в credentials каждого портала; для MVP опускаем — auto-push идёт только при наличии чека).
- Тестирование PDF endpoint для 360Księgowość/inFakt — без живого аккаунта точные пути не проверены, реализация best-effort с тихим fallback на null.

---

**Что добавить в Edge Function secrets перед prod:**

| Secret name               | Описание                                           |
| ------------------------- | -------------------------------------------------- |
| `KSEF_SECRETS_KEY`        | 32 байта base64 для шифрования KSeF token          |
| `KSEF_DEFAULT_ENV`        | `test` или `prod` (по умолчанию `test`)            |
| `FAKTUROWNIA_SECRETS_KEY` | 32 байта base64                                    |
| `INFAKT_SECRETS_KEY`      | 32 байта base64 (когда получим партнёрский доступ) |

Генерация: `openssl rand -base64 32`. Каждый отдельный — изоляция compromise (см. ADR-011/013).

**Стадия:** 3 · **Оценка:** S · **Зависит от:** TASK-31

**Что в проде:**

- **PDF фактуры в Storage receipts** при sync — `uploadWfirmaPdf()` в `wfirma-proxy/index.ts` качает PDF через `wfirmaExpensePdf()` и кладёт в bucket `receipts` под `<salon_id>/wfirma-<id>-<uuid>.pdf`. Best-effort: если PDF недоступен или upload упал — расход сохраняется без чека.
- **Per-salon выбор компании** при auto-login если их несколько — Edge function возвращает `error: 'choose_company', companies: [...]`, UI (`WfirmaConnectDialog`) показывает radio-список фирм step-2, юзер выбирает → action повторяется с `selected_company_id`.
- **Semantic-mapping категорий** — `mapWfirmaToFinkleyCategory()` в `wfirma-proxy/category-mapping.ts` парсит name+description+contractor по PL/RU keywords (czynsz/аренда → Аренда, kosmetyk/материал → Материалы и т.д., 6 категорий + fallback). Lazy fallback на «Импорт wFirma» — создаётся только если хотя бы один расход не сматчился.

---

## Стадия 4 — Рост

### TASK-33: AI-инсайты (rules-based + LLM polish) ✅ DONE (7 мая 2026)

Edge function `generate-insights` weekly cron (`generate-weekly-insights`, понедельник 08:00 UTC), rules-engine + Claude Haiku 4.5 polish, запись в `insights`, виджет на дашборде, severity-aware sorting. Также: `AIAssistantPage` (8 мая) — отдельный чат-помощник на базе того же Claude.

**Стадия:** 4 · **Оценка:** XL
**AC:** Edge function `generate-insights` weekly cron, простые правила (убыточная услуга, низкая загрузка мастера, аномалия), запись в `insights`, виджет на дашборде. LLM-polish через Claude Haiku — формулировка естественным RU.

### TASK-34: Weekly digest email ✅ DONE (8 мая 2026)

**Стадия:** 4 · **Оценка:** M · **Зависит от:** TASK-33
**AC:** Cron понедельник 9:00, 3 главные цифры + 1 инсайт, opt-out в settings.

**Что в проде:** Settings → «Еженедельный дайджест» с opt-out тогглом и кнопкой «Отправить сейчас». Edge function `send-weekly-digest` собирает revenue/expense/profit прошлой ISO-недели + дельту к предыдущей + топ-мастер + топ-услугу + **топ-инсайт текущей недели** (вытягивается из таблицы `insights`). Шаблон `weekly_digest` в Resend, рендер сразу с insight_block. Auto-cron `send-weekly-digests` (понедельник 09:00 UTC) через rendezvous-token pattern — `process_weekly_digests()` SQL функция, pg_cron + pg_net.

### TASK-35: PWA + push-уведомления ✅ DONE (8 мая 2026)

**Стадия:** 4 · **Оценка:** L
**AC:** manifest.json, service worker, иконки, "добавить на главный экран", Web Push API, подписка в settings.

**Что в проде:** PWA install criteria + Web Push end-to-end. Edge function `send-push` собран чистым Deno без зависимостей: VAPID JWT signer (ES256, P-256) + RFC 8291 aes128gcm payload encryption. Actions: subscribe / unsubscribe / test. Таблица `push_subscriptions` (own-rows RLS). Service worker handles `push` event с notification, `notificationclick` фокусирует существующее окно или открывает новое. `PushNotificationsCard` в Settings с enable/disable/test, обработка unsupported (iOS pre-PWA-install) и permission-denied. VAPID keys в Supabase secrets, public — в GitHub Secrets для билда.

### TASK-36: Бенчмарки ✅ DONE (7 мая 2026)

Таблица `benchmark_aggregates`, RPC `compute_benchmarks` (k-anonymity N≥10), pg_cron `compute-benchmarks` (раз в сутки 03:30 UTC), opt-in `salons.benchmarks_opt_in`, виджет на дашборде «Сравнение с рынком». Покажет реальные данные когда будет 10+ салонов одного типа в стране.

**Стадия:** 4 · **Оценка:** XL
**AC:** Edge function пересчитывает агрегаты раз в сутки в `benchmark_aggregates` (страна, тип, средний чек, оборот), k-anonymity N≥10, виджет на дашборде, opt-in при регистрации.

---

## Стадия 5 — Масштаб

Базовая инфраструктура для команд и enterprise-фич. Детализация планировалась после 100 платящих, но реализовано раньше — миграции 20260508000006..008.

### TASK-37: Роли и права (admin/staff/accountant) ✅ DONE (8 мая 2026)

**Стадия:** 5 · **Оценка:** L
**AC:** Enum `salon_role` (owner/admin/accountant/staff), helper-функции, RLS-политики по ролям.

**Что в проде:** Миграция `20260508000006_roles_helpers_invitations.sql`. Helper-функции (security definer): `salon_role_of(salon_id)`, `is_salon_admin(salon_id)`, `is_salon_owner(salon_id)`, `my_staff_id(salon_id)`. RLS-политики на `visits/expenses/salon_members/salons` используют их: staff видит только свои визиты, расходы скрыты от staff, admin может update/delete членов команды. UI селектор ролей в TeamPage.

### TASK-38: Приглашения по email ✅ DONE (8 мая 2026)

**Стадия:** 5 · **Оценка:** M · **Зависит от:** TASK-37
**AC:** Таблица invitations с токеном и сроком, email с magic-ссылкой, страница принятия после логина.

**Что в проде:** Таблица `salon_invitations` (token, expires_at, email, role). Edge function `send-invitation` создаёт инвайт + шлёт email через Resend (шаблон `team-invitation`). RPC `accept_salon_invitation(token)` валидирует токен/срок/email-match и создаёт строку в `salon_members`. UI: `TeamPage` (список членов + диалог invite + revoke), `AcceptInvitePage` (auto-accept после login).

### TASK-39: Audit log ✅ DONE (8 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:** Запись CRUD-операций по чувствительным таблицам, страница просмотра для admin/owner.

**Что в проде:** Таблица `audit_log` (action, entity_type, entity_id, payload jsonb, user_id, salon_id, created_at). 5 DB-триггеров на visits/expenses/salon_members/salon_invitations/salons. Миграция `20260508000011_revoke_audit_triggers` отзывает grants на trigger-функции от anon/authenticated (security harden — триггеры остаются работать, но функции нельзя дёрнуть напрямую). Страница `/{salonId}/audit` (visible только admin/owner через RLS).

### TASK-40: 2FA (TOTP) ✅ DONE (8 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:** Подключение authenticator-приложения (QR + код), challenge при логине, revoke factor.

**Что в проде:** Native Supabase Auth MFA (без миграций). Хук `useMFA.ts` оборачивает `auth.mfa.*`: `useEnrollTOTP()` (QR + secret), `useVerifyEnrollment()` (challenge + verify 6-значного кода), `useChallengeMFA()` (login-time challenge), `useAAL()` (assurance level). UI `MFACard.tsx` в Settings: enable/disable, список факторов, revoke. Login flow: после email+password если `aal=aal2` нужен → редирект на challenge-форму.

### TASK-41: API-ключи ✅ DONE (8 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:** Создание ключа с scopes, ключ показывается один раз, revoke, прозрачный hash в БД.

**Что в проде:** Миграция `20260508000008_api_keys_and_referrals.sql`: таблица `api_keys` с `key_hash` (SHA-256), `key_prefix` (для отображения), `scopes`, `revoked_at`. Edge function `api-keys-create` генерит `fnk_live_<32 base32>`, хеширует, возвращает ключ один раз. UI `ApiKeysCard.tsx` с диалогом create + список активных + revoke. Хук `useApiKeys.ts`.

#### TASK-41b: Сам публичный API + документация ✅ DONE (15 июня 2026)

**AC:** Целостный REST API (read/write) для всех основных сущностей; публичная страница документации (доступна без логина); переход из Настройки → API; работоспособность проверена.

**Что в проде:** Edge Function `public-api` (registry-driven, 45 ресурсов: визиты/доходы/расходы/клиенты/услуги/мастера/услуги-мастера/выплаты/склад/контрагенты/конкуренты/касса(read)/банк(read) + 12 аналитических RPC). Аутентификация по `fnk_live_` ключу (SHA-256 → `api_keys`), scopes read/write, жёсткий salon-scoping (service-role), discovery-эндпоинт `GET /v1`, `/me`, пагинация/фильтры/диапазоны дат. Деплой с `--no-verify-jwt` (через `NO_JWT_FUNCTIONS` в deploy-supabase.yml — воркфлоу НЕ читает config.toml!). Публичная страница `/docs/api` (`ApiDocsPage.tsx`, бренд Finkley, email info@finkley.app) читает живой каталог простым GET + раздел «Рецепты». Кнопка из Настройки → API. Тесты `deno test supabase/functions/public-api/` (31). ADR-032. read-only в v1: касса/склад-движения/банк/parent-scoped/payouts(кроме статуса); исключены 3 RPC с `auth.uid()`-guard и глобальный `media_posts`. Проверено вживую в проде (curl `GET /v1` → 200).

#### TASK-49: Мастер↔услуги — выбор услуг мастеру ✅ DONE (15 июня 2026)

**AC:** В Справочники → Мастера выбирать услуги (по категориям и поштучно), которые выполняет мастер.

**Что в проде:** Миграция `20260615000001_staff_services.sql` (таблица `staff_services` staff↔service, RLS по членству салона). Хук `useStaffServices` (list + toggle + bulk). UI-блок в `StaffEditSheet` — услуги сгруппированы по категориям, чекбоксы + «выбрать/снять всю категорию», виден всегда. Выставлено в public-api как ресурс `staff-services` (read+create+delete, фильтр `?staff_id=`).

### TASK-42: Реферальная программа ✅ DONE (8 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:** Уникальный реф-код на юзера, attribution при регистрации, счётчики приглашённых/активированных.

**Что в проде:** Таблицы `referral_codes` (одна на юзера) + `referral_uses` (referrer/referred + activated_at). RPC `get_or_create_referral_code()` (8-символьный base32 с retry на коллизии), RPC `apply_referral_code(code)` (валидация: не self-referral, не использован ранее). UI `ReferralCard.tsx` в Settings: код + copy + счётчики invited/activated.

### TASK-43: Multilingual PL/EN ✅ DONE (8 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:** Полные переводы UI на PL и EN, locale-switcher работает в проде.

**Что в проде:** Файлы `apps/web/src/i18n/locales/{en,pl}.json` имеют **полную парность ключей** с `ru.json` (859 ключей в каждом языке, 0 пропусков). Переведены: dashboard, onboarding, формы визита/расхода/мастера, payouts, reports, AI-помощник, integrations (Booksy/wFirma/OCR), weekly digest, push notifications, team/invitations/audit/api keys/referral/MFA, billing, экспорт данных, error messages, privacy/terms screens. Все interpolations (`{{count}}`, `{{name}}`, `{{period}}` и т.д.) сохранены. Польские формы плюрализации (`_one/_few/_many/_other`) для всех счётных строк (визиты, дни, клиенты). Глоссарий: визита/wizyta, мастер/specialist/specjalista, расход/expense/wydatek, выручка/revenue/przychód и т.д. LocaleSwitcher переключает язык в шапке. Юридические экраны (privacy/terms) сохраняют формальный тон.

---

## Sprint 2026-05-21 — закрытие гэпов (LTV / Конкуренты / Отзывы / Чаевые / Post-visit)

Срочные задачи от владельца, не разбитые на TASK-NN — выполнены одной серией.

### TASK-44: Reports/Клиенты — 4 колонки LTV ✅ DONE (21 мая 2026)

**Стадия:** 5 · **Оценка:** S
**AC:** Revenue LTV, Gross LTV, Customer Lifetime (мес), Visits Count в таблице клиентов.

**Что в проде:** Миграция `20260521000010_client_ltv_metrics.sql` — RPC `client_ltv_metrics` (gross_ltv = revenue − cost услуг, lifetime_months = mes между первым и последним визитом). Колонки в `ClientsAnalyticsTab.tsx`, хук `useClientLtvMetrics`.

### TASK-45: Reports/Мастера — доп.продажи, визиты, Чаевые ✅ DONE (21 мая 2026)

**Стадия:** 5 · **Оценка:** S
**AC:** Колонки «Визиты» (kind=visit revenue) + «Доп. продажи» (kind=retail) + «Чаевые» в Эффективности. Отдельная подвкладка «Чаевые» с KPI карточками и таблицей (per-staff: сумма, tipped visits / всего, средние, доля от выручки).

**Что в проде:** Миграция `20260521000011_staff_performance_tips.sql` — RPC `staff_performance_advanced` расширен `tips_cents`, `visits_revenue_cents`, `retail_revenue_cents`. Миграция `20260521000018_staff_tips_summary.sql` — новый RPC `staff_tips_summary` для подвкладки. UI `StaffAnalyticsTab.tsx` с `PageTabsNav` (performance / tips). Хук `useStaffTipsSummary`. Integration-тесты — `tests/unit/staff-tips-summary-rpc.test.ts` (6 кейсов).

### TASK-46: Зарплаты — колонка Чаевые ✅ DONE (21 мая 2026)

**Стадия:** 5 · **Оценка:** S
**AC:** В `/payouts` показывать сумму чаевых отдельной колонкой (чаевые отдаются мастеру 100%, не в commission).

**Что в проде:** Миграция `20260521000012_payouts_tips.sql` — `calculate_payouts_for_period` возвращает `tips_cents`. UI `PayoutsPage.tsx` с колонкой `payouts.col.tips`, gold-цвет.

### TASK-47: Post-visit модалка — следующая запись + работа с возражениями ✅ DONE (21 мая 2026)

**Стадия:** 5 · **Оценка:** S
**AC:** После выбора документа в расчёте визита → модалка «Запиши клиента на след. визит» с кнопкой ОК + кнопкой «Работа с возражениями» (модалка со скриптом из PDF Wonderful Beauty Admin).

**Что в проде:** `VisitDetailModal.tsx::NextVisitPromptView` (показ после `view='document'`) + `ObjectionsScriptView` с 5 кейсами (`visits.script.case1..5_situation/reply`) во всех 3 локалях. Скрипт взят из «Wonderful Beauty — Скрипт администратора» (раздел 4 — типичные возражения).

### TASK-48: FlySMS-style сбор отзывов ✅ DONE (21 мая 2026)

**Стадия:** 5 · **Оценка:** L
**AC:**

- Auto email + SMS после paid визита с короткой ссылкой
- Public страница `/review/:token` с 5★ → Google Maps редиректом, 1-4★ → форма отзыва
- Reports/Отзывы вкладка: 2 подвкладки (Внешние / Внутренние), поиск, сортировка (newest/oldest/rating asc/desc), баннер с новыми негативными, кнопка «прочитано»
- Импорт отзывов с Booksy + Google
- Cron триггер запросов и cron импорта

**Что в проде:** Миграции `20260521000014_reviews.sql`, `20260521000016_review_request_cron.sql`. Edge functions `send-review-request` (cron 6h), `review-submit` (public endpoint), `reviews-sync` (Google Places API v1 + Booksy `__NEXT_DATA__` scrape). Локализованные email через Resend (ru/pl/en), SMS scaffold (`_shared/sms.ts` — FlySMS/Twilio). UI `ReviewsTab.tsx` с `ReviewsImportButton`. Тесты `src/lib/reviews-sort.test.ts` (11 кейсов). Архитектурный ADR — `decisions/019-flysms-review-flow.md`.

### TASK-49: Мониторинг конкурентов ✅ DONE (21 мая 2026)

**Стадия:** 5 · **Оценка:** XL
**AC:**

- Вкладка `/reports/competitors` с 5 подвкладками: Цены, Загруженность, Рейтинг, Контент, Параметры
- В Параметрах: ручное добавление + автоподбор по Google Places Nearby (мин. 10 в радиусе 2 км)
- Цены: Booksy scrape
- Загруженность: % занятых слотов из Booksy availability
- Рейтинг: Google Places + Booksy
- Контент: posts, followers, following, posts_per_month
- Сравнение со своим салоном (первая строка таблицы)
- PeriodPicker для фильтрации snapshots

**Что в проде:** Миграции `20260521000015_competitors.sql`, `20260521000019_salons_geo_fields.sql`, `20260521000020_sync_cron.sql`. Edge functions `competitor-discover` (Google Places Nearby + geocoding), `competitor-sync` (rating/price/occupancy/content scrape, cron 08:00 UTC). UI `CompetitorsTab.tsx`. Settings UI для `salons.address/city/lat/lng/google_place_id/booksy_url` в `SettingsPage.tsx` секция «Адрес и публичные ссылки». Хуки: `useCompetitors`, `useCompetitorSettings`, `useDiscoverCompetitors`, `useSyncCompetitors`, `useOwnSalonMetrics`. Чистые helper'ы парсинга — `supabase/functions/_shared/social-metrics.ts` + unit-тесты `src/lib/social-metrics.test.ts` (22 кейса). Архитектурный ADR — `decisions/018-competitor-scraping-strategy.md`.

### TASK-50: Cron push клиентам с просроченной регулярностью ✅ DONE (21 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:** Раз в день шлём push клиентам которые пропустили ожидаемый период визита (на основе `service_categories.return_period_days`). Anti-spam: один push на client+category не чаще раза в 7 дней.

**Что в проде:** Миграция `20260521000013_service_categories_return_period.sql` — поле + RPC `client_visit_regularity`. Миграция `20260521000017_client_overdue_pushes.sql` — таблица для anti-spam. Edge function `client-overdue-push` (cron 09:00 UTC). UI «Регулярность возвращаемости» в Reports/Клиенты.

### TASK-51: AI-анализ отзывов с псих-портретом клиента ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** L
**AC:**

- Кнопка «Анализ ИИ» под каждым отзывом → раскрывается inline-панель
- Общий блок «Анализ ИИ N негативных» над таблицей внешних отзывов (Booksy/Google)
- Общий блок «ИИ-разбор внутренних отзывов» над таблицей internal (форма после визита)
- 3 типа промптов: single-external (публичный отзыв + reputation), single-internal (приватный + root cause + что с мастером), bulk (паттерны + top actions + segments)
- Psychological profile: тон, эмоция, темперамент, стиль общения, контекст услуги
- Готовые reply-тексты (suggested_public_reply + suggested_private_message) с авто-детектом языка оригинального отзыва
- Кеш в БД, повторные клики дёшевы

**Что в проде:** Миграция `20260522000006_review_ai_analyses.sql` (таблица кеша). Edge function `reviews-ai-analyze` на Claude Haiku 4.5 (`d371b37`, `6628fe5`, `c1e059c`). UI `ReviewAiPanel.tsx` + `ReviewsTab.tsx` integration. Hook `useReviewAiAnalyze`. i18n RU/EN/PL.

### TASK-52: Reviews UX overhaul — auto-import, KPI, pagination, replies, reply-form ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** L
**AC:**

- Ручная кнопка «Импорт с Booksy/Google» удалена → авто-импорт при mount страницы (one-shot per session)
- Анимация подгрузки (shimmer + bouncing dots) пока reviews-sync работает
- KPI-карточки над фильтрами: средний рейтинг + кол-во по Booksy / Google / Внутренним. На external табе показываются Booksy+Google, на internal — только Внутренние
- Пагинация по 25 отзывов на страницу
- Источник отображается логотипом бренда (коралловая плашка Booksy, белая с 4-цветным glyph Google) вместо текста
- Booksy reviews-sync теперь тянет всю историю (до 1500 отзывов вместо 100), оригинальные тексты (originalText > text)
- reviews.reply_text/reply_author/reply_posted_at отдельными колонками + backfill старых body со склейкой «— Ответ салона: ...»
- Дерево ответов (ReviewReplyTree) — кнопка «Ответ салона (1)», раскрывается inline
- Форма ответа на отзыв из портала (ReviewReplyForm) с textarea + кнопкой «Сгенерировать с ИИ»
- Mark-all-as-read массовая операция (фильтр по source=internal/external)
- Sidebar badge с числом непрочитанных негативных внешних отзывов
- Source/Read фильтры

**Что в проде:** Миграции `20260522000009_reviews_reply.sql`, `20260522000010_reviews_reply_backfill.sql`. Reviews-sync v32 (`a76b8e8`, `affd78c`). UI `ReviewsTab.tsx` + `ReviewReplyForm` + `ReviewReplyTree` + анимации (`c1e059c`). Hooks `useUnreadNegativeReviewsCount`, `useMarkAllReviewsRead`, `useSaveReviewReply`. Sidebar `Sidebar.tsx` с badge (`c4629d1`).

### TASK-53: Review request моментально после оплаты ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** S
**AC:** После маркировки visit.status='paid' клиент получает SMS + Email с просьбой оценить визит в течение минуты (раньше — через 6 часов).

**Что в проде:** Миграция `20260522000007_review_request_realtime.sql` пересажу cron `send_review_request` с `0 */6 * * *` на `* * * * *` (`1903d9f`). Anti-dup по visit_id уже был в send-review-request — учащение cron безопасно. i18n обновлён под новый сценарий.

### TASK-54: Конкуренты — Цены (4 cols) + AI-матчинг услуг + ИИ-вывод ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** L
**AC:**

- Подвкладка Цены: 4 колонки — Услуга / Наша цена / Диапазон конкурентов / Средний чек / % разница
- competitor-sync теперь тянет полный catalog через `customer_api/businesses/{id}` (services с variants + staff_ids) вместо `__NEXT_DATA__` HTML scrape
- AI-матчинг названий услуг (Claude понимает что «маникюр» ↔ «маникюр с гель-лаком» — одна услуга), кеш в localStorage
- Fallback на Jaccard fuzzy-match если AI ещё не дёргали
- AI-инсайты «Сгенерировать ИИ-вывод» — Claude получает наши цены vs конкурентов, даёт pricing-рекомендации

**Что в проде:** `competitor-sync` edge function расширена `fetchBooksyCatalog` (`520197c`). `ai-report-insights` edge function — новые kinds `service_match`, `competitors_prices` (`520197c`). UI `PricesTable` + `useServiceMatchAi` hook. i18n.

### TASK-55: Конкуренты — Загруженность через Booksy draft+timeslots ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** L
**AC:**

- Подвкладка Загруженность: 6 колонок — Конкурент / Услуга / Мастеров / Слотов 7d / Дней с окнами / % vs средний
- `fetchBooksyOccupancy`: для top-5 variants создаёт draft (POST `/drafts/create`) → tяганет timeslots (POST `/drafts/{id}/timeslots`) на 7 дней
- Throttle 200ms между запросами чтобы не словить rate-limit Booksy
- AI-инсайт по загруженности (kind=`competitors_occupancy` — отдельный промт с интерпретацией underloaded/booked-solid)

**Что в проде:** `competitor-sync.fetchBooksyOccupancy` + snapshot kind='occupancy' (`bc13ea3`). `ai-report-insights` kind=`competitors_occupancy` (`6f2260d`). UI `OccupancyTable` в `CompetitorsTab.tsx`.

### TASK-56: Конкуренты — Рейтинг + Контент полная переработка + AI ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:**

- Рейтинг: 4 колонки Booksy+Google × (Рейтинг + Кол-во отзывов) + глазок-link
- Контент: 5 колонок — Постов / Просмотры рилсов / Частота / Подписчики / Подписки
- Booksy aggregate rating через `customer_api` (не зависит от `__NEXT_DATA__`)
- Reels/post metrics через `messenger_integrations` (Instagram OAuth)
- `resolveGooglePlaceId(name, city)` через Places Text Search — для конкурентов добавленных URL без place_id (точность ↑ передачей города)
- UI хинт «Google API лимит 5 отзывов на место» под таблицей рейтинга
- AI-вывод для каждой подвкладки (kind=`competitors_rating`, `competitors_content`)

**Что в проде:** `competitor-sync` ext. `fetchBooksyAggregate` + `fetchBooksyCatalog`. RatingTable, ContentTable в `CompetitorsTab.tsx`. `resolveGooglePlaceId` (`7ebf058`, `809abd5`). i18n `google_reviews_limit_hint` (RU/EN/PL).

### TASK-57: Конкуренты — Параметры UX-overhaul ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:**

- Блок «Подключения для анализа» наверху с 4 карточками Google/Booksy/Instagram/Facebook со статусом ✓/× и ссылкой на нужный экран
- Tag-picker для «Какие услуги мониторить» (max 3, chips + autocomplete dropdown из услуг салона, Enter — добавить custom)
- Inline-редактирование конкурента (карандаш → форма с name + 4 URL)
- Удалён отдельный блок «Автоподбор» и кнопка «Синхронизировать сейчас»
- «Запустить автоподбор» перенесён в шапку блока «Добавить конкурента»
- Auto-sync при открытии любой data-вкладки (Цены/Загруженность/Рейтинг/Контент), throttle 3 минуты через localStorage, status bar внизу, abort при unmount

**Что в проде:** `ParamsSection` в `CompetitorsTab.tsx`. `CompetitorsSyncStatusBar`. Hook `useUpdateCompetitor`. i18n.

### TASK-58: Marketing — Compose рассылку (полный flow) ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** XL
**AC:**

- 6 готовых шаблонов (Акция -20% / День рождения / Возвращайся / Новая услуга / Сезонная распродажа / Праздничная акция) с inline-HTML email и SMS-текстами на RU/EN/PL
- Rich-text email editor (TipTap WYSIWYG: H1/H2/H3, B/I/U, списки, ссылки, картинка через Supabase Storage, YouTube)
- Сегментация: All / New / Regular / Dormant / По тегу (выпадающий список тегов) / **Вручную** (модалка с клиентами + LTV/визитов/лояльность + чекбоксы)
- BroadcastSegment расширен типом `{ client_ids: string[] }` в `marketing-send-broadcast`
- Тестовое SMS в `Settings → Интеграции → SMS` (отдельный блок), reuse `marketing-test-send`
- InfoDialog для kind=marketing — кнопка «Запустить рассылку» → переключает на compose-вкладку
- InfoDialog для kind=visit_reminder — гиперссылка на Услуги → категория → Периодичность через `<Trans>` + `<servicesLink>`
- Тег рассылки — выпадающий список с unique tags клиентов салона

**Что в проде:** `ComposeBroadcastTab.tsx` (rich-text + templates + manual picker + tag select). `broadcast-templates.ts` (RU/EN/PL). `marketing-send-broadcast` поддержка `{ client_ids }`. `SmsTestSendBlock` в `SmsSection.tsx`. `MarketingPage.tsx` InfoDialog refactor (`6f2260d`, `177537f`).

### TASK-59: Скидка на расчёте визита ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:**

- ChargeView: блок «Скидка» между «К оплате» и «Чаевые» с 3 режимами: Без / Процент / Сумма
- Если скидка > 0 — обязательное поле «Причина скидки» с валидацией
- «К оплате» = grossTotal − discount + tip; под суммой подпись `150 zł − 15 zł + 10 zł`
- Скидка/чаевые распределяются пропорционально по линиям visit (для multi-line визитов)

**Что в проде:** Миграция `20260522000008_visit_discount_reason.sql` (поле `visits.discount_reason text` nullable). UI `ChargeView` в `VisitDetailModal.tsx` (`dc41300`). i18n RU/EN/PL.

### TASK-60: Скрипты администратора с подстановкой переменных визита ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** S
**AC:**

- NextVisitPromptView (после расчёта) и ObjectionsScriptView: вместо `[конкретная дата]` / `[мастеру]` / `[услуга]` / `[другой мастер]` / `[время]` — реальные значения визита
- Подстановки выделены жирным чёрным шрифтом через `**value**` маркер + `renderWithBold` парсер
- `[конкретная дата]` = visit.visit_at + 21 день (отформатировано через date-fns с локалью)

**Что в проде:** `VisitDetailModal.tsx` (`57271cd`). i18n RU/EN/PL с `{{date}}`/`{{master}}`/`{{service}}`/`{{otherMaster}}`/`{{duration}}` interpolation.

### TASK-61: Compact UX-полиш (доп.продажи, receipt, dialogs) ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** M
**AC:**

- Доп.продажи в визите — компактный inline-layout как у Услуг (qty/price/master в одной строке, flex-wrap на mobile)
- Receipt дата не залезает под крестик закрытия модалки (pr-12 + whitespace-nowrap)
- TestSendDialog: контент-div получил padding, footer с border-t, убран дублирующий DialogClose
- InfoDialog (marketing kinds) — padding контента + удалён дубль DialogClose

**Что в проде:** `QuickEntryModal.tsx` (`543b8c9`, `a699f45`). `VisitReceiptModal.tsx` (`8926ee4`). `MarketingPage.tsx`.

### TASK-62: Banking auto-sync свежих connections ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** S
**AC:** После OAuth-возврата из банка connections с `status='connected' && last_synced_at IS NULL` автоматически синхронизируются с UI без ручного клика на RefreshCw. One-shot per session per connection_id.

**Что в проде:** `BankingSection.tsx` useEffect + autoSyncedRef Set (`5e1fb57`).

### TASK-63: Settings + Integrations cleanup ✅ DONE (22 мая 2026)

**Стадия:** 5 · **Оценка:** S
**AC:**

- Объединение «Соцсети» + «Мессенджеры» в одну вкладку (SocialSection удалён, messengers переименован в «Соцсети» / «Social» / «Sieci społecznościowe»)
- Settings → Профиль → поиск салона в Google Maps вместо ручного Place ID (через GooglePlaceSearchInput)
- SubscriptionBanner не мигает на загрузке (isLoading guard — не показывать пока useSubscription грузится)
- i18n ключи `competitors.col_*` / `ai_*` / `sync_status_bar` перенесены из `params.{}` в `competitors.{}` (1 уровень выше) — раньше отображались как литералы
- `--brand-sage-deep` CSS-токен добавлен в светлую и тёмную тему + зарегистрирован в `tailwind.config.sage.deep` (раньше класс игнорировался → невидимый текст)

**Что в проде:** `IntegrationsPage.tsx` (`f6afb3f`). `SubscriptionBanner.tsx` (`1e04b4a`). i18n keys move (`1e04b4a`). `globals.css` + `tailwind.config.ts` (`7ebf058`).

### Инфра-задачи (требуют участия владельца)

- [ ] Деплой edge functions: `pnpm supabase functions deploy reviews-sync competitor-sync competitor-discover send-review-request client-overdue-push`
- [ ] Применить миграции 16-20 на проде
- [ ] ENV на Supabase: `GOOGLE_PLACES_API_KEY`, `REVIEW_REQUEST_CRON_SECRET`, `CLIENT_OVERDUE_CRON_SECRET`, `REVIEWS_SYNC_CRON_SECRET`, `COMPETITOR_SYNC_CRON_SECRET`, опц. `SMS_PROVIDER`/`SMS_API_KEY`/`SMS_FROM`
- [ ] `ALTER DATABASE ... SET app.*` для pg_cron jobs
- [ ] Заполнить Settings → Профиль → «Адрес и публичные ссылки» у тестового салона

---

## Definition of Done (для каждой задачи)

- [ ] Код написан и работает локально
- [ ] Все AC выполнены
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` зелёные
- [ ] Скриншоты UI приложены к коммиту/PR
- [ ] Миграции БД на staging проверены
- [ ] ADR создан, если был
- [ ] CLAUDE.md обновлён, если изменились соглашения
- [ ] Деплой через PR (на main = автодеплой)

## Что делать, если задача больше, чем кажется

Если, начав задачу, видишь что она XL и не описана детально — **остановись и разбей**. Добавь новые TASK-NN, обнови зависимости, обсуди с владельцем.
