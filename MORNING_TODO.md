# MORNING_TODO — что нужно от владельца после автономной ночи

Дата работы: 7 мая 2026, ночная сессия + утреннее продолжение. Все коммиты на `main`, GitHub Actions деплой гоняется автоматически.

## Кратко: что за ночь сделано (ссылка на коммиты)

- `c6c7cb2` — Phase 1 E2E suite + dotenv loader + lint-staged scope fix
- `3c2ad97` — TASK-20 Clients CRUD (full)
- `3b94598` — TASK-25 Receipt photos + recurring expenses
- `f35a966` — TASK-26 GDPR export
- `b191892` — TASK-24 Tips + discounts in visits

## Утреннее продолжение (7 мая 2026, после возвращения)

- `8f9163c` — cron migration + Vault + добавил `process-recurring-expenses` в `NO_JWT_FUNCTIONS`
- `7868d4d` — **TASK-21** schemes UI (5 схем + per-service overrides в drawer)
- `384d054` — **TASK-22** payouts page + RPC + close-period (auto-expense в категории «Зарплаты»)
- `a874e70` — **TASK-23** reports page (P&L + bar-list мастеров/оплат + heatmap день×час)
- `87ca833` — **TASK-32** CSV-импорт visits (wizard в `/settings/import`)

Подробный разбор — `docs/RETRO.md` секция «Овернайт-сессия · 7 мая 2026».

E2E suite: 10/10 chromium tests зелёные.

---

## ⚠️ Действия от владельца — приоритет 1

### 1. Положить FUNCTION_INTERNAL_SECRET в Vault (1 минута) — ЕДИНСТВЕННОЕ что нужно

Регистрацию cron-job я перенёс в миграцию `20260507000004_recurring_expenses_cron.sql` — она применится автоматически следующим деплоем. Ещё в `deploy-supabase.yml` добавил `process-recurring-expenses` в `NO_JWT_FUNCTIONS`, иначе платформа Supabase резала бы вызовы из cron до самой функции.

Что ОСТАЛОСЬ сделать тебе (один раз, после деплоя): открой Supabase Dashboard → SQL Editor и выполни:

```sql
select vault.create_secret(
  '<значение FUNCTION_INTERNAL_SECRET из Dashboard → Edge Functions → Secrets>',
  'function_internal_secret'
);
```

Где взять значение: Dashboard → Project Settings → Edge Functions → Secrets → `FUNCTION_INTERNAL_SECRET` → Reveal.

Проверить что cron зарегистрирован:

```sql
select jobname, schedule from cron.job where jobname = 'process-recurring-expenses';
```

Должна быть строка со `schedule = '0 3 * * *'`. До того как секрет появится в Vault, cron будет стартовать но получать 401 от функции — это ОК, никаких side-effects.

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
