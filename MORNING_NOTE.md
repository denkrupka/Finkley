# MORNING NOTE — ночь 21→22 мая 2026

> Ночная серия из 18 задач (TaskList #32..#48). Юзер ушёл спать со словами
> «доделывай всё, не останавливайся, на спорных моментах выбирай сам».
> Доделано всё, кроме явных follow-up'ов (выписаны в конце).

## 🎯 Что протестировать в первую очередь

1. **`/marketing` → таб «Рассылки»** — теперь по дефолту все каналы ВЫКЛЮЧЕНЫ
   (safe-by-default). Включи нужные галочки, потом жми «Тест» → выбор
   SMS/Email + ввод своего номера → реальная отправка с теми же
   шаблонами, что получают клиенты.
2. **SMSAPI «Тест» работает** — был баг с endpoint .com vs .pl, твой
   токен в PL-регионе, теперь подключено правильно. Аккаунт
   `biuro@maxmaster.info`, баланс 6.63 SMS.
3. **`/marketing` → новая таба «Создать рассылку»** — сегмент клиентов
   (все/новые 1 визит/постоянные 5+/давно не были 90+/по тегу) + SMS/
   email тексты + превью «сколько уйдёт» + отправка.
4. **Онбординг переделан** — выбор «Быстрая (3 шага) / Полная (9 шагов)».
   В Done — paywall-блок с trial 14 дней, после submit → Stripe Checkout.
5. **Reports → Конкуренты → Контент** — свой салон теперь в первой строке
   с реальными числами (followers/posts/likes), если есть instagram_url/
   facebook_url в Settings → Профиль. Cron собирает каждую ночь.
6. **Reports → Мастера** — таблица «Эффективность мастеров» переделана:
   убрана колонка «Возвраты», вместо неё «Возврат новых» (% клиентов
   с 1-м визитом, которые вернулись) и «Удержание постоянных» (% от
   ≥2-визитов, кто пришёл в этом периоде). Плюс колонки «Услуги» /
   «Доп.продажи» / «Чаевые».

## 📦 18 закатанных задач (по TaskList)

### Фиксы

- **#37** Отзывы импорт 0 → 5: partial unique index ломал `ON CONFLICT`,
  переписал на manual dedup. Google API работает, Wondefrul: 5 отзывов.
- **#40+#41** `permission denied for create_salon_with_setup` — добавлен
  grant для anon role (функция сама проверяет `auth.uid()`). Кнопка
  «Открыть дашборд» теперь работает.
- **#46** SMSAPI 401 — был `.com`, нужно `.pl` (регион токена).
- **#34** «return_period_days+3 (грейс)» → человеческий текст.

### Новые UI

- **#33** Reports/Услуги: колонка «Цена» + Доход/час теперь unit-rate
  (price/duration\*60), а не агрегат от выручки.
- **#35** Reports/Мастера: 2 retention-метрики + Услуги/Доп.продажи/Чаевые.
- **#36** Финансы/ДДС: клик на визит → открывает VisitDetailModal
  (как в календаре, не QuickEntryModal).
- **#21** «Добавить конкурента» — Google Maps поиск.
- **#23** Скрипт работы с возражениями: убрана подпись «Wonderful Beauty».
- **#39** Reports/Конкуренты: автоподбор учитывает тип салона и
  watched_services. Блок «Какие услуги мониторить» перемещён на 2-е место.

### SMS-биллинг (ещё с прошлой сессии)

- **#42** Онбординг: 2 пути (Быстрая/Полная) + TutorialNote на каждом
  шаге + Stripe paywall в финале.
- **#43** Paywall: trial 14 дней, opt-out чек-бокс, после submit →
  Stripe Checkout, graceful fallback на dashboard если Stripe фейлит.
- **#44** Доп. шаги Full path: Адрес (Google Maps), Бухгалтерия (NIP),
  Интеграции (opt-in Booksy/wFirma/Banking).

### Интеграции

- **#38** salons.instagram_url, salons.facebook_url + UI поля в Settings.
- **#45** Settings → Интеграции → новая вкладка «Соцсети» (статус FB+IG
  с messenger_integrations + кнопка Connect → Messengers таб).
- **#47** Reports/Конкуренты/Контент — свой салон через scrape.
  Новая таблица `own_salon_metrics`, расширена `competitor-sync`.

### Refactor

- **#32** Шаблоны рассылок вынесены в `_shared/broadcast-templates.ts` —
  один источник истины для send-review-request / client-overdue-push /
  marketing-test-send. «Тест» теперь шлёт 1-в-1 клиентский текст.

### Тесты

- **#48** 29 новых unit-тестов для критичных helpers:
  filterBySegment (10), gateSendDecision (12), normalize prefs (7).
  Всего тестов: 245.

## 🚀 Прод состояние (8 коммитов за ночь)

| Commit    | Что                                           |
| --------- | --------------------------------------------- |
| `909da55` | 29 тестов для марketing/sms/broadcast helpers |
| `f215502` | Свой салон в Reports/Конкуренты через scrape  |
| `16aba95` | SMSAPI endpoint .pl фикс                      |
| `b0f75db` | Settings → Интеграции → Соцсети               |
| `eead721` | Stripe paywall + 3 шага в Full онбординг      |
| `3f83542` | Reports/Мастера retention split               |
| `2f4b29a` | Клик-визит в ДДС                              |
| `437f9fa` | IG/FB поля салона                             |
| `4e14079` | Отзывы 0→5 фикс                               |
| `e2a6782` | 2-путь онбординг                              |
| `76f62ea` | Конкуренты по типу+услугам                    |
| `40d3d78` | Reports/Услуги: Цена + unit-rate              |
| `ff771d2` | broadcast-templates refactor                  |

## 🗃️ Миграции в проде (применены через Management API)

- `20260521000023` — broadcast_prefs default OFF
- `20260522000001` — anon grant create_salon_with_setup
- `20260522000002` — salons.instagram_url, facebook_url
- `20260522000003` — own_salon_metrics

## ⚠️ Открытые follow-up'ы (явно НЕ доделаны, требуют решения)

- **Booksy URL у Wondefrul обрезан** до `/a` — обнови на полный URL и
  ручной импорт даст 702 booksy-отзыва (если парсер Booksy не сломан).
- **Шаги Склад/Доходы в Full онбординг** — оставлены как Settings-flow
  после онбординга (иначе 11 шагов, слишком длинно). Если нужно
  отдельными шагами — скажи, добавлю как info-промо.
- **Meta Graph API через токены** — сейчас метрики тянутся scrape'ом
  (быстро, без OAuth). Точнее было бы через access_token из
  messenger_integrations.credentials (encrypted). Требует расширения
  decrypt-helper'а и FB Pages scope. Низкий приоритет — scrape работает.
- **E2E тесты в браузере** — не запускал. typecheck + lint + 245 unit-
  тестов passed, но кликать руками не проверял.

## 💡 Что ещё могу сделать без твоего участия

- ADR-документы для значимых решений (broadcast safe-by-default, SMSAPI
  region detection, partial unique index)
- Polish UI (find visible bugs / consistency)
- Performance optimization (lazy-load больших chunks)
- Документация для новых функций (sms-billing.md, marketing-broadcasts.md)

Скажи приоритет — продолжу.
