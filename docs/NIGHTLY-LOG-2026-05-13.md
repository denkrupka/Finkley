# Сводный лог ночной сессии 2026-05-12 → 2026-05-13

Все запросы owner'а из текущей сессии и их статус.

## Запросы и статус

### Структурные изменения навигации

| #   | Запрос                                                                 | Статус                                        |
| --- | ---------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Группировать sidebar items (Доходы/Расходы/Отчёты/Финансы) с сабтабами | ✅ Доделано ранее                             |
| 2   | Period-toggle убрать с TopBar                                          | ✅ Готово                                     |
| 3   | Календарь — первый при открытии Визитов                                | ✅ Готово                                     |
| 4   | Продажи = standalone список товаров, не визиты                         | ✅ Готово                                     |
| 5   | Mini-calendar popover при клике «Сегодня»                              | ✅ Готово                                     |
| 6   | visits.calendar.staff_count надпись убрать                             | ✅ Готово                                     |
| 7   | Календарь — длительность из service.default_duration_min               | ✅ Готово (default 60 мин)                    |
| 8   | Двойной «+» на кнопках убрать                                          | ✅ Готово                                     |
| 9   | Календарь — 15-мин подслоты, popover (Новый/Резерв/Отсутствие)         | ✅ Готово (subslot click → 3 кнопки)          |
| 10  | Поступления подстраницу убрать                                         | ✅ Готово                                     |
| 11  | На отчётах — клик на месяц = period picker popover                     | ✅ Готово (унифицированный PeriodPicker)      |
| 12  | Печать / PDF — только табличный контент                                | ✅ Готово (`@media print` + `print:hidden`)   |
| 13  | Тут месяц-период удалить + popover при нажатии на месяц                | ✅ Готово                                     |
| 14  | Печать в ДДС / финансовых                                              | ✅ Готово                                     |
| 15  | В ДДС — клик на день → раскрытие транзакций                            | ✅ Готово (expandable rows)                   |
| 16  | Суммы в cashflow Y-axis не видны                                       | ✅ Готово (компактный формат `k/m`)           |
| 17  | Двойной «+ +» на inventory кнопке                                      | ✅ Готово                                     |
| 18  | Inventory dialog — без скролла + import button с AI                    | ✅ Готово (OCR edge function + preview-modal) |

### Inventory polish

| #   | Запрос                                  | Статус                               |
| --- | --------------------------------------- | ------------------------------------ |
| 19  | Inventory: все кнопки в один ряд        | ✅ Готово                            |
| 20  | Inventory категории — добавлять         | ✅ Готово (jsonb на salons + UI add) |
| 21  | Inventory форма: dropdown категорий     | ✅ Готово                            |
| 22  | Одна кнопка «Импорт» → модалка CSV / AI | ✅ Готово                            |

### Финансы

| #   | Запрос                                                | Статус                                                              |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| 23  | Параметры услуг — capacity-planning поля + bulk-apply | ✅ Готово (8 параметров × услуги)                                   |
| 24  | Вкладка «Параметры» в Настройках (все скрины)         | ✅ Готово, потом перемещено в Финансы                               |
| 25  | Пример отчёта Финансы → подвкладка «Финансовый отчёт» | ✅ Готово (cash-flow по месяцам + Excel/Print + collapsible groups) |
| 26  | ДДС детализация транзакций                            | ✅ Готово (basic — visits/expenses/other_incomes)                   |
| 27  | Параметры перенести с настроек в Финансы              | ✅ Готово                                                           |
| 28  | Постоянные расходы — add/edit/delete + история        | ✅ **Готово** (custom items в jsonb + soft-archive)                 |

### Notifications & integrations

| #   | Запрос                                             | Статус                                                      |
| --- | -------------------------------------------------- | ----------------------------------------------------------- |
| 29  | Ежедневная сводка для telegram + email             | ✅ Готово (edge function + UI; telegram-доставка stub)      |
| 30  | Мессенджер на левой панели — встроенный inbox      | ✅ Готово (TG/WA/IG/FB scaffold)                            |
| 31  | Push-уведомления — ошибка                          | ✅ Исправлено (FunctionsHttpError parse)                    |
| 32  | Журнал событий не работает                         | ✅ Исправлено (audit.\* i18n keys top-level)                |
| 33  | Календарь iCal — в Интеграции → Запись и календарь | ✅ Готово (CalendarFeedCard уже в integrations subtab)      |
| 34  | Импорт визитов CSV — кнопка на странице Визиты     | ✅ **Готово** (Link на /settings/import)                    |
| 35  | Кнопку «Открыть интеграции» убрать                 | ✅ Готово (контент перешёл в Settings → Интеграции subtabs) |

### Settings reorganization

| #   | Запрос                                           | Статус                                                |
| --- | ------------------------------------------------ | ----------------------------------------------------- |
| 36  | Внешний вид — удалить вкладку                    | ✅ Готово                                             |
| 37  | Оформление (тема) — мини кнопка-иконка вверху    | ✅ **Готово** (ThemeToggleButton в TopBar)            |
| 38  | Установить как приложение → Интеграции → Прочее  | ✅ **Готово** (новый subtab)                          |
| 39  | Еженедельный + ежедневный дайджест → Уведомления | ✅ Готово                                             |
| 40  | Сравнение с похожими салонами → Профиль          | ✅ Готово                                             |
| 41  | Push-уведомления → Уведомления                   | ✅ Готово                                             |
| 42  | API-ключи → API (новая вкладка) + docs + how-to  | ✅ Готово                                             |
| 43  | Журнал событий → Безопасность                    | ✅ Готово                                             |
| 44  | Пригласи друзей → левая панель / TopBar yellow   | ✅ **Готово** (TopBar Gift-чип + модалка share+stats) |
| 45  | Команда → Пользователи (переименовать)           | ✅ Готово (label)                                     |
| 46  | Удалить салон → Профиль                          | ✅ Готово                                             |
| 47  | Экспорт данных → Безопасность                    | ✅ Готово                                             |
| 48  | Стартовый остаток в кассе — убрать (дубликат)    | ✅ Готово                                             |

### Лендинг

| #   | Запрос                                       | Статус                                                            |
| --- | -------------------------------------------- | ----------------------------------------------------------------- |
| 49  | finkley.app/media — раздел блога SEO + admin | ✅ Готово (Astro content collections); admin = через git markdown |

### Прочее

| #   | Запрос                                                   | Статус                                             |
| --- | -------------------------------------------------------- | -------------------------------------------------- |
| 50  | Заезд текста за левую панель в Финансовом отчёте         | ✅ Готово (sticky left z-20 + min-width)           |
| 51  | Категории сворачивать с chevron                          | ✅ Готово (групповые строки collapsible)           |
| 52  | Кнопки Печать + Excel                                    | ✅ Готово (CSV export + window.print)              |
| 53  | Окно «Новый визит» — без скролла                         | ✅ Готово (2-col layout, gap-2.5)                  |
| 54  | Убрать таб «Продажа» из QuickEntry                       | ✅ Готово                                          |
| 55  | Кнопка «+Продажа» на /income → Sales                     | ✅ Готово                                          |
| 56  | Окно ошибки «column daily_digest_enabled does not exist» | ✅ Исправлено (optional type + миграция применена) |
| 57  | Окно ошибки «[object Object]» в daily-digest toggle      | ✅ Исправлено                                      |
| 58  | TopBar мини-кнопка иконка для темы + рефералка           | ✅ Готово                                          |
| 59  | Интеграции мессенджеров вкладка + коннекторы             | ✅ Готово (subtab + 4 карточки; OAuth = stub)      |
| 60  | Параметры — возможность редактировать/удалять позиции    | ✅ Готово (custom items add/edit/archive/restore)  |

## Невыполнено / следующая итерация

- **Реальный OAuth для мессенджеров** (Telegram webhook, WhatsApp Business API, Instagram Graph API, Facebook Pages) — требуют Meta-approval, отдельный спринт. Scaffold UI готов.
- **Theme switcher OS-следование** при выборе system mode — работает, но раньше не было индикатора. Сейчас иконка в TopBar показывает текущий resolvedTheme.
- **Admin UI для постинга в /media** — пока через GitHub web editing markdown файлов. Decap CMS / собственный editor — отдельная задача.
- **DDS-транзакции с account/counterparty/иерархической статьёй** — текущая реализация только summary из visits/expenses/other_incomes; полный transaction-style requires миграции и UI rework.
- **Inventory категории — history при удалении** — текущая реализация удаляет из current state. Если категория уже использовалась в фин. отчёте, она просто не отображается дальше (но в already-saved expenses category=NULL). Историческое восстановление потребует snapshot-versioning.

## Тесты

```
Test Files  11 passed (11)
Tests       49 passed | 1 skipped (50)
```

✅ Все тесты зелёные.

## Сборка

- `pnpm --filter web typecheck` — 0 ошибок
- `pnpm --filter web lint` — 0 ошибок
- `pnpm --filter web build` — успешно
- `pnpm --filter landing build` — 7 страниц (включая /media и /media/[slug])

## Деплои

- ✅ Web → prod: задеплоено (все commits)
- ✅ Supabase → staging: всё применено
- ✅ Supabase → prod: миграции применены (включая daily_digest, financial_settings, messenger,
  service_planning_params, inventory_categories)

## Полный список commits в текущей сессии

См. `git log --oneline a8a653f..HEAD`. Главные:

- Period-picker popover + quick chips
- DDS expandable rows
- Print polish (3 итерации)
- Calendar 15-min subslots + paid indicator
- Inventory OCR (Anthropic vision) + categories
- Service planning params
- Financial Settings (cash registers, fixed, variable, taxes, investments, flows)
- Financial Report (annual cash-flow с collapse + Excel/Print)
- Daily digest edge function
- Messenger scaffold (TG/WA/IG/FB)
- Landing /media SEO blog
- TopBar theme + referral mini-buttons
- Settings tabs reorganization (8 sections moved)
- Visit CSV import button
- Integrations: Мессенджеры + Прочее subtabs
- Custom Постоянные расходы (add/edit/archive/restore)
