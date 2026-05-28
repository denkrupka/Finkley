# ADR-029: Unified onboarding storage — credentials + prompt в одном entry

## Статус

`Accepted` (supersedes ADR-028 storage shape; semantics остаются)

Дата: 2026-05-29

## Контекст

В ADR-028 мы решили хранить onboarding credentials в localStorage под
ключом `finkley:onboarding:credentials:<salon_id>` для транзита в
`/settings/integrations`. Позже добавили T179 — также сохранять `prompt`
(comma-separated provider IDs) в отдельный ключ
`finkley:onboarding:prompt:<salon_id>` чтобы Stripe Checkout cancel/success
flow восстанавливал последовательность открытия connect dialog'ов.

Два раздельных ключа создали:

- Race condition: prompt-handler в IntegrationsPage делал `setParams`
  дважды подряд (читая localStorage и затем consume первого prompt'a) →
  потенциальная потеря updates.
- Дубликат session cleanup: после онбординга нужно удалять оба ключа,
  легко забыть.
- Несогласованность в storage shape: один helper для credentials,
  отдельные `localStorage.setItem` для prompt вне helper'a.

## Решение

Один localStorage ключ `finkley:onboarding:<salon_id>` хранит JSON:

```json
{
  "credentials": {
    "booksy": { "email": "...", "password": "..." },
    "wfirma": { "email": "...", "password": "..." }
  },
  "prompt": "booksy,wfirma,ksef"
}
```

Helpers в `apps/web/src/lib/onboarding-credentials.ts`:

- `saveOnboardingTransit(salonId, { credentials?, prompt? })` — atomic
  write обоих полей за один `setItem` (не два).
- `consumeOnboardingCredentials(salonId, provider)` — one-shot чтение
  и удаление одного провайдера из credentials.
- `consumeOnboardingPrompt(salonId)` — one-shot чтение и удаление prompt.
- `peekOnboardingCredentials(salonId, provider)` — без удаления.

Когда оба поля consumed → весь storage entry удаляется автоматически.

**Backward-compat миграция.** `readStorage()` при отсутствии нового
ключа пробует прочитать legacy `finkley:onboarding:credentials:<salon>`
и `finkley:onboarding:prompt:<salon>`, мигрирует в новый формат
и удаляет legacy. Это даёт нулевой down-time для in-progress сессий
без необходимости hard-reset localStorage.

## Альтернативы, которые рассматривали

- **Оставить два ключа** — отклонён: race condition + дубликат cleanup.
- **Sessionstorage вместо localStorage** — отклонён: Stripe Checkout
  открывает новый origin tab → sessionStorage не виден после возврата.
- **Cookie с TTL 10 мин** — отклонён: cookies идут в каждый request,
  CORS preflight headers limit, credentials в network logs.

## Последствия

### Положительные

- Один helper-набор, нет дубликата setItem в OnboardingPage.
- Atomic write/read — нет race condition между двумя storage операциями.
- Backward-compat → старые юзеры не теряют свои in-progress данные.
- Тестируемо: 15 unit-тестов покрывают consume / save / migration /
  per-salon isolation / TTL-like behavior через one-shot semantic.

### Отрицательные

- Прежний ADR-028 описывает shape только для credentials — этот ADR
  поверх, но не deprecating. Читатель должен пройти оба.
- Если кто-то напишет код напрямую к `localStorage.getItem('finkley:onboarding:credentials:*')`
  (минуя helpers) — поломается после миграции. Митигация: grep CI или
  pre-commit hook. (TODO в backlog).

### Что мониторим

- Если в Sentry появятся ошибки про невалидный JSON в storage ключе —
  возможна гонка между двумя tab'ами одного юзера.
- Через 3 месяца можно удалить миграцию legacy ключей (все юзеры пройдут
  читать-write раз) — отметить в backlog.
