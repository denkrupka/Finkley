# ADR-034: Gamified «Настройка Finkley» + награда «+14 дней»

## Статус

`Accepted`

Дата: 2026-06-18

## Контекст

После онбординга нужно довести юзера до «полной картины прибыли» (визиты +
расходы + интеграции + дашборд). Владелец попросил всегда висящий бар
прогресса с призом «+14 дней демо» за прохождение на 100% в течение 7 дней,
с защитой от абуза (триальщики плодят аккаунты и прокликивают пустоту).

## Решение

- **Серверный трекинг.** RPC `setup_progress(p_salon_id)` (security invoker,
  миграция `20260618000001`) считает completion из РЕАЛЬНЫХ событий: `has_visit`
  / `has_expense` (по `visits`/`expenses` с `deleted_at is null`),
  `booksy_connected` / `bank_connected` (по `salon_integrations` /
  `bank_connections`), `dashboard_opened` (флаг `salons.dashboard_opened_at`,
  ставится RPC `mark_dashboard_opened` при открытии дашборда). НЕ из кликов
  клиента.
- **UI.** `SetupProgressBar` (owner-only, висит пока < 100%): endowed-progress
  старт 40% (салон создан), goal-gradient «осталось N шагов», карточки
  что/зачем/что даст/CTA. Booksy/банк — dismissable. Чистая логика —
  `lib/setup-progress.ts` (+ тесты).
- **Награда.** Edge function `claim-setup-reward` (service-role, `withSentry`):
  - hard-гейт реальных данных: **≥1 визит И ≥1 расход** (серверная проверка);
  - **один приз на dedup_key** = Stripe customer / нормализованный NIP /
    (fallback) владелец — через UNIQUE-леджер `setup_reward_grants`
    (insert → catch 23505);
  - глобальный **лимит выдачи** `REWARD_MAX_GRANTS` + **Sentry-лог**
    (`captureMessage`) гранта и достижения лимита;
  - грант = `salon_subscriptions.bonus_until` (механизм ручного продления,
    ADR через миграцию 20260514150000) — работает и для implicit-trial, и
    поверх Stripe, без обращения к Stripe API.

## Альтернативы, которые рассматривали

- **Completion из кликов клиента:** отклонён — триальщик прокликает пустоту.
- **Продление Stripe-триала через API:** отклонён — нет helper'а в
  `_shared/stripe.ts`, и `bonus_until` покрывает все случаи без обращения к Stripe.
- **Дедуп на user_id:** отклонён как основной — люди плодят аккаунты; основной
  ключ — Stripe customer / NIP, user_id только fallback.

## Последствия

### Положительные

- Доходимость онбординга вверх (Nunes–Drèze endowed progress + goal-gradient).
- Приз нельзя нафармить: реальные visit+expense + дедуп по customer/NIP + лимит.

### Отрицательные

- `dashboard_opened` — единственный «мягкий» шаг (клиент дёргает RPC). Не
  критично: приз гейтит реальные visit+expense.
- Источник «активности» подписки (client `isSubscriptionActive`) не читает
  `bonus_until` — приз для уже-checkout'нутого юзера виден через server
  `effective_status`/новый `entitlements.effectivePlan`, но не через старый
  клиентский helper. Унифицировать при следующей правке биллинга.

### Что мониторим

- Sentry-события `setup_reward granted` / `limit reached` — частота и аномалии.
- Если бар назойлив для старых салонов — `shouldShowSetupBar` ограничивает 30
  днями с создания.
