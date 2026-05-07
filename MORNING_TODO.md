# MORNING_TODO — что нужно от владельца после автономной ночи

Дата работы: 7 мая 2026, ночная сессия. Все коммиты на `main`, GitHub Actions деплой гоняется автоматически.

## Кратко: что за ночь сделано (ссылка на коммиты)

- `c6c7cb2` — Phase 1 E2E suite + dotenv loader + lint-staged scope fix
- `3c2ad97` — TASK-20 Clients CRUD (full)
- `3b94598` — TASK-25 Receipt photos + recurring expenses
- `f35a966` — TASK-26 GDPR export
- `b191892` — TASK-24 Tips + discounts in visits

Подробный разбор — `docs/RETRO.md` секция «Овернайт-сессия · 7 мая 2026».

E2E suite: 10/10 chromium tests зелёные.

---

## ⚠️ Действия от владельца — приоритет 1

### 1. Зарегистрировать cron для повторяющихся расходов (5 минут)

Edge function `process-recurring-expenses` задеплоена и идемпотентна. Нужно её запускать раз в сутки.

В Supabase Dashboard → SQL Editor выполни (один раз):

```sql
-- Сохранить FUNCTION_INTERNAL_SECRET в database setting
-- (значение можно увидеть в Project Settings → Edge Functions → Secrets)
alter database postgres set "app.function_secret" to '<вставь_FUNCTION_INTERNAL_SECRET>';

-- Зарегистрировать ежедневный запуск 03:00 UTC (5:00 Варшава зимой)
select cron.schedule(
  'process-recurring-expenses',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://zjihgyaukpxtplzeubog.functions.supabase.co/process-recurring-expenses',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Finkley-Secret', current_setting('app.function_secret', true)
    ),
    body := '{}'::jsonb
  )
  $$
);
```

Проверить: `select * from cron.job;` → должна появиться строка с `jobname='process-recurring-expenses'`.

### 2. Прокликать новые фичи руками (15 минут)

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

Готов взять следующее по приоритету:

- **TASK-21 + TASK-22** (схемы оплаты мастерам + расчёт зарплат) — нужны продуктовые решения от тебя по схемам (`fixed`/`%revenue`/`%service`/`chair_rent`/`mixed`)
- **TASK-23** (полная аналитика P&L) — нужны решения по тому, какие срезы показывать
- **Stripe coupon + юр-доки** (если готов запускать бету)
- **Apple Sign In** (если оформишь Apple Dev Program)

Скажешь — поехали.
