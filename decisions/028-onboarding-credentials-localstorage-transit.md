# ADR-028: Credentials онбординга — транзит через localStorage в /settings/integrations

## Статус

`Accepted`

Дата: 2026-05-29

## Контекст

В онбординге юзер заполняет credentials провайдеров (Booksy email+password,
wFirma email+password и т.д.) в `ConnectIntegrationDialog`. Реальное
подключение интеграции происходит **после** создания салона: онбординг
делает RPC `create_salon_with_setup`, затем navigate на
`/settings/integrations?prompt=<providers>`, где каждый connect-dialog
делает свой OAuth/credentials flow.

Проблема: между submit'ом онбординга и открытием connect-dialog в settings
credentials нужно как-то передать. Варианты транзита:

## Решение

`localStorage` под ключом `finkley:onboarding:credentials:<salon_id>`.

Структура:

```json
{
  "booksy": { "email": "...", "password": "..." },
  "wfirma": { "email": "...", "password": "..." }
}
```

Контракт через helper `consumeOnboardingCredentials(salonId, provider)`:

- One-shot чтение: после consume credentials удаляются из storage.
- Per-salon isolation: ключ содержит salon_id, чтобы один владелец
  с несколькими салонами не получил кросс-фид.
- Возвращает `null` если данных нет (graceful — connect dialog остаётся
  пустым, юзер вводит вручную).

Connect dialog'и в `/settings/integrations`
(`BooksyConnectDialog`, `WfirmaConnectDialog`, etc.) при mount читают свои
credentials через consume и pre-fill поля. Юзер сразу видит заполненную
форму, жмёт «Подключить» — реальный OAuth/login flow срабатывает.

## Альтернативы, которые рассматривали

- **URL query params** — отклонён: credentials в URL попадают в history,
  Sentry breadcrumbs, server access logs. Утечка.
- **POST в state-сервис** (server-side ephemeral) — отклонён: лишний
  endpoint, требует TTL, redirect через server. Сложность не оправдана.
- **React Context через провайдер вокруг роутера** — отклонён: онбординг
  и settings — разные routes, потеряется при navigate (новый mount).
- **Зашифрованный cookie с TTL 5 мин** — отклонён: для каждого провайдера
  нужен отдельный cookie или один большой, сервер не использует — overkill.

## Последствия

### Положительные

- Нулевая инфра: только localStorage + 2 helper-функции.
- One-shot consume = минимальное окно exposure: после первого открытия
  connect-dialog credentials исчезают из storage.
- Тестируемо (вся логика в pure helper, см. `lib/onboarding-credentials.test.ts`).
- Backward-compatible: если localStorage пуст (юзер уже подключал ранее
  или приватный режим), connect-dialog'и работают как раньше — юзер
  вводит вручную.

### Отрицательные

- Credentials в localStorage в plain-text. Минимизировано тем, что
  consume вызывается СРАЗУ при открытии connect-dialog (юзер обычно
  кликает в течение секунд после редиректа). При закрытии connect-dialog
  без подтверждения — credentials уже удалены, повторно вводить.
- Не работает между разными origin'ами (но мы single-origin SaaS).
- Не работает если юзер закрывает вкладку между submit и
  /settings/integrations (но мы делаем `navigate(...)` синхронно, риск
  нулевой).

### Что мониторим

- Если юзеры жалуются что credentials не подхватываются — проверять
  `localStorage.length` в /settings/integrations mount.
- Если будут утечки credentials в Sentry breadcrumbs — переносить
  на in-memory передачу через router state.
- Через 6 месяцев — пересмотреть на server-side ephemeral если будут
  жалобы на UX.
