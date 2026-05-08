# 011 — Шифрование wFirma credentials (AES-256-GCM)

**Статус:** Принято · 2026-05-08
**Контекст:** Booksy access_token живёт ~30 дней (severity = medium) и хранится plaintext в `salon_integrations.credentials` jsonb под защитой RLS + at-rest. Для wFirma такой подход недостаточен:

- `secret_key` wFirma **бессрочный** (юзер генерирует один раз и не меняет)
- Доступ через wFirma API даёт чтение/запись фактур, контрагентов, бухгалтерии и — что важнее всего — может писать в KSeF от имени фирмы
- При утечке БД (или скомпрометированного service-role-key) plaintext-`secret_key` = долговременный root-доступ к финансам юзера
- ADR-002 «Pragmatic Privacy» уже постулировала application-level encryption для **секретов интеграций**; для Booksy от неё отступили (комментарий в миграции `20260508000010`), для wFirma — возвращаемся к ней

## Решение

`secret_key` wFirma шифруется **AES-256-GCM** перед записью в `salon_integrations.credentials`.

### Структура `credentials` для wFirma

```jsonc
{
  "access_key": "a09994e4505b6195ac16b0617e5e25c9", // plaintext, public-ish identifier
  "secret_key_enc": "<base64(iv||ciphertext||tag)>", // AES-256-GCM
  "company_id": "884136",                            // plaintext, не секрет
  "company_nip": "7831854263",                       // plaintext, для auto-match push
  "company_name": "Wonderful Beauty Sp. z o. o.",    // plaintext, для UI
  "connected_via": "auto_login" | "manual"           // источник, для отладки и метрик
}
```

### Ключ шифрования

- Имя secret в Supabase: `WFIRMA_SECRETS_KEY`
- 32 байта, base64-encoded (генерируется `openssl rand -base64 32`)
- Хранится в Supabase Edge Function secrets (не в репо, не в `.env.example`)
- Доступен **только** в Edge Function `wfirma-proxy` через `Deno.env.get('WFIRMA_SECRETS_KEY')`

Отдельный ключ от существующего `SECRETS_ENCRYPTION_KEY` намеренно — шифр wFirma изолирован, ротация одного не задевает другие интеграции (когда они появятся).

### Алгоритм

- AES-256-GCM (WebCrypto `crypto.subtle`, доступен в Deno нативно)
- IV: 12 случайных байт на каждую запись
- AAD: пустая (auth tag в GCM достаточно)
- Format в БД: `base64(iv ‖ ciphertext ‖ auth_tag)` — auth_tag клеит WebCrypto в конец `ciphertext` автоматически, так что фактический формат `base64(iv ‖ ciphertext_with_tag)`

### Что **не** шифруется

`access_key`, `company_id`, `company_nip`, `company_name` — не секреты. wFirma API требует **обе** части (accessKey + secretKey + appKey), без secretKey один accessKey бесполезен. Хранить access_key plaintext позволяет:

- видеть в БД, какое приложение wFirma подключено, без расшифровки (для саппорта)
- быстро сравнить: при повторном подключении — это новая пара или старая

### Ротация ключа `WFIRMA_SECRETS_KEY`

При компрометации:

1. Генерируем новый ключ
2. Edge Function на старте читает оба: `WFIRMA_SECRETS_KEY` + `WFIRMA_SECRETS_KEY_PREV`
3. При расшифровке пробуем сначала новый, при неудаче — старый
4. При успешной расшифровке старым — сразу перешифровываем новым и записываем
5. Через 7 дней удаляем `WFIRMA_SECRETS_KEY_PREV`

Реализация ротации не входит в первый PR — добавим **только если** ключ скомпрометирован. До этого — пишем код так, чтобы добавить было легко (helper-функции `encrypt`/`decrypt` параметризованы по ключу).

## Альтернативы, которые рассматривали

- **Хранить как Booksy (plaintext jsonb).** Отклонено: severity слишком высокая (см. контекст). Booksy-token хоть и в plaintext, но протухает за 30 дней; wFirma `secret_key` не протухает никогда.
- **pgsodium server-side encryption.** Отклонено для MVP: pgsodium требует расширения, миграции существующих данных при отключении/включении, и менее очевидной операционки. AES в Edge Function — банальнее и легче ротации. К pgsodium вернёмся, если интеграций станет 5+.
- **Supabase Vault (encrypted secrets table).** Отклонено: Vault — про секреты приложения, не про per-row юзерские. Один `secret_key` per salon в Vault → таблица растёт линейно, ad-hoc API.
- **Хранить только short-lived OAuth refresh-token.** Отклонено: wFirma не предоставляет OAuth-flow для accessKey/secretKey. Только статические ключи, никакого refresh-протокола.

## Последствия

### Положительные

- Утечка БД сама по себе не даёт доступа к wFirma юзеров — атакующему нужен ещё `WFIRMA_SECRETS_KEY` из Edge Function secrets (отдельный security boundary)
- Соответствует ADR-002 в части секретов интеграций
- Готовый паттерн encryption-helper'ов можно переиспользовать для будущих интеграций (например, ZUS PUE при подключении к госуслугам)

### Отрицательные

- +1 secret в продуктовом конфиге (`WFIRMA_SECRETS_KEY`). Документация деплоя и онбординга оператора чуть длиннее.
- Дешифровка добавляет ~1–2 ms на каждый запрос wFirma в Edge Function. Незаметно при rate=1 push/min.
- Если `WFIRMA_SECRETS_KEY` потеряем безвозвратно — все юзеры потеряют связь с wFirma и должны переподключиться (auto-login или ручной ввод). **Митигация:** ключ хранится в Supabase Vault Edge Function secrets (managed бэкапы) + продублирован в 1Password владельца (он лично отвечает за бэкап).

### Что мониторим

- Если в Sentry начнут массово появляться `WFIRMA_DECRYPT_FAILED` — значит ключ ротировали без миграции старых записей; катимся откатом или активируем dual-key логику
- Если Supabase официально докатит column-level encryption на jsonb — в V2 заменяем самописное на их

## Ссылки

- [ADR-002 Pragmatic Privacy](./002-encryption-strategy.md)
- [Миграция дропа integration_credentials](../supabase/migrations/20260508000010_drop_unused_integration_credentials.sql) — комментарий явно отсылал к этому ADR
- [WebCrypto AES-GCM в Deno](https://docs.deno.com/runtime/manual/runtime/web_platform_apis/#web-cryptography)
