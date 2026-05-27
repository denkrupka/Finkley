# Ретро

> Открытый журнал — что прошло хорошо/плохо, что узнали, какие ADR появились.
> Пишется в конце каждой стадии (~1 неделя).

---

## Batch 7 — Финансы / Уведомления / Permissions / UI Tours · 27-28 мая 2026

**Релиз:** один большой merge в `main`, успешно задеплоен в прод
(коммиты `330c95f` → `1b6bff0` → `6c6d253` → `b712ccf`). 51 задача (T1–T51)
за ~36 часов работы в несколько сессий. Тесты: 386 → 425 (+39).

### Что сделано

**Финансы / P&L (T1–T7):**

- Кнопка fullscreen в P&L — только иконка + растягивается на весь viewport.
- Year-selector → универсальный PeriodPickerPopover с динамическими колонками
  месяцев (buildMonthCols + useRegisterBalancesAtMonthEnds).
- Системная касса «Корректировки» (preset_key='adjustments'), скрытая везде
  кроме CashTransferModal / TransfersTab. Строка «Корректировки» над
  «Сальдо за период» с балансом.

**Дашборд (T8):**

- Полный rewrite по образцу `finsalon_dashboard.html`: 5 KPI карточек +
  секции Клиенты/Мастера / Расходы/Финансы / Операции / Маркетинг RFM.
- LowStock и Insights обёрнуты в CollapsibleSection с localStorage.

**Методы оплаты + авто-комиссии (T9–T15, T34):**

- SQL миграции: `payment_methods.cash_register_id` + `commission_pct`,
  системная категория «Комиссии», DB-triggers auto-commission на
  visits/other_incomes (paid → auto-expense).
- UI вкладка «Методы оплаты», CommissionsPin + CommissionsModal с
  in-place модалками источников (T31).
- Метод оплаты вместо «Касса» в модалках визита и прочего дохода.

**Permissions matrix (T26, T30, T35, T36):**

- SQL: `salon_members.permissions jsonb` + `accept_salon_invitation` копирует
  из invitation. PermissionsBlock с роль-пресетами.
- `usePermissions` hook + защита роутов через RequirePermission, Sidebar
  фильтрует пункты nav по can(category, 'view').

**Уведомления / multi-channel (T22–T23, T37–T44, T48):**

- Edge Function `send-notification` + `dispatchNotification()` helper.
- 11 типов × 3 канала (email/Telegram/SMS) × 3 языка (ru/pl/en) в
  `notify-templates.ts`. Twilio для SMS, Resend для email.
- Per-channel prefs `notification_prefs[type.channel]` + UI матрица в
  /settings/notifications → Типы.
- In-app realtime через postgres_changes + sonner-toast (T42).
- Bell с unread badge + drawer + mark-as-read (T43).
- Полная страница `/notifications` с фильтрами + пагинацией (T44).
- Подключено в cron: daily-notifications, payment-reminders,
  generate-insights, booksy-proxy, messenger-{meta,telegram}-webhook.

**UI Tours (T45–T48):**

- OnboardingTour: spotlight overlay (4 div'а + ring) вокруг `data-tour`
  элементов, per-role фильтр (staff видит 5 шагов, owner — 9).
- PageTour универсальный + 3 per-page тура (/expenses, /finance, /inventory).
- Секция «Гиды и обучение» в /help со всеми 4 турами.
- Auto-tour для приглашённого мастера после `InviteSignupForm.onComplete`.

**Профиль и онбординг (T25, T27, T33):**

- UserProfileCard в /settings/profile (имя, фамилия, телефон, email
  read-only, аватар, пароль). Все блоки в profile-tab сворачиваемые с
  localStorage (default свёрнуты).
- InviteSignupForm — форма регистрации приглашённого мастера.
- Из инвайт-модалки удалены поля Фото/Имя/Фамилия/Телефон (заполняет сам).

**Banking + display фиксы (T20, T21, T29, T32):**

- Убрана кнопка «Извлечь контрагентов» — автозапуск после sync (silent).
- Счётчик несвязанных tx на табе «Банкинг».
- `formatExpenseDate` конвертирует UTC timestamp в локальную дату (фикс
  «30.04 → 1.05» в Bank Millennium листинге).
- banking-sync: детальное логирование + минимум 30-дневное окно (фикс
  Bank Millennium quirk с lazy-booked tx).

**UI / общие (T18, T19, T24, T28, T33):**

- Список визитов открывает QuickEntryModal (как Календарь).
- Календарь визитов: `minmax(COL_WIDTH, 1fr)` — колонки растягиваются на
  всю ширину при скрытых мастерах.
- Sidebar: кнопка сворачивания наверх возле логотипа (ChevronsLeft/Right).
- `common.back_home` i18n ключ ru/en/pl.

**Тесты (T49, T51):**

- 19 unit-тестов для `permissions-logic.ts` (выделена pure-логика из
  `usePermissions.ts`).
- 20 unit-тестов для `notify-templates.ts` (шаблоны email/TG/SMS во всех 3
  локалях + HTML-escape от инъекций).
- vitest include расширен на `supabase/functions/_shared/**/*.test.ts`.

**Observability (T41, T50):**

- `withSentry` обвязка для send-notification, daily-notifications,
  payment-reminders, generate-insights — все 4 cron'а ловят unhandled
  exceptions с тегом `fn=<name>`.

### Что хорошо

- **Большой batch один-commit-один-changelog** оказался лучше чем серия
  мелких commit'ов: меньше шансов рассинхронить промежуточные состояния,
  всё или ничего на проде.
- **Pure-логика отдельно от хука** (permissions-logic vs usePermissions)
  — тестировать стало тривиально, и unit-тесты ловят регрессии не
  трогая React-render.
- **Spotlight overlay без зависимостей** (4 div'а вместо react-joyride)
  — экономия ~50 KB bundle + полный контроль над z-index/styling.
- **Pre-commit hook (prettier+lint) автокоммитит форматирование** —
  никаких отдельных `style:` commit'ов после merge.

### Что плохо / уроки

- **Польские типографские кавычки `„text"` ломают JSON** — закрывающая
  `"` парсилась как конец строки. Регэксп `„([^„"\n]+)"` → `„$1”`
  починил. Урок: для не-ASCII кавычек в JSON всегда использовать `”`
  (U+201D) явно или escape `\"`.
- **3 deploy подряд = 3×(staging+prod) очередь** — каждый push занимает
  ~15-25 минут на Edge Functions × 50. На большие пакеты лучше один commit.
- **i18n notif.\* defaultValue inline в TSX** — пришлось дублировать
  словарь в `useNotifications` (toast), `NotificationsBell` (popover),
  `NotificationsPage` (полный список). При локализации en/pl всё
  нашлось через grep, но в идеале — общая утилита `describeNotification(type, payload, t)`.

### Известные хвосты (не критичные)

- В Sidebar/TopBar данные derive (insights/budgets/messenger) считают
  unread по `lastSeen` localStorage; in_app считает по `read_at` jsonb.
  Можно унифицировать в одну таблицу.
- Тесты для `useRealtimeNotifications` хук + `tour-internals` хелперы.
- Локализация email-шаблонов welcome/trial_ending — `send-email`
  использует свой `templates.ts`, не интегрирован с `notify-templates.ts`.

### Новые ADR

— (ни одного: все изменения укладывались в существующие архитектурные
решения. Расширение `payment_methods` колонками `cash_register_id` +
`commission_pct` — пограничный случай, но решение симметрично уже
существующему `cash_registers.payment_method_mapping` legacy-полю.)

---

## Стадия 3 — Messenger Phase 3 · 19 мая 2026

**Релиз:** прод-патч поверх ADR-015 (TG userbot).

### Что сделано

- **Bug-fix отправки фото из портала** (`new row violates RLS`): SPA-юзер не
  имел INSERT policy в bucket `tg-media`. Добавили
  `tg_media_insert_own_upload` (path `upload/<sid>/...` + owner check) +
  расширенный SELECT (worker-загруженные `<sid>/<msg>.ext` И SPA `upload/...`).
  Миграция 20260519130000.
- **Аватарки TG** (вместо инициалов): worker качает `client.download_profile_photo`
  для своего профиля + всех диалогов → `tg-media/<sid>/avatars/`. Catch-up
  task для существующих сессий (50 диалогов с паузой 0.4с) — без re-bootstrap'а.
  SPA подписывает batch-ом через `createSignedUrls` (1 запрос на 50 path'ов,
  кэш 50 мин в памяти).
- **Lazy media + TTL 5 мин** ([ADR-016](../decisions/016-tg-userbot-lazy-media.md)):
  worker НЕ качает медиа в `_persist_message`. Открытие чата → SPA upsert
  `tg_dialog_views.last_opened_at` + heartbeat 60s + outbox `download_media`
  для видимых медиа. `_cleanup_loop` каждую минуту удаляет файлы где
  `max(last_opened_at, last_closed_at) > 5 мин` (аватарки исключены).
- **Phase 3** (реакции, видео, голосовые, поиск):
  - `events.Raw(UpdateMessageReactions)` handler + outbox `react` через
    `SendReactionRequest`. Picker 👍❤🔥😁😢 под сообщением, отображение
    чужих с count.
  - Новые actions: `send_video`, `send_voice`, `send_document`. SPA сама
    детектит по mime, заливает в `upload/...`, после отправки worker
    удаляет upload-файл (не дожидаясь TTL).
  - Voice-запись в браузере через `MediaRecorder` (opus/webm).
  - Inline `<video>`/`<audio>` плееры в чате.
  - Поиск в открытом чате (pg_trgm индекс + ILIKE на клиенте).
- **Мобильная адаптация** мессенджера: single-pane navigation как
  Telegram/WhatsApp, back-кнопка, иконочный header, поиск раскрывается
  по иконке.

### Метрики качества на конец сессии

- `pnpm typecheck` — зелёный
- `pnpm lint` — зелёный (max-warnings 0)
- `pnpm build` — собирается
- `pnpm test` — 72 passed / 1 skipped
- Worker на VM: `systemctl active`, 0 exceptions за наблюдаемый период
- Все 50 аватарок sender'а скачаны в bucket

### Узнали нового

- В Telethon реакции не дают высокоуровневого события — нужен
  `events.Raw(types=(UpdateMessageReactions, UpdateBotMessageReactions))`.
- `client.send_file(buf, voice_note=True)` отправляет аудио как «голосовое»
  с временной шкалой. Без флага — обычный документ.
- Supabase `createSignedUrls` (множественное число) принимает массив
  путей и возвращает `[{path, signedUrl, error}]` — один HTTP вместо N.
  Существенно для списков (50 аватарок = 1 запрос вместо 50).
- `storage.foldername(name)` в RLS-policy возвращает массив папок:
  `upload/abc/xyz.jpg` → `[upload, abc]`. Удобно для path-pattern policy.
- Heartbeat-подход к TTL надёжнее единой `expires_at` колонки: пользователь
  может «забить» чат открытым в фоновой вкладке и не терять медиа, пока
  вкладка живая.

### Что мониторим (см. ADR-016)

- Размер `tg-media` bucket — должен оставаться <100 МБ.
- Логи `cleanup loop: removing N stale media files` — должны появляться
  периодически с ненулевыми N.
- `download_media failed` errors — если массово, значит retry не справляется.

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
  - Создать Postmark Server, активировать sender signature на `hello@finkley.app` (DKIM/SPF/DMARC в DNS).
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

---

## Овернайт-сессия · 7 мая 2026

Однопроходная автономная сессия после первого фидбека: владелец передал доверие на ночь, попросил пилить дальше по бэклогу. Дошли до **TASK-20, 24, 25, 26** — фактически закрыли половину Стадии 2.

### Что сделано

**Phase 1 — E2E safety net (10 ms-units zelyonyi):**

- Подняли Playwright (`pnpm dlx playwright install chromium`), `playwright.config.ts` теперь грузит `.env.local` через `dotenv` — иначе все admin-spec'и игнорировались.
- Существующие 7 e2e (smoke, auth UI, onboarding, visit-flow) → 9 (+ expense-flow + billing-flow). Billing-flow стабит вызов `create-checkout-session` через `page.route()` — нет реальных Stripe-сессий.
- Добавлен новый clients-flow → 10 в сумме.
- Поймали и пофиксили pre-existing race в `QuickEntryModal`: `staff_id` оставался пустым, если `useStaff()` ещё не отдал данные к моменту открытия модалки. Добавлен второй useEffect, синхронизирующий выбор по приходу `staff`.

**Phase 2 — TASK-20 Клиенты:**

- Таблица `clients` была в схеме с дня 1 (миграция 4 уже включала триггер `recalc_client_stats` на `visits.INSERT/DELETE`). UI-слой полностью пилили этой ночью.
- `libphonenumber-js` для E.164 нормализации (PL/UA/RU).
- Хуки: `useClients`, `useClient`, `useClientVisits`, `useCreateClient`, `useUpdateClient`, `useDeleteClient` (soft).
- Sheet-компонент (right-anchored Radix Dialog) — наш первый side-drawer.
- `ClientsPage` (поиск по name/phone/email + сортировка last_visit/name/revenue + 3 KPI), `ClientFormModal` (CRUD), `ClientDrawer` (контакты, заметка, история визитов, edit + delete).
- `ClientPicker` combobox в QuickEntryModal — поиск + inline `+ Создать «query»`.
- `nav-config.clients.implemented = true`, удалён `ComingSoon` для clients.
- E2E `clients-flow.spec.ts`: создание → drawer empty → Quick Entry с picker → drawer history populated.

**Phase 3 — TASK-25 Расходы:**

- Миграция 20260507000001: enum `expense_recurrence`, столбцы `next_occurrence_at`, `recurrence_parent_id`, `receipt_url` на `expenses`. Storage bucket `receipts` (private, 10 MB cap, image+pdf only) с RLS scoped по first-folder.
- В форме расхода — file picker (paperclip drop-zone) + Select повторений. В списке — иконка скрепки рядом с расходом, клик открывает превью через signed URL (img или iframe для PDF). Иконка `Repeat` для повторяющихся.
- `useExpenses`: `uploadReceipt`, `getReceiptSignedUrl` хелперы. `CreateExpenseInput` принимает receipt_url + recurrence + next_occurrence_at.
- Edge function `process-recurring-expenses` (no-verify-jwt + shared secret): идемпотентный, безопасно гонять много раз в день. Регистрация pg_cron расписания отложена в MORNING_TODO (не хочу хардкодить FUNCTION_INTERNAL_SECRET в миграции).

**Phase 4 — TASK-26 GDPR-экспорт:**

- Миграция 20260507000002: таблица `export_requests` + Storage bucket `exports` (private, 100 MB) с RLS по first-folder = user_id.
- Edge function `generate-export` (verify-jwt YES). Через user JWT тянет список салонов (RLS), потом через service-role читает 10 таблиц, собирает CSV, кладёт в `JSZip` (esm.sh), uploadит в Storage как `<user_id>/<request_id>.zip`, возвращает signed URL TTL 24h.
- Rate-limit: если уже есть `done`-экспорт за последние 24h — возвращаем тот же URL без перегенерации.
- Шаблон `gdpr_export` добавлен в send-email/templates.ts.
- В Settings → «Экспорт данных» кнопка теперь по-настоящему работает: open в новой вкладке + tост (different copy для cached vs fresh).

**Phase 5 — TASK-24 Чаевые + скидки:**

- Поля `tip_cents` / `discount_cents` уже существовали в схеме (миграция 4). UI и aggregations не использовали.
- В QuickEntryModal — два side-by-side numeric инпута под основной суммой (`+€ tip`, `−€ discount`). zod refine на не-отрицательность. Reset на «Сохранить и добавить ещё».
- Миграция 20260507000003 переписала 4 RPC: `dashboard_kpis`, `top_staff_by_revenue`, `top_services_by_revenue`, `revenue_by_day`. Revenue теперь = `sum(amount - discount + tip)`.
- Multi-row форма scoped out — текущий «Сохранить и добавить ещё» уже покрывает serial entry; полная grid-форма — отдельная задача с фидбеком от пользователей.

### Метрики качества на конец сессии

- `pnpm typecheck` — зелёный
- `pnpm lint` — зелёный (max-warnings 0)
- `pnpm build` — собирается, bundle index 726 KB (+200 KB) — добавилось libphonenumber-js + Sheet + клиенты. Code-splitting для крупных страниц всё ещё в долгу (TASK для стадии 2 финализации).
- `pnpm test:e2e` — **10/10** Playwright тестов (chromium project): smoke (2), auth UI (3), onboarding, visit-flow, expense-flow, billing-flow, clients-flow.

### Бонус-фиксы по дороге

- `lint-staged` глобал-pattern `*.{ts,tsx}` запускал eslint на root `.ts` файлах, у которых нет конфига — pre-commit падал с «ESLint couldn't find an eslint.config.(js|mjs|cjs) file». Сузили pattern до `apps/web/**/*.{ts,tsx}`, остальные .ts только под prettier.
- `pnpm dlx supabase gen types` иногда добавляет в начало строку «Initialising login role...» и в конец `<claude-code-hint>` — оба раза правил руками; стоит заменить на pinned `pnpm exec` в скрипте.

### Что НЕ взято на ночь и почему

- **TASK-21/22 (payout schemes + ведомость)** — продуктовое решение по тому, какие схемы поддержать в MVP. Лучше с фидбеком от первых бетеров.
- **TASK-23 (полная аналитика P&L + heatmap)** — XL, требует обсуждения какие именно срезы показывать. Базовая агрегация (revenue с tips) сделана как побочный продукт TASK-24.
- **Apple Sign In** — нет аккаунта Apple Developer ($99/год), отложили.
- **Stripe coupon для бетеров** + **юр-доки** — владелец явно сказал отложить (#1 и #2 в утреннем плане).

### Что в долге для утра — см. `MORNING_TODO.md`

Главное:

1. Зарегистрировать pg_cron schedule для `process-recurring-expenses` (нужен `FUNCTION_INTERNAL_SECRET` в database setting).
2. Прокликать руками: фото чека (полный путь — upload + просмотр в новой сессии), GDPR-экспорт (открыть ZIP, проверить CSV), tip/discount в визите → дашборд.
3. Закрыть #1 (Stripe coupon) и #2 (юр-доки) когда будут силы.

---

## Сессия · 8 мая 2026 · Tech-debt sweep + Resend + Dark theme

После закрытия Stage 5 (TASK-37..43) пробежались по техдолгу из категории «B» и
доделали Resend. Картина для прода после сессии:

### Что сделано в этой сессии

**Resend домен `finkley.app`:**

- API key добавлен в `apps/web/.env.local` (gitignored) + плейсхолдер в `.env.example`.
- Через Resend API проверили что домен **уже verified, sending enabled** (DNS записи DKIM/SPF/MX/TXT настроены ранее в Cloudflare).
- Smoke-test письмо доставлено на `deniskrupka001@gmail.com` (id `f2eb3ce2-...`).
- В Supabase staging добавлены `RESEND_API_KEY` + `RESEND_FROM` через Management API.
- Из Supabase prod вычищены legacy `POSTMARK_SERVER_TOKEN` / `POSTMARK_FROM` / `POSTMARK_MESSAGE_STREAM`.
- Email-шаблоны: `Postmark template alias` → `Resend template alias` в HTML-комментариях.
- README `docs/email-templates/README.md` переписан под Resend (раньше был под Postmark).

**B-1 — TASK-12 полный CRUD услуг:** `ServicesPricingCard` (один компонент в Settings) теперь умеет: добавить услугу, переименовать (inline), сменить категорию, длительность, цену, себестоимость, заархивировать (soft-delete с подтверждением), показать архив + восстановить. Хуки `useCreateService` + `useUpdateService` (расширен).

**B-2 — CRUD категорий услуг и расходов:** новая карточка `CategoriesCard` в Settings — две колонки (service / expense), inline rename, add new, archive с защитой is_system. Хуки `useCreateExpenseCategory` / `useUpdateExpenseCategory` / `useCreateServiceCategory` / `useUpdateServiceCategory`.

**B-3 — team-invitation для незарегистрированных через Supabase invite-link:** `send-invitation` теперь, если приглашённого email нет в `auth.users`, вызывает `auth.admin.generateLink({type: 'invite', redirectTo: accept-url})` и кладёт `action_link` в письмо. Юзер кликает → Supabase Auth подтверждает email + логинит + редирект на `/accept-invite?token=...` → автопринятие. Один клик вместо «signup → confirm → login → accept».

**B-5 — Bundle splitting:** убрали `recharts` chunk (recharts не используется в коде), добавили отдельные chunks `react-query` (42KB / 13KB gzip) и `sonner` (33KB / 9KB gzip). Initial bundle index уменьшен на ~75KB.

**B-6 — telegram-auth deploy check:** prod `OPTIONS /telegram-auth` отвечает 204, функция ACTIVE. На staging пока 404 — выкатится автоматом следующим push'ем (новый двухступенчатый CI).

**B-7 — Logo в email-шаблонах:** добавили `{{logo_block}}` в welcome / weekly_digest / team_invitation. Helper `renderLogoBlock(logoUrl)` в `_shared/notify.ts` собирает `<img>` с inline-стилями (display:block; max:120×48; rounded). Если у салона нет logo — пустая строка, шаблон просто не показывает блок. В edge functions `notify-welcome`, `send-weekly-digest`, `send-invitation` тянем `salon.logo_url` из БД.

**B-8 — Sentry в edge functions:** новый `_shared/sentry.ts` — минимальный envelope-sender без зависимостей. При наличии `SENTRY_DSN_SERVER` шлёт error в Sentry `/store/`-endpoint (legacy, всё ещё работает). Подключено в `stripe-webhook`, `generate-export`. Остальные edge functions можно оборачивать по мере выявления проблем — helper готов.

**Dark theme:** `darkMode: 'class'` уже был в Tailwind config, но `.dark` CSS-переменные не определены. Добавили в `globals.css` полный набор для всех shadcn-токенов и Finkley brand-цветов (deep navy фон, brand-\* чуть ярче для контраста). `ThemeProvider` (`components/theme/theme-provider.tsx`) — system/light/dark с persist в localStorage и слушателем `prefers-color-scheme`. `AppearanceCard` в Settings с тремя кнопками (Monitor/Sun/Moon).

**Маржа по услугам, Excel-экспорт, custom date-range, Logo upload, CI staging-gate, insights schema sync** — все сделаны в предыдущем pass'е этой же даты.

### Метрики качества на конец сессии

- `pnpm typecheck` — зелёный
- `pnpm lint` — зелёный (max-warnings 0)
- `pnpm build` — собирается
- i18n parity — 908/908/908 (ru/en/pl)

### Что осталось (категория A — только владелец)

- **Stripe Coupon `BETA3M`** — создать в Stripe Dashboard
- **Юр.документы Privacy/Terms** — заменить placeholders `[Юрлицо PL]` / `[NIP]` / `[адрес]` на реальные данные ИП в `apps/landing/src/pages/{privacy,terms}.astro` + футеры email-шаблонов в `templates.ts` и `docs/email-templates/*.html`
- **GitHub Environment "production"** с required reviewers (для нового CI staging-gate)
- **Apple Developer Program** ($99/год) — для Apple Sign In, не критично для MVP

Stripe Live mode credentials (`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`) — **уже в Supabase secrets prod**. Resend API key + RESEND_FROM — **уже там же**. Anthropic, Telegram, VAPID, wFirma — тоже в проде.

### Узнали нового

- Resend API ключ управляет всем — даже Supabase Management API позволил удалить legacy POSTMARK\_\* за один DELETE с массивом имён.
- `auth.admin.generateLink({type: 'invite'})` в Supabase — недокументированно толком, но работает: создаёт user, ставит email_confirmed_at = null, возвращает action_link для одноразового logon. Идеально для team-invitations.
- В `darkMode: ['class']` Tailwind 3.4 нужно ровно `class` (не `selector`) — был лишний array-обёртка но работает.
- React-refresh ESLint-плагин ругается если из одного файла экспортируется и компонент, и hook (`useTheme` рядом с `<ThemeProvider>`). Решение — comment-disable или разделить файлы. Выбрали disable, потому что split дороже в навигации.
