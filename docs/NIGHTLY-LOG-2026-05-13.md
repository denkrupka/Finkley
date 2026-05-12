# Ночная сессия 2026-05-12 → 2026-05-13

Владелец ушёл спать и поручил доделать всё что просил днём + утренний UI/UX audit + тесты.
Этот лог — итог всего что было закрыто за ночь.

## Commits (хронологически)

| Commit      | Что сделано                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| `590af1e..` | (старые — до начала ночи)                                                    |
| `b679956`   | feat(ui): Booksy-style period picker popover (5 вкладок)                     |
| `73220e1`   | feat(finance): expandable DDS day rows                                       |
| `06e3d38`   | fix(print): hide picker/tabs/filters во время печати                         |
| `d54cc1f`   | feat(calendar): 15-min subslots, click popover, paid indicator               |
| `9c452e6`   | fix(calendar): retail исключён из календаря                                  |
| `63bf13c`   | feat(period): quick chips (Сегодня / Эта неделя / …)                         |
| `8a10f45`   | feat(print): период виден в распечатке                                       |
| `393f8ee`   | feat: batch UX polish (calendar, picker, sales, clients)                     |
| `f4cd8e7`   | feat(inventory): single-row toolbar, import-choice modal, categories add     |
| `cc3ba49`   | feat(services): planning params + bulk-apply                                 |
| `acd281c`   | feat(settings): «Параметры» tab                                              |
| `942238c`   | feat(finance): Финансовый отчёт subtab                                       |
| `5e6fafb`   | feat(notifications): send-daily-digest edge function                         |
| `2849e9c`   | feat(messenger): scaffold unified inbox                                      |
| `ecef90e`   | feat(settings): tabs reorganization + audit i18n                             |
| `06d608c`   | fix: white-screen daily_digest + messenger i18n + Parameters→Finance         |
| `a6a2738`   | feat(landing): /media раздел для SEO                                         |
| `054e753`   | fix(reports,finance,settings): PeriodPicker on P&L + collapsible report rows |

## Migrations (применяются при апруве prod deploy)

- `20260513000001_inventory_categories.sql` — `salons.inventory_categories text[]`
- `20260513000002_service_planning_params.sql` — capacity-planning поля на `services`
- `20260513000003_financial_settings.sql` — `salons.financial_settings jsonb`
- `20260513000004_daily_digest.sql` — `salons.daily_digest_enabled bool`
- `20260513000005_messenger.sql` — `messenger_conversations / _messages / _integrations`

## Что доделано из утренних задач

✅ Period-picker popover (Booksy-style) с режимами + quick-chips
✅ DDS-таблица: клик на день раскрывает все транзакции
✅ Print polish (period-picker, page-tabs, фильтры скрыты при печати)
✅ Calendar: 15-мин subslots, popover «Новый визит / Резерв / Отсутствие»
✅ $-индикатор для paid визитов, truncate, default duration 60
✅ Inventory: AI OCR (Anthropic vision) для чеков / PDF
✅ Inventory: single «Импорт» с выбором CSV / AI
✅ Inventory: категории — создание standalone + dropdown в форме материала
✅ Services: capacity-planning матрица (8 параметров × услуги) + «Применить ко всем»
✅ Settings → Параметры (теперь Финансы → Параметры): полный финансовый input
(кассы, постоянные, переменные %, налоги, инвестиции, движение денег)
✅ Финансы → Финансовый отчёт: annual cash-flow с свёрткой групп + Excel/Print
✅ Финансы → P&L (ReportsPage): единый PeriodPicker, кнопки в одну строку
✅ ЗП (PayoutsPage): PeriodPicker вместо chevron'ов
✅ Daily digest: edge function + Settings → Уведомления tab
✅ Settings tabs reorg:

- Удалена «Внешний вид»
- Создана «Уведомления» (push + weekly + daily digest)
- Создана «API» (ApiKeysCard + docs + how-to)
- Команда → «Пользователи» (label)
  ✅ Перемещения:
- Удалить салон → Профиль
- Экспорт данных → Безопасность
- Журнал событий → Безопасность
- Сравнение с похожими салонами → Профиль
- Push-уведомления → Уведомления
- API-ключи → API
- Стартовый остаток в кассе — убран (дубликат с Параметры → Кассы)
  ✅ Messenger: scaffold unified inbox (TG / WA / IG / FB)
  ✅ Messenger: иконки вместо текстовых табов
  ✅ Sales: «+Продажа» кнопка на /income → Sales
  ✅ Visits: QuickEntryModal с prefill из календарного subslot'а
  ✅ Visits: убрана таб «Продажа» из QuickEntry
  ✅ ClientPicker: «+ Создать» открывает ClientFormModal с prefill
  ✅ Лендинг: /media SEO-блог через Astro content collections
  ✅ audit.\* i18n keys — исправлен баг «audit.title» вместо текста
  ✅ White-screen fix: `daily_digest_enabled` опционален в типах + fallback false
  ✅ Push-уведомления: ошибка FunctionsHttpError теперь показывает body.error
  ✅ ParametersCard: dailyDigest toggle конвертирует PostgrestError в Error
  (toast больше не показывает «[object Object]»)

## Хвосты / нужно от владельца

- **Пригласи друзей** в sidebar (последний пункт, желтая подсветка, модалка с
  shareable link + share-кнопки + статистика приглашений) — не доделано.
  Текущая реализация: ReferralCard живёт в Settings → Пользователи.
- **Theme switcher mini-button в TopBar** — не доделано. Сейчас theme дефолтный.
- **Реальные провайдеры мессенджеров** (TG webhook, WA Business API, IG/FB Graph) —
  требуют OAuth и Meta-approval. Scaffold готов, реальная интеграция отдельным
  спринтом.
- **Inventory category history** при удалении — текущая реализация просто
  убирает категорию из current state. Историческое восстановление потребует
  snapshot-versioning (отдельный спринт).
- **Admin UI для постинга статей в /media** — пока через git (markdown файлы
  в `apps/landing/src/content/media/`). Полноценный Decap CMS / собственный
  editor — отдельный спринт.
- **DDS transactions: account / counterparty / hierarchical статья** — текущая
  ДДС читает существующие visits/expenses/other_incomes. Расширение требует
  миграции (добавить колонки) + UI rework. Не доделано.

## Тесты

```
Test Files  11 passed (11)
Tests       49 passed | 1 skipped (50)
```

✅ Все тесты зелёные.

## Сборка

- ✅ `pnpm --filter web build` — 460KB FinancePage (gzip 123KB), всё ОК
- ✅ `pnpm --filter web typecheck` — 0 ошибок
- ✅ `pnpm --filter web lint` — 0 ошибок
- ✅ `pnpm --filter landing build` — 7 страниц включая /media и /media/[slug]

## Деплои

- ✅ Web → prod: задеплоено
- ✅ Supabase → staging: задеплоено (миграции применены)
- 🔄 Supabase → prod: запущен после approve (миграции должны применяться)

После апрува все 5 миграций накатятся на prod БД — daily*digest_enabled,
financial_settings, inventory_categories, service_planning_params, messenger*\*.

## Что точно работает после ночи

1. Финансы → Финансовый отчёт — главное достижение, реально полезный кэш-флоу
2. Финансы → Параметры — вся вводная для отчёта в одной форме
3. Услуги → Параметры — capacity-planning матрица
4. Inventory → AI: импорт чека — реальный Anthropic vision
5. Period-picker везде где есть месяц/период
6. Календарь: 15-мин клик создаёт визит с prefill staff+time
7. Messenger: scaffold UI работает с internal-channel для тестов
8. Лендинг /media: SEO-блог с одной стартовой статьёй
