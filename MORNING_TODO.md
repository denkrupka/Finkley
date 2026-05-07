# MORNING_TODO — что нужно от владельца после автономной ночи

Дата работы: 7 мая 2026, ночная сессия + утреннее продолжение. Все коммиты на `main`, GitHub Actions деплой гоняется автоматически.

## Кратко: что за ночь сделано (ссылка на коммиты)

- `c6c7cb2` — Phase 1 E2E suite + dotenv loader + lint-staged scope fix
- `3c2ad97` — TASK-20 Clients CRUD (full)
- `3b94598` — TASK-25 Receipt photos + recurring expenses
- `f35a966` — TASK-26 GDPR export
- `b191892` — TASK-24 Tips + discounts in visits

## Утреннее продолжение (7 мая 2026, после возвращения)

- `8f9163c` — cron migration v1 + добавил `process-recurring-expenses` в `NO_JWT_FUNCTIONS` (superseded by `07e2b52`)
- `7868d4d` — **TASK-21** schemes UI (5 схем + per-service overrides в drawer)
- `384d054` — **TASK-22** payouts page + RPC + close-period (auto-expense в категории «Зарплаты»)
- `a874e70` — **TASK-23** reports page (P&L + bar-list мастеров/оплат + heatmap день×час)
- `87ca833` — **TASK-32** CSV-импорт visits (wizard в `/settings/import`)
- `07e2b52` — **cron fix**: переписал recurring-expenses в чистый SQL → секрет в Vault не нужен ✅
- `6214487` — **TASK-35a** PWA install (manifest + SW + 3 SVG icons + iOS meta)
- `55031bc` — PWA install button в Settings (ловит beforeinstallprompt)
- `d3a85bc` — **TASK-34 lite** weekly digest (manual trigger из Settings + opt-out toggle; auto-cron — отдельная задача, требует Vault setup)
- `4923529` — **perf**: bundle 679→440 KB raw / 204→135 KB gzip (libphonenumber/min + lazy QuickEntry + lazy Sentry init)
- `3395151` — **perf**: lazy Signup/Onboarding/AuthCallback → 440→416 KB raw / 130 KB gzip

Подробный разбор — `docs/RETRO.md` секция «Овернайт-сессия · 7 мая 2026».

E2E suite: 10/10 chromium tests зелёные.

---

## ⚠️ Действия от владельца — приоритет 1

### 1. Cron повторяющихся расходов — СДЕЛАНО ПОЛНОСТЬЮ ✅

Логика переписана из edge-function в чистый SQL (миграция `20260507000007_recurring_expenses_native_sql.sql`). Cron теперь зовёт `public.process_recurring_expenses()` напрямую через `cron.schedule` — никаких HTTP-вызовов, никаких секретов. Edge-function `/process-recurring-expenses` оставлена как ручной trigger для отладки, но больше не на критическом пути.

Проверка после следующего деплоя (опционально):

```sql
select jobname, schedule, command from cron.job where jobname = 'process-recurring-expenses';
-- Должно быть: schedule='0 3 * * *', command='select public.process_recurring_expenses();'
```

### 2. Прокликать новые фичи руками (15 минут) — ОТЛОЖЕНО

Запусти приложение в инкогнито или новой сессии (`https://finkley.app/app/login`), залогинься, и пройди:

**Клиенты (TASK-20):**

- [ ] Sidebar → «Клиенты» (раньше «Скоро» — теперь работает)
- [ ] Кнопка «+ Добавить клиента»: создать с именем, телефоном (например `+48600123456`), email
- [ ] Открыть карточку клика — drawer справа с пустой историей
- [ ] FAB «+» → Quick Entry → в поле «Клиент» нажать → выбрать только что созданного → сохранить визит
- [ ] Вернуться на «Клиенты» → drawer → история визитов содержит запись + общая сумма обновилась

**Расходы — фото чека и повторение (TASK-25):**

- [ ] Sidebar → «Расходы» → «Добавить расход»
- [ ] Заполнить категорию + сумму, прикрепить **фото чека** (любая JPG/PNG до 10 МБ)
- [ ] В поле «Повторение» поставить «Каждый месяц»
- [ ] Сохранить
- [ ] В списке у этого расхода: иконка скрепки (клик открывает превью), иконка повтора (зелёный кружок Repeat)

**GDPR-экспорт (TASK-26):**

- [ ] Settings → «Экспорт данных» → «Скачать данные»
- [ ] Должен открыться ZIP в новой вкладке (или начаться скачивание) + ссылка прийти на твой email
- [ ] Распаковать архив, проверить README.txt и CSV-файлы (visits.csv, expenses.csv, clients.csv, и т.д.)
- [ ] Повторно нажать кнопку: должен прийти тот же URL (rate-limit 1 экспорт/24h)

**Чаевые и скидки (TASK-24):**

- [ ] FAB «+» → новый визит, заполнить сумму **50**, чаевые **5**, скидку **0**
- [ ] Сохранить → дашборд: выручка должна показать **55 €** (сумма + чаевые)
- [ ] Аналогично с скидкой: сумма 50, скидка 10 → выручка **40 €**

Если что-то не работает — пиши, разберёмся.

---

## ⚠️ Что было отложено в плановом порядке (НЕ блокеры)

### 3. Stripe coupon для бетеров (отложено по твоей просьбе #1)

Когда будешь готов запускать бету — скажи. План:

- Создаём в Stripe Dashboard → Coupons промокод `BETA3M` (3 месяца 100% off)
- Прикручу в Checkout кнопку «У меня код» или сразу при regисtraciи беты

### 4. Юр-доки: реальные данные ИП (отложено #2)

В `apps/landing/src/pages/privacy.astro`, `terms.astro` всё ещё placeholders `[Юрлицо PL]`, `[NIP]`, `[Y]`. Подставь реальные данные польского ИП когда они будут — или временно заменить на «ИП в процессе оформления, контактные данные обновим к публичному запуску».

---

## Заметки для будущих ночных сессий

1. **Pre-commit hook:** lint-staged теперь scoped к `apps/web/**`, не пытается лайнтить корневые `.ts` файлы. Если правишь файл вне `apps/web/` — eslint его не трогает (только prettier).
2. **Playwright:** локально 10/10 тестов работают. Нужны переменные `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` в `apps/web/.env.local` (уже есть). В CI — нужны как secrets, ещё не настроены, можем добавить.
3. **`pnpm dlx supabase gen types`** периодически добавляет «мусор» в начало/конец типов файла (`Initialising login role...`, `<claude-code-hint>`). Если правишь — проверь первую и последнюю строки `apps/web/src/types/supabase.ts`.
4. **Bundle size:** index chunk вырос до 726 KB (+200 KB за ночь, в основном libphonenumber-js + новые routes). Code-splitting для тяжёлых страниц (Dashboard, Clients, Reports) — отдельная задача стадии 2 финализации. Сейчас не блокирует.

## Что в работе для меня (когда вернёшься)

Стадия 2 закрыта почти полностью (✅ TASK-20..23, TASK-26, TASK-32; 🟡 TASK-24/25 PARTIAL). Осталось:

- **Stripe coupon `BETA3M`** (5 минут, как соберёшься запускать бету)
- **Юр-доки** (privacy/terms placeholders → реальные данные ИП)
- **TASK-24/25 финал** — multi-row grid + повторяющиеся шаблоны визитов; бюджет vs факт расходов; остаток нала. **Нужны продуктовые решения**, что именно показывать.
- **TASK-27 Booksy research спайк** — это начало стадии 3, готов делать когда скажешь
- **TASK-33/34/35/36** — стадия 4 (AI-инсайты, weekly digest, PWA, бенчмарки)
- **CI Playwright secrets** — настроить GH secrets чтобы E2E гонялся в CI (сейчас только локально)
- **Apple Sign In** — если оформишь Apple Dev Program

Скажешь — поехали.
