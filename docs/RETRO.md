# Ретро

> Открытый журнал — что прошло хорошо/плохо, что узнали, какие ADR появились.
> Пишется в конце каждой стадии (~1 неделя).

---

## Стадия 1 — Фундамент · 6 мая 2026

**Релиз:** закрытая бета для 5–10 знакомых владелиц.
**Цель стадии:** доказать, что можно ввести данные и увидеть прибыль.

### Что сделано (TASK-01..TASK-19)

**Sprint 0 — Подготовка**

- TASK-00 — документация прочитана и приведена в соответствие (Tailwind 3.4, ADR-ссылки починены, format issues почищены, мусорная папка `apps/web/src/{components` удалена).
- TASK-01 — чек-лист аккаунтов и env составлен; `.env.example` — единый источник правды.
- TASK-02 / TASK-02b — Vite-monorepo, GitHub Pages workflow, SPA-fallback `404.html`, supabase CLI как workspace devDep.

**Стадия 1 — Фундамент**

- TASK-03 — 11 SQL-миграций применены на staging Supabase. Поймали и пофиксили в процессе:
  - Пропущенный FK `salon_members.staff_id → staff.id` (ADR-008 выявил спецификацией DATA_MODEL.md)
  - Infinite recursion в RLS-политике на `salon_members` (security definer функция как разрыватель цикла)
  - Дефолтные привилегии для `anon/authenticated/service_role` отсутствовали — каждый PostgREST-запрос падал с permission denied. Добавили миграцией 011.
  - 5/5 RLS-тестов проходят на реальном staging.
- TASK-04..07 — Auth: Supabase client, AuthProvider/useAuth, страницы login/signup/forgot/reset/callback, Google OAuth кнопка, Telegram Login widget + edge function `telegram-auth` (HMAC-SHA256 валидация по спеке).
- TASK-08 / TASK-08b — онбординг 5 шагов (Салон/Мастера/Услуги/Расходы/Готово) через RPC `create_salon_with_setup` (security definer, всё атомарно в одной транзакции). ComingSoon-заглушки для будущих секций.
- TASK-09 — SalonLayout: 8-пунктный sidebar, TopBar с PeriodToggle/salon switcher, mobile drawer + bottom-nav 5 пунктов + FAB, RequireSalonMembership guard.
- TASK-10..14 — ядро продукта:
  - QuickEntryModal с жёлтым mono-инпутом суммы, payment pills, optimistic insert, toast «Откатить»
  - VisitsPage с группировкой по дням, фильтрами в URL
  - StaffPage: CRUD мастеров с архивированием
  - ExpensesPage: 4 summary-карточки, список + структура progress bars, форма расхода
  - DashboardPage: KPI-карточки с большой navy-прибылью, master bars, payment donut (нативный SVG, без recharts), top-5 услуг, recent visits таблица. Empty state, skeletons.
- TASK-15 — i18n полностью выверен, LocaleSwitcher (только RU в стадии 1, готов к расширению).
- TASK-16 — Stripe edge functions (`create-checkout-session`, `create-portal-session`, `stripe-webhook` с HMAC-валидацией и идемпотентностью через таблицу `stripe_webhook_events`). UI-кнопки в Settings + SubscriptionBanner для read-only режима истёкшей подписки.
- TASK-17 — Astro лендинг (`/`, `/pricing`, `/privacy`, `/terms`) с фирменной палитрой. CI workflow мерджит landing в корень gh-pages, SPA в `/app/` с `VITE_BASE`.
- TASK-18 — Settings → профиль салона: имя/страна/тип/логотип, secure delete с typing-confirmation, billing-секция, экспорт (placeholder).
- TASK-19 — Postmark `send-email` edge function (template alias-driven). Шаблоны самих писем создаст владелец в Postmark Dashboard.

### Метрики качества на конец Стадии 1

- `pnpm typecheck` — зелёный
- `pnpm lint` — зелёный (max-warnings 0)
- `pnpm format:check` — зелёный
- `pnpm build` — собирается (бандл `~145 KB gzip` core + `53 KB supabase chunk`)
- `pnpm test` — 10/10 unit + RLS на staging
- `pnpm test:e2e` — **7/7** Playwright тестов:
  - smoke (2)
  - auth UI (3)
  - onboarding flow (1) — full 5 steps + redirect
  - visit-flow (1) — FAB → Quick Entry → KPI обновление → строка в /visits

### Что прошло хорошо

1. **Hi-fi прототип владельца как north star.** Решение зафиксировать токены палитры/типографики из `Design/` через ADR-007 в TAILWIND-конфиг + globals.css сэкономило десятки часов на «дизайнерских» решениях. Каждая страница готовится заметно быстрее, когда «куда смотреть» уже определено.
2. **TanStack Query + RPC для бизнес-данных.** Optimistic updates в QuickEntryModal и сквозная инвалидация `['dashboard', salonId]` при visit/expense мутациях — UX «как из коробки» без ручного дёргания.
3. **Раннее переписывание `BACKLOG.md` под прототип.** Вложили в это полдня после получения Hi-fi прототипа — но дальше каждая TASK имела чёткие AC, и вопросов «как должно выглядеть» больше не возникало.
4. **Тесты RLS на реальном staging.** Поймали 3 настоящих SQL-бага (отсутствие FK, recursion в policies, missing default privileges) до того, как UI пошёл в эти таблицы.
5. **Edge functions выделены аккуратно.** Все 4 функции (`telegram-auth`, `create-checkout-session`, `create-portal-session`, `stripe-webhook`, `send-email`) используют общий `_shared/` каталог (cors, auth, stripe), нет дублирования.

### Что не сделано / отложено

- **Реальная оплата через Stripe** — код функций готов, но требует от владельца:
  - Создать Stripe Product + Price в Dashboard, добавить `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` в Supabase secrets.
  - Включить Stripe Tax в Dashboard, привязать tax-jurisdictions для PL/EU.
  - Зарегистрировать webhook URL `https://<project>.supabase.co/functions/v1/stripe-webhook` в Stripe Dashboard.
- **Реальные email-уведомления** — функция готова, но требует:
  - Создать Postmark Server, активировать sender signature на `hello@finkley.eu` (DKIM/SPF/DMARC в DNS).
  - Создать 5 шаблонов в Postmark Dashboard (`welcome`, `trial_ending`, `payment_succeeded`, `payment_failed`, `subscription_canceled`).
  - Добавить `POSTMARK_SERVER_TOKEN` в Supabase secrets.
  - Hook вызова `welcome` после signup пока не подключён — добавим вместе с настройкой Postmark.
- **Trial-ending scheduled job (TASK-19 второй пункт)** — pg_cron уже включён (миграция 000008), но реальный cron `select cron.schedule(...)` не зарегистрирован. Добавим вместе с интеграцией Postmark.
- **Деплой edge functions в staging** — упирается в 502/503 от Supabase Functions API (повторяющийся сбой со стороны Supabase). На первом git push в main CI workflow (`deploy-supabase.yml`) развернёт автоматически.
- **Docker-окружение для локального Supabase** — отсутствует на машине, всю стадию 1 разработка велась против реального staging. Это OK, пока RLS-тесты идут.
- **Юр.документы Privacy/Terms** — рабочие шаблоны на лендинге, помечены как «требуют ревью юристом» (заглушки `[Юрлицо PL]` / `[NIP]` / `[адрес]`).
- **Booksy / OCR / Клиенты / Отчёты / AI** — всё стадии 2–4, на дашборде стоят `<ComingSoon>`-заглушки.

### Узнали нового

- **Supabase email validation строгая.** `@finkley.test`, `@example.com` отклоняются как «invalid» — у GoTrue свой allowlist по MX-записям. В E2E теперь создаём юзеров через admin API, который не валидирует. Для signup-формы — реальный домен (требуется Postmark).
- **Default privileges на `public` схему могут отсутствовать.** На свежем Supabase staging проекте authenticated/service_role не имели `SELECT/INSERT/...` — пришлось явно гранитировать миграцией. Это нестандартное состояние, но мы теперь сами заводим default privileges для будущих таблиц.
- **GoTrueClient в JSDOM делит storage между инстансами** — тесты RLS падали с warning. Решение — `persistSession: false` + уникальный `storageKey` на каждый клиент.
- **Stripe Customer Portal требует enable в Dashboard.** Без этого `create_portal_session` вернёт 400 даже при правильном customer_id. Документировали в TASK-19 RETRO ↑.
- **`prettier --write` без `--ignore-path` использует только `.prettierignore`** (default), а наш `format:check` форсил `.gitignore`. Несовпадение приводило к флапающему CI. Унифицировали — теперь оба читают `.prettierignore`.
- **`payment-donut` на нативном SVG vs recharts.** Нативная версия экономит ~80KB и достаточно гибкая для одного донта. Recharts оставлен на TASK-23 (день-чарт по выручке).

### Новые ADR за стадию

- **ADR-002** уже был — `Pragmatic Privacy вместо E2EE` (фиксирован до стадии 1).
- **ADR-007** — `Дизайн-система: токены и Hi-fi прототип`. Источник истины — `Design/`, шрифты Plus Jakarta Sans + Inter + JetBrains Mono, скейл радиусов и теней из прототипа, маппинг shadcn-aliases на Finkley-палитру.
- **(не оформлен как ADR, но фиксирован в коде)** — onboarding через RPC `create_salon_with_setup`, а не отдельный edge function. RPC проще тестируется и атомарен по транзакции.

### Открытые вопросы / технический долг

1. **Дрифт `insights` schema vs DATA_MODEL.md.** Миграция 000006 использует `kind/body/payload`, документ — `insight_type/description/metadata`. Не блокирует стадию 1, но при подходе к TASK-33 (стадия 4) надо синхронизировать миграцией или обновлением документа.
2. **CI деплой Supabase идёт сразу в prod.** `deploy-supabase.yml` использует только `SUPABASE_PROD_PROJECT_REF`. Перед публичным запуском надо расширить до двухстадийного pipeline (staging → manual approval → prod).
3. **Логотип в Settings — простой URL-инпут**, не загрузка из галереи. Добавим upload в Storage в TASK-23 / при первом фидбеке.
4. **Telegram-auth function ни разу не задеплоилась** (502 от Supabase). Деплой через CI на первом git push.
5. **AI-карточка на ExpensesPage** — поле зарезервировано, скрыта до TASK-33. Когда дойдём — рендерим только если есть подходящий insight.
6. **Bundle size index chunk → 489 KB minified / 145 KB gzip.** Это много. На стадии 2 пройдёмся code-splitting через `React.lazy` для каждой большой страницы (особенно DashboardPage и ExpensesPage).

### Следующее (Стадия 2)

См. TASK-20..26 в `docs/04_BACKLOG.md`. Планируем:

- TASK-20 — клиенты салона (CRUD + history)
- TASK-21..22 — расширенный payout_scheme + payouts/ведомость
- TASK-23 — аналитика и отчёты (P&L, день-чарт, heatmap)
- TASK-24 — групповой ввод визитов, чаевые, скидки
- TASK-25 — фото чека (Storage), повторяющиеся расходы, бюджет vs факт
- TASK-26 — экспорт данных (CSV + PDF) для GDPR-доступа

Перед стартом стадии 2 — фидбек от 5–10 бета-тестеров. Возможно, перетасуем приоритет (например, если «не могу найти повторяющиеся расходы» окажется частой жалобой → TASK-25 раньше TASK-20).
