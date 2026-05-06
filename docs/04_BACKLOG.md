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
- [ ] Домен куплен (`finkley.eu` или альтернатива), CNAME настроен на `username.github.io`
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
          cname: finkley.eu
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
- [ ] Деплой на тот же GitHub Pages (например, `landing.finkley.eu` через CNAME поддомен) или интегрировано на `/` основного домена
- [ ] Plausible script
- [ ] Mobile-адаптация
- [ ] Все на RU
- [ ] CTA "Начать бесплатно" → `app.finkley.eu/signup` (или `/signup` на главном домене если общий)

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

### TASK-20: Реестр клиентов

**Стадия:** 2 · **Оценка:** L
**AC:** CRUD клиента, список с поиском/фильтрами, drawer с историей визитов, привязка визитов через typeahead, денормализованные счётчики.

### TASK-21: Расширенные схемы оплаты мастерам

**Стадия:** 2 · **Оценка:** L
**AC:** UI выбора `payout_scheme`, поля для `fixed`/`percent_revenue`/`percent_service`/`chair_rent`/`mixed`, `staff_service_overrides`.

### TASK-22: Расчёт зарплат и ведомость

**Стадия:** 2 · **Оценка:** L · **Зависит от:** TASK-21
**AC:** Страница payouts, авторасчёт через RPC `calculate_payout(staff_id, period_start, period_end)`, ведомость PDF, закрытие периода с auto-expense.

### TASK-23: Аналитика и отчёты

**Стадия:** 2 · **Оценка:** XL
**AC:** P&L отчёт, выручка по мастерам/услугам, типу оплаты, загрузка по дням/часам (heatmap), маржа по услугам, сравнение периодов, экспорт PDF/Excel.

### TASK-24: Группированный ввод и доп.поля визита

**Стадия:** 2 · **Оценка:** M
**AC:** Multi-row форма, чаевые, скидки, повторяющиеся шаблоны.

### TASK-25: Расходы — расширения

**Стадия:** 2 · **Оценка:** M
**AC:** Фото чека (Storage), повторяющиеся расходы, бюджет vs факт, остаток нала в кассе.

### TASK-26: Экспорт данных (GDPR)

**Стадия:** 2 · **Оценка:** M
**AC:** Edge function generate-export → ZIP с CSV всех таблиц + PDF summary, signed URL TTL 24h, email со ссылкой.

---

## Стадия 3 — Интеграции

### TASK-27: Booksy — research спайк

**Стадия:** 3 · **Оценка:** M
**AC:** Изучить рабочий паттерн прокси-логина владельца с sasovsky. Применить к Booksy. Решение зафиксировать в ADR `decisions/005-booksy-integration-strategy.md`. Если паттерн владельца не работает на Booksy (JS-rendering + hCaptcha) — план Б. До решения этой задачи остальные TASK-28..30 заблокированы.

### TASK-28: Booksy интеграция UI

**Стадия:** 3 · **Оценка:** L · **Зависит от:** TASK-27
**AC:** `/{salonId}/integrations/booksy` форма, спиннер логина, статус, кнопка отключить.

### TASK-29: Booksy синк визитов

**Стадия:** 3 · **Оценка:** L · **Зависит от:** TASK-28
**AC:** Edge function `booksy-sync` по cron каждые 30 мин, маппинг bookings + POS в visits, идемпотентный upsert, логирование в `integration_sync_logs`, refresh токена при 401, нотификация при 3 сбоях подряд.

### TASK-30: OCR расходов

**Стадия:** 3 · **Оценка:** L
**AC:** Кнопка "📷 Чек" в форме, upload в Storage, edge function `ocr-receipt` через Anthropic Claude Haiku 4.5, JSON парсинг, confirm-карточка, fallback Groq Llama Vision.

### TASK-31: wFirma (PL only)

**Стадия:** 3 · **Оценка:** XL
**AC:** UI подключения (accessKey/secretKey), синк закупочных фактур, отправка expense в wFirma, KSeF, отображается только для country_code=PL.

### TASK-32: CSV-импорт

**Стадия:** 3 · **Оценка:** M
**AC:** Upload CSV, парсинг, маппинг колонок, шаблоны для Booksy/Fresha/Treatwell, batch insert, дедуп.

---

## Стадия 4 — Рост

### TASK-33: AI-инсайты (rules-based + LLM polish)

**Стадия:** 4 · **Оценка:** XL
**AC:** Edge function `generate-insights` weekly cron, простые правила (убыточная услуга, низкая загрузка мастера, аномалия), запись в `insights`, виджет на дашборде. LLM-polish через Claude Haiku — формулировка естественным RU.

### TASK-34: Weekly digest email

**Стадия:** 4 · **Оценка:** M · **Зависит от:** TASK-33
**AC:** Cron понедельник 9:00, 3 главные цифры + 1 инсайт, opt-out в settings.

### TASK-35: PWA + push-уведомления

**Стадия:** 4 · **Оценка:** L
**AC:** manifest.json, service worker, иконки, "добавить на главный экран", Web Push API, подписка в settings.

### TASK-36: Бенчмарки

**Стадия:** 4 · **Оценка:** XL
**AC:** Edge function пересчитывает агрегаты раз в сутки в `benchmark_aggregates` (страна, тип, средний чек, оборот), k-anonymity N≥10, виджет на дашборде, opt-in при регистрации.

---

## Стадия 5 — Масштаб

(детализируем после первых 100 платящих)

- TASK-37: Роли и права (admin/staff/accountant)
- TASK-38: Приглашения по email
- TASK-39: Audit log
- TASK-40: 2FA
- TASK-41: API-ключи
- TASK-42: Реферальная программа
- TASK-43: Multilingual: PL и EN

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
