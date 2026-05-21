# ADR-019: FlySMS-style сбор отзывов после визита

## Статус

`Accepted`

Дата: 2026-05-21

## Контекст

После оплаченного визита нужно автоматически просить клиента оставить
отзыв и **не дать негативу попасть в публичный Google**, при этом
сохранить негатив для внутренней работы (Reports/Отзывы). Образец —
FlySMS / Trustmary / Birdeye flow: одна SMS+email с короткой ссылкой,
1-5 звёзд, 5★ → Google Maps, 1-4★ → внутренний отзыв.

Особенности нашей среды:

- Public endpoint без user JWT (клиент не зарегистрирован в Finkley).
- Защита от спама и подделки: токен в URL = единственный auth.
- Локализация: страница и письмо должны быть на языке салона
  (`salons.locale` → ru/pl/en).
- SMS — опционально (FlySMS/Twilio через `SMS_PROVIDER` env);
  если не настроено, только email.

## Решение

**Двухтабличная схема:**

- `review_requests(id, salon_id, visit_id, client_id, token, expires_at,
opened_at, submitted_at)` — invitation. Один запрос на визит.
- `reviews(id, salon_id, source, visibility, rating, body, ...)` —
  собственно отзывы. `source IN ('internal', 'booksy', 'google')`,
  `visibility IN ('private', 'public')`.

**Flow:**

```
[paid visit] →
  cron send-review-request (6h) →
    INSERT review_requests (token = UUID без дефисов)
    + Resend email (locale-aware HTML)
    + опц. SMS (sendSms из _shared/sms.ts)

[клиент кликает ссылку] →
  GET review-submit?token=... →
    Update opened_at
    Return { salon: {name, logo_url, google_place_url, locale} }

[клиент выбирает звёзды] →
  POST review-submit { token, rating } →
    rating === 5  → submitted_at = now(); return google_place_url
    rating  1-4   → submitted_at = now(); INSERT reviews(source='internal',
                    visibility='private', rating, body, author_name)
                    [внутренний негатив, не публичный]
```

**Ключевые решения:**

1. **5★ → не сохраняем в reviews**, только редирект на Google. Иначе
   получили бы дубликаты (один отзыв в reviews + потом он же в Google
   через cron `reviews-sync`). Сохраняем `submitted_at` для антидубля.

2. **1-4★ → `source='internal', visibility='private'`.** Эти отзывы
   видит только команда салона через Reports/Отзывы → Внутренние.
   В публичные API (Booksy/Google) не уходят. Чтобы клиент не оставил
   негатив дважды — `submitted_at` блокирует повторный POST.

3. **Token = UUID без дефисов (32 hex).** Короче в URL, всё ещё 128 бит
   энтропии. Уникальный индекс на `review_requests.token`. TTL 30 дней
   (`expires_at`); после истечения форма недоступна.

4. **Anti-dup на стороне cron.** `send-review-request` ищет paid визиты
   за 24h, и для каждого проверяет что `review_requests` для этого
   `visit_id` ещё нет. Простой WHERE NOT EXISTS, не нужно distributed
   lock.

5. **Локализация письма** — `pickLocale(salon.locale, salon.country_code)`
   с fallback на ru. Тексты в массиве `REVIEW_TEXTS[ru|pl|en]` прямо
   в edge function (а не в react-i18next): функция не имеет доступа
   к JSON-локалям приложения, и инфраструктура для DB-локалей в
   edge функциях overkill для трёх строк.

6. **5★ редирект — `salon.google_place_url`.** Если не заполнен —
   страница показывает «спасибо» без редиректа (graceful degrade).
   В Settings → Профиль есть инпут с подсказкой.

## Альтернативы, которые рассматривали

- **Сразу публикация в Google всех отзывов** — отклонено: бизнес-цель
  была обратной (фильтровать негатив).
- **Trustmary / Birdeye SaaS** — €50-200/мес. Отклонено: владелец
  ограничил MVP budget €20/мес.
- **Один эндпоинт без `review_requests` таблицы** — отклонено:
  невозможно отделить «послали приглашение» от «клиент откликнулся»
  для аналитики (opened_at/submitted_at), и нечем защититься от
  brute-force гипотетического `/review?visit_id=...`.
- **Хранить 5★ отзывы тоже в `reviews`** — отклонено: дубликаты с
  тем что приходит через `reviews-sync` из Google API.

## Последствия

### Положительные

- Негативные отзывы остаются внутри, владелец видит проблемы первым.
- Антидубль (`submitted_at` + unique token) исключает спам.
- Локализация работает по `salon.locale` без зависимости от
  react-i18next.
- Расширяемо: добавление SMS-провайдеров через `_shared/sms.ts`
  без правки бизнес-логики.

### Отрицательные

- 5★ клиенты могут не дойти до Google (не клик / не залогинен в
  Google). Конверсия редиректа — на 30-60% от тех, кто поставил 5★.
- Если `google_place_url` пуст — теряем редирект. Мы покажем «спасибо»
  и клиент уйдёт без действия. Митигация: подсказка в Settings.
- Public endpoint без JWT — теоретическая поверхность атаки. Митигация:
  только два валидных метода (GET/POST), валидация token + rating,
  expires_at, `submitted_at` блок.

### Что мониторим

- Конверсия `opened_at / sent` — должна быть 30-50%. Ниже — проблема
  с письмом (спам, копирайт).
- Конверсия `submitted_at / opened_at` — должна быть 50-80%. Ниже —
  проблема с формой (UX).
- Доля 5★ → редирект на Google → реально новый Google review (через
  `reviews-sync` count delta) — это финальная конверсия флоу.
- Жалобы на спам в email → ротация Resend домена.
