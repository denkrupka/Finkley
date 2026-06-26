# ADR-036: Промокоды-награды Stripe (setup €20 / referral €15)

## Статус

`Accepted`

Дата: 2026-06-26

## Контекст

До сих пор награда за прохождение «Настройки Finkley» была материальной —
`salon_subscriptions.bonus_until += 14 дней` (ADR-034, миграция
`20260618000001_setup_progress`). Она продлевала демо/триал, но не давала
повода вернуться и **оплатить**: юзер просто дольше пользовался бесплатно.

Параллельно есть реферальная программа (миграция
`20260508000008_api_keys_and_referrals`): `referral_codes` + `referral_uses`,
причём `referral_uses.activated_at` был задуман как «когда приглашённый
оплатил подписку», но **никто его не проставлял** — реферал был мёртвой
схемой.

Владелец решил конвертировать обе механики в **денежные стимулы к оплате**:

1. Прохождение всех заданий настройки → одноразовый Stripe promo code **€20**.
2. Первая платная подписка приглашённого по ref-ссылке → рефереру одноразовый
   Stripe promo code **€15**.
3. На каждый появившийся промокод — email с кодом.

Stripe live-ключ (`STRIPE_SECRET_KEY`) уже доступен edge functions, а
`allow_promotion_codes: 'true'` уже включён в Checkout (`createCheckoutSession`),
поэтому код, введённый юзером на странице оплаты, Stripe валидирует и применяет
сам — свой UI применения скидки не нужен.

## Решение

### Хранение

Новая таблица `promo_rewards` (миграция `20260626000004_promo_rewards.sql`) —
леджер сгенерированных Stripe-промокодов: `kind ('setup'|'referral')`,
`amount_cents`, `currency`, `stripe_coupon_id`, `stripe_promo_code_id`, `code`
(человекочитаемый — его показываем юзеру), `referral_use_id` (для реферала),
`email_sent_at`, `redeemed_at`. RLS: own-select (`user_id = auth.uid()`),
service_role all. Дедуп реферала — `UNIQUE(referral_use_id) WHERE NOT NULL`.

### Генерация Stripe promo

`_shared/stripe.ts` → `createOneTimePromoCode()`: `POST /v1/coupons`
(`amount_off`, `duration: once`, `max_redemptions: 1`) → `POST
/v1/promotion_codes` (`coupon`, `max_redemptions: 1`). Возвращает
`{ couponId, promoCodeId, code }`. Stripe сам генерит читаемый `code`.

`_shared/promo-reward.ts` → `grantPromoReward(admin, secret, {...})`:
создаёт promo + `INSERT promo_rewards`, возвращает `{ code, promoRewardId,
reused }`. Idempotent для реферала (по `referral_use_id`, включая гонку 23505).

### Setup-награда (€20)

`claim-setup-reward` переписана: вместо `bonus_until += 14д` теперь
`grantPromoReward(kind='setup', amountCents=2000)` + email `setup_reward_promo`.

- **Право:** ВСЕ **core**-задания настройки выполнены на сервере (через RPC
  `setup_progress`: `has_visit && has_expense && booksy_connected &&
bank_connected && dashboard_opened`) — это совпадает с UI-гейтом
  `isCoreComplete` в `apps/web/src/lib/setup-progress.ts`.
- **Почему core, а не «100% всех заданий»:** extra-задания (конкуренты, склад,
  маркетинг и т.д.) **dismissable** — пропуск хранится в localStorage клиента,
  сервер про него не знает. Требовать `serverDone` по всем extra нельзя: салон,
  который не пользуется складом, никогда бы не получил награду. Поэтому реальный
  серверный анти-абуз-гейт = core + UNIQUE-леджер; «все задания» как условие
  показа кнопки остаётся UI-altitude гейтом (как RBAC в ADR-033).
- **Окно:** расширено с 7 до **30 дней** с создания салона. Промокод не
  «сгорает как триал», срочности меньше, даём больше времени довести настройку.
- **Дедуп:** UNIQUE-леджер `setup_reward_grants(dedup_key)` (`cus:<id>` / `nip:`
  / `user:`) — один приз на Stripe customer / NIP / аккаунт. Леджер заполняется
  ДО создания Stripe-промокода (анти-гонка); при ошибке Stripe — откат строки.
- **Контракт ответа:** `{ granted: true, code, amount_cents }` или
  `{ granted: false, reason }` (`forbidden` / `already_claimed` /
  `window_expired` / `incomplete` / `limit_reached`). Раньше возвращалось
  `{ granted, bonus_days, bonus_until }` — **UI обновляет владелец отдельно**
  (показ промокода вместо «+14 дней»).

### Referral-награда (€15)

`stripe-webhook` → `maybeGrantReferralReward(admin, referredUserId)`:

- **Триггер «первой продажи»** приглашённого:
  - `checkout.session.completed` c `mode='subscription'` и наличием
    `session.subscription`;
  - `customer.subscription.created` / `customer.subscription.updated` со
    статусом `active` или `trialing`.
- Находит `referral_uses WHERE referred_user_id = <owner подписавшегося салона>
AND activated_at IS NULL`. Атомарно `UPDATE ... activated_at = now() WHERE
activated_at IS NULL` (первый забирает); если строк не обновили — выходит.
- `grantPromoReward(kind='referral', amountCents=1500, referralUseId)` для
  `referrer_user_id` + email `referral_reward_promo` рефереру.
- **Идемпотентно:** `activated_at IS NULL` guard + `UNIQUE(referral_use_id)`.
  Best-effort: ошибки логируются в Sentry, webhook не валится.

### Email

2 новых alias в `send-email/templates.ts`: `setup_reward_promo` (€20),
`referral_reward_promo` (€15). Плейсхолдеры `{{code}}`, `{{amount}}` +
стандартные `{{full_name}}`/`{{salon_name}}`/`{{owner_name}}`/`{{billing_url}}`.
RU + переводы EN/PL в `LOCALE_OVERRIDES` (паритет плейсхолдеров и отсутствие
кириллицы в EN/PL проверяет `templates.test.ts`). Также добавлены в
`EmailTemplate` union в `_shared/notify.ts`.

## Альтернативы, которые рассматривали

- **Оставить «+14 дней» для setup:** отклонено — не стимулирует оплату, лишь
  продлевает бесплатное пользование.
- **Реферал на `invoice.payment_succeeded` (только реально списанные деньги):**
  отклонено — владелец явно указал считать `trialing`/`active` подписку
  «первой продажей»; так реферер получает награду раньше, что усиливает
  виральность. `activated_at` guard всё равно гарантирует один раз.
- **«100% всех заданий» сервером для setup:** отклонено — extra-задания
  dismissable на клиенте, сервер не знает о пропусках (см. выше).
- **Купоны на месяц-бесплатно (как в старом комментарии миграции):** отклонено
  — фикс-скидка €20/€15 проще для аналитики и предсказуемее по стоимости.

## Последствия

### Положительные

- Обе механики теперь толкают к **оплате**, а не к бесплатному продлению.
- `referral_uses.activated_at` наконец заполняется → реферальная аналитика
  ожила.
- Промокоды одноразовые (`max_redemptions: 1`) — стоимость ограничена.
- Один источник правды генерации (`grantPromoReward`) для обоих flow.

### Отрицательные

- Каждая награда = 2 Stripe API-вызова (coupon + promotion_code). При гонке
  referral возможен «лишний» неиспользованный купон в Stripe (безвреден,
  `max_redemptions: 1`, не привязан к promo в леджере).
- UI `claim-setup-reward` нужно обновить под новый контракт (`code` вместо
  `bonus_until`) — делает владелец отдельно.
- Промокоды не имеют срока годности на стороне Stripe (купон без `redeem_by`) —
  если нужно, добавить `redeem_by` отдельной правкой.

### Что мониторим

- Кол-во `promo_rewards` по `kind` vs реально применённых (`redeemed_at`) —
  конверсия промокода в оплату. `redeemed_at` пока не проставляется
  автоматически (нет webhook на применение promo) — это следующий шаг, если
  понадобится точная атрибуция.
- Дубли referral (не должно быть благодаря guard) — Sentry-лог
  `referral promo granted` с `reused`.
- Стоимость скидок в Stripe Dashboard (Coupons) — если расходы растут, ужесточить
  окно/лимиты.

## Действия владельца

Ничего. `STRIPE_SECRET_KEY` (live) уже есть у функций, промокоды генерятся в
live-режиме автоматически. Миграция применяется штатным деплоем. UI кнопки
награды (показ промокода) владелец обновляет отдельно.
