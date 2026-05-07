# 008 — Booksy интеграция через proxy-form (серая зона)

**Статус:** Принято · 2026-05-08
**Контекст:** Польский рынок салонов, где 95% работают на Booksy. Без импорта визитов из Booksy продукт теряет смысл — никто не будет переписывать сотни визитов руками.

## Решение

Импортируем визиты из Booksy через **прямой POST в их frontdesk API** с использованием:

1. **Invisible hCaptcha на нашем фронте** с тем же `sitekey=2a8dae97-...` что и у Booksy. Юзер вводит email/пароль на нашей форме, hCaptcha решается прозрачно за 2-3 секунды (sitekey не привязан к домену в их конфиге).
2. **Edge function как прокси** — POST на `pl.booksy.com/core/v2/business_api/account/login` с заголовками `x-api-key`, `x-app-version`, `x-fingerprint`, `x-hcaptcha-token` и body `{email, password}`. Получаем `access_token`.
3. **Token используем для GET** `/me/businesses/{id}/calendar`, `/appointments/{uid}/`, `/payments/baskets/{uuid}` чтобы вытянуть визиты, цены, методы оплаты, чаевые.
4. **POST `/pos/transactions` с `dry_run:true`** для получения цен услуг с флагом «Nie pokazuj» — Booksy в этом случае не отдаёт цены через `/service_categories`, но dry_run симулирует кассу и возвращает `item_price`.

## Альтернативы и почему отвергнуты

| Альтернатива                    | Проблема                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Официальный Booksy API          | Нет публичного OAuth для бизнес-аккаунтов. Только Booksy Pay (узкий слой) и партнёрская программа на 2-летнем заявительном цикле. |
| Headless Playwright + 2Captcha  | Платная капча, datacenter IP блокируются Booksy, требует VPS с резидентским PL-прокси. ~€5/мес инфры + ~$0.003/login.             |
| Visual VNC — юзер логинится сам | Юридически чище, но Xvfb + Chromium + x11vnc + noVNC — слишком тяжело для MVP.                                                    |
| Импорт через CSV-экспорт        | Booksy не даёт CSV-экспорта визитов в стандартном тарифе.                                                                         |

## Юридический риск (серая зона)

Это **не нарушение CFAA / польского закона о компьютерных преступлениях** — мы используем валидные креды владельца с его явного согласия. Но это **техническое нарушение Booksy Terms of Service** (пункт «You may not use automated means to access the Service»).

Митигации:

- Юзер явно соглашается передать креды нам — UX делает это очевидным
- Мы не реверс-энжинирим обфусцированный код Booksy — используем endpoint'ы, которые открыто отдаются их фронту в обычной сессии
- Hosted в EU (Frankfurt), не транзитим данные через US
- В случае cease-and-desist от Booksy — выключаем интеграцию через kill-switch (env var `BOOKSY_INTEGRATION_DISABLED`)

## Технические риски

1. **Booksy меняет sitekey/API/headers** → импорт ломается. Митигация: error-логирование + email-алерт владельцу + быстрая ручная починка (мы не зависим от Booksy SDK).
2. **Datacenter IP rate-limit** → 429. Митигация: cron-tick раз в N минут (юзер выбирает 2-1440), per-salon throttling через rendezvous-token expiry.
3. **hCaptcha sitekey станет domain-restricted** → форма перестанет принимать токен. Митигация: fallback на ручную вставку access_token из DevTools (action `login_with_token` остаётся живым в edge function, скрыт в UI до момента когда понадобится).
4. **Юзер меняет пароль в Booksy** → access_token expires → next sync получает 401. Митигация: помечаем интеграцию `status='error'`, юзер заходит, нажимает «Подключить заново», вводит новый пароль.

## Что хранится у нас

- `salon_integrations.credentials.access_token` — Booksy access_token (Bearer-style). Не шифруется на app-уровне (см. ADR 002 Pragmatic Privacy) — защищается через RLS + at-rest encryption Supabase. Токен короткоживущий (~30 дней).
- `salon_integrations.credentials.business_id` — public ID
- `staff/services/clients/visits.external_id` + `external_source='booksy'` — Booksy IDs для idempotent re-sync
- `visits.group_key='booksy:appt:{uid}'` — для UI группировки multi-service записей

## Эскалация

Если Booksy блокирует наш auth-flow (например через user-agent fingerprinting или новую серверную валидацию hCaptcha), переходим на **Playwright + visual VNC** (Метод 2 из их API исследования) — у KIK уже есть рабочая реализация в `services/sessiond.py`, которую можно поднять как отдельный микросервис на VPS. ~1 неделя работы.

Параллельно подаём заявку на партнёрский API Booksy (если откроют) — но это путь на год+.
