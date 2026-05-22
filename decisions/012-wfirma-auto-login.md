# 012 — wFirma auto-login через web-flow + ручной fallback (Hybrid X3)

**Статус:** Принято · 2026-05-08
**Контекст:** wFirma API (`api2.wfirma.pl`) требует 3 ключа: `accessKey`, `secretKey` (юзерские, 32 hex) + `appKey` (наш, общий для всех инсталляций Finkley). Юзер должен сгенерировать пару `accessKey`/`secretKey` сам в **Ustawienia → OAuth → Klucze API**, что:

- требует от юзера 5 кликов и попасть в нужную скрытую панель
- блокирует подключение для пользователей, кто не разработчик и не привык к словам «API key»
- при этом **публичной OAuth-flow для генерации ключей у wFirma нет** — только ручной экран в UI

В bookysync-bot (предшественник) принят visible login через email+password (`services/wfirma_web.py` → cookie-сессия), но там это для OCR через web-панель, не для автоматической генерации API-ключей. Реверс UI wFirma из HAR-файла (см. сессию 2026-05-08) показал, что **процесс создания ключа в их web-панели — стандартная multipart-форма + sudo-confirmation паролем**, технически воспроизводится.

## Решение

**Hybrid X3:** в connect-диалоге wFirma даём два таба:

1. **«Быстрое подключение» (X2 — auto-login)** — юзер вводит email+password от wfirma.pl, Edge Function в фоне проходит весь UI-flow и достаёт пару ключей.
2. **«Ввести ключи вручную» (X1 — manual)** — юзер сам копирует `accessKey`/`secretKey`/`companyId` из wfirma.pl и вставляет.

Дефолт — таб «Быстрое подключение». Фолбэк на ручной — для юзеров с включённой 2FA в wFirma и для случаев, когда X2 ломается (wFirma поменяли форму).

### X2: auto-login flow (8 шагов)

Edge Function `wfirma-proxy` действие `connect_with_login`:

| #   | Метод | URL                                                                                                                                              | Что делает                                                                                                             |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | POST  | `wfirma.pl/logowanie` form-data `data[User][login]`+`data[User][password]`                                                                       | login, получаем cookie `SESSION_WFIRMA_PL`                                                                             |
| 2   | GET   | `wfirma.pl/user_companies/indexTable`                                                                                                            | определяем `company_id` (если в аккаунте только одна фирма — берём её; если несколько — возвращаем выбор пользователю) |
| 3   | GET   | `wfirma.pl/user_companies/login/{company_id}`                                                                                                    | вход в выбранную фирму, парсим `<body data-token>` → `X-Wf-Token`                                                      |
| 4   | GET   | `wfirma.pl/api_user_keys/add/` (с X-Wf-Token + cookie)                                                                                           | загружаем форму создания ключа, читаем свежий form-token из её HTML                                                    |
| 5   | POST  | `wfirma.pl/api_user_keys/add?dialogbox=1` multipart `data[ApiUserKey][app_name]`=«Finkley»+`CompanyContext[company_id]`                          | 302 → `/users/sudo?...&redirectStackId={STACK_ID}`                                                                     |
| 6   | GET   | `wfirma.pl/users/sudo?...&redirectStackId={STACK_ID}`                                                                                            | загружаем sudo-форму, читаем sudo-token                                                                                |
| 7   | POST  | `wfirma.pl/users/sudo?redirectStackId={STACK_ID}&dialogbox=1&ajax=1` multipart `data[User][password_auth]`=password+`CompanyContext[company_id]` | 302 → `/api_user_keys/add?...&redirectStackBack=1`                                                                     |
| 8   | GET   | `wfirma.pl/api_user_keys/add?...&redirectStackBack=1&ajax=1`                                                                                     | JSON с `redirect:/api_user_keys/confirmView/{NEW_ID}`                                                                  |
| 9   | GET   | `wfirma.pl/api_user_keys/confirmView/{NEW_ID}`                                                                                                   | HTML с access+secret keys (показ ОДИН раз, парсим regex'ом)                                                            |

Парные ключи валидируем сразу через `POST api2.wfirma.pl/companies/find` — если 200 + `<status>OK</status>`, сохраняем в `salon_integrations.credentials`.

Пароль **не сохраняется** — используем один раз для генерации ключа и сразу выкидываем из памяти Edge Function.

### Имя приложения в wFirma

Хардкод: `Finkley`. У юзера в его wFirma в списке Klucze API будет видна одна запись «Finkley» — он понимает, чьи это ключи, и может в любой момент удалить (=отозвать).

### Деградация X2 → X1

Edge Function возвращает явные коды ошибок, фронт показывает таб «Ручной ввод» и подсветку:

- `wfirma_login_failed` — неверные креды или 2FA → подсветить «Ручной ввод» + ссылку на инструкцию по 2FA
- `wfirma_no_companies` — у юзера в wFirma 0 фирм (новый аккаунт) → «сначала добавь фирму в wFirma»
- `wfirma_multiple_companies` — несколько фирм, нужен выбор → возвращаем список + UI шаг «выбери фирму»
- `wfirma_form_changed` — wFirma изменили UI, наш парсер сломался → авто-фолбэк на ручной + Sentry alert
- `wfirma_captcha` — wFirma поставили captcha на login (не наблюдается на 2026-05-08, но возможно) → авто-фолбэк на ручной

### Kill-switch

Env var `WFIRMA_AUTO_LOGIN_DISABLED=1` отключает X2-таб глобально. UI показывает только «Ручной ввод». Используется, если wFirma поменяли что-то критическое и мы ждём пока починим.

## Юридический риск (gray-zone)

Это **не нарушение CFAA** и не computer-misuse — мы используем валидные креды юзера с его явного, осознанного согласия (UI явно говорит «введи логин/пароль от wFirma, мы пройдём за тебя экран генерации ключа»). Риск чисто **по ToS wFirma** (пункт «automated access only via documented API»):

| Риск                                                      | Митигация                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| wFirma меняет UI/маршруты → парсер ломается               | Auto-fallback на X1 (ручной), Sentry alert владельцу, ручная починка ~1 час                                                                                                                                                        |
| wFirma ставят captcha на login                            | Auto-fallback на X1                                                                                                                                                                                                                |
| wFirma жалуются по ToS                                    | Kill-switch `WFIRMA_AUTO_LOGIN_DISABLED=1`, X1 остаётся работать. Параллельно — заявка в wFirma на партнёрскую программу                                                                                                           |
| wFirma детектят серверные curl от нас и блокируют по IP   | Запросы идут от Supabase Edge Functions (Frankfurt), типичный fingerprint облачного сервера. **Митигация:** Supabase IP не персональный, не привязан к юзеру, и не нарушает антифрод. Если заблокируют — kill-switch + X1 остаётся |
| wFirma меняют формат ключей или вводят time-limited ключи | Документация API — мы её мониторим, обновляем код за ~1 день                                                                                                                                                                       |

Hosted в EU (Frankfurt), не транзитим данные через US. Cease-and-desist от wFirma → kill-switch + переход на X1-only до договора с ними.

## Что хранится у нас

См. [ADR-011](./011-wfirma-credentials-encryption.md): `salon_integrations.credentials` jsonb с зашифрованным `secret_key_enc` и plaintext `access_key`/`company_id`/`company_nip`/`company_name`/`connected_via`.

Пароль wFirma юзера **не сохраняется ни в каком виде** — даже не передаётся между Edge Function вызовами. Используется только в один проход X2-flow и тут же выкидывается.

## Альтернативы, которые рассматривали

- **X1 only (всегда ручной ввод).** Отклонено: значимый барьер на онбординге для не-разработчиков. Бот доказал, что юзер скорее уйдёт, чем найдёт «Klucze API».
- **X2 only (только auto-login).** Отклонено: режет юзеров с 2FA wFirma и ставит нас в полную зависимость от стабильности их UI.
- **Headless Playwright + sessiond (как для Booksy fallback).** Избыточно: wFirma — POST/GET без реального JS, чистый curl с правильными header'ами достаточно. ~€5/мес инфры на ровном месте.
- **Заявка на партнёрский API wFirma.** Параллельно подаём, но это путь на месяцы. До интеграции на партнёрке Hybrid X3 решает проблему.

## Последствия

### Положительные

- 95% юзеров проходят onboarding за 30 секунд (email+password) вместо ~5 минут поисков клавиш в API
- 5% юзеров с 2FA или сломанным X2 не получают ошибку, а видят ручной таб
- Пароль wFirma не задерживается в системе

### Отрицательные

- Завязка на стабильность UI wFirma. Когда сломается — ручная починка ~1 час.
- В wFirma юзера будет висеть запись «Finkley» в Klucze API. Косметически — хорошо (видно, чьи), но при отзыве (delete) интеграция отвалится без предупреждения. Документируем в FAQ.
- Дополнительные ~5–8 секунд на onboarding из-за 9 шагов (vs 1 шаг X1). Но юзер их не делает руками — просто loader.

### Что мониторим (Sentry)

- `wfirma_login_failed` rate >5% за день → алерт владельцу
- `wfirma_form_changed` любой случай → алерт сразу (значит парсер сломан)
- Среднее время прохождения 9-шагового flow >15 секунд → wFirma тормозит, проверить таймауты
- Если через 1 месяц после лонча wFirma официально пишут нам с возражением — выкатываем kill-switch и переходим на партнёрскую программу

## Ссылки

- [ADR-008 Booksy integration](./008-booksy-integration.md) — аналогичная gray-zone, паттерн kill-switch
- [ADR-011 wFirma credentials encryption](./011-wfirma-credentials-encryption.md) — что и как храним
