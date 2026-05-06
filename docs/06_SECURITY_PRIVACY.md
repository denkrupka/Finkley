# 06. Security & Privacy

## Модель угроз

| Угроза                          | Вероятность | Воздействие | Митигация                                                      |
| ------------------------------- | ----------- | ----------- | -------------------------------------------------------------- |
| Утечка БД через SQL injection   | Низкая      | Высокое     | Параметризованные запросы Supabase JS, RLS как второй контур   |
| XSS                             | Средняя     | Высокое     | React escapes by default, Zod валидация инпутов, CSP заголовки |
| Утечка секретов в коммите       | Средняя     | Критичное   | `.gitignore`, gitleaks pre-commit, GitHub Secret Scanning      |
| Несанкц. доступ к чужому салону | Средняя     | Высокое     | RLS на каждой таблице, тесты RLS                               |
| Кража токенов Booksy/wFirma     | Низкая      | Высокое     | AES-256-GCM шифрование, ключ только в edge functions           |
| Stripe webhook spoofing         | Низкая      | Высокое     | Проверка подписи в edge function                               |
| Брутфорс логина                 | Средняя     | Среднее     | Supabase Auth rate limit (встроенный)                          |
| Перехват сессии                 | Низкая      | Высокое     | HTTPS only, Supabase session в IndexedDB                       |

## Pragmatic Privacy — наша модель

Это **сознательное архитектурное решение**, потому что E2EE взаимоисключающе с ключевыми фичами продукта (Booksy/wFirma синки, OCR через AI, бенчмарки, AI-инсайты).

### Что мы делаем

1. **Регион EU (Frankfurt).** Все данные физически в ЕС.
2. **Encryption at-rest** на стороне Supabase (AES-256 по умолчанию).
3. **TLS 1.2+ everywhere.**
4. **RLS-политики Postgres.** На уровне БД.
5. **Application-level encryption секретов интеграций** (Booksy/wFirma токены).
6. **Никаких интеграций с гос-системами.**
7. **GDPR compliance:** экспорт, удаление, исправление данных.

### Что мы НЕ обещаем

- ❌ "Сервер не может прочитать ваши данные" (это E2EE, мы не делаем)
- ❌ "Защита от инсайдерских угроз Anthropic/Supabase"
- ❌ "Анонимность"

### Что обещаем (и держим)

- ✅ "Ваши данные хранятся в ЕС, под GDPR"
- ✅ "Никаких интеграций с налоговыми системами"
- ✅ "Никто кроме вас не видит ваш дашборд прибыли"
- ✅ "Можно экспортировать или удалить все данные в любой момент"
- ✅ "Минимум сторонних сервисов, у которых ваши данные"
- ✅ "Прозрачно, кто и зачем обрабатывает ваши данные"

## Шифрование секретов

```typescript
// supabase/functions/_shared/crypto.ts
const KEY = Deno.env.get('SECRETS_ENCRYPTION_KEY')! // 32 байта base64

const keyBytes = Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0))
const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
  'encrypt',
  'decrypt',
])

export async function encryptSecret(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded),
  )
  // base64(iv + ciphertext)
  const combined = new Uint8Array(iv.length + ciphertext.length)
  combined.set(iv)
  combined.set(ciphertext, iv.length)
  return btoa(String.fromCharCode(...combined))
}

export async function decryptSecret(payload: string): Promise<string> {
  const combined = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
  const iv = combined.subarray(0, 12)
  const ciphertext = combined.subarray(12)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext)
  return new TextDecoder().decode(plaintext)
}
```

**Запускается только в edge functions.** Клиентский код этот файл не импортирует — `SECRETS_ENCRYPTION_KEY` не входит в `VITE_*` переменные и не попадает в бандл.

## RLS — как организовано

**Базовое правило:** для каждой таблицы с пользовательскими данными — политика `using (salon_id in (select salon_id from salon_members where user_id = auth.uid()))`.

**Тестирование RLS — обязательно:**

```typescript
// tests/rls.test.ts
test('user A cannot read user B salon', async () => {
  const userA = await createTestUser()
  const userB = await createTestUser()
  const salonB = await createTestSalon(userB)

  const supabaseAsA = createClient(URL, ANON_KEY, { auth: { storageKey: userA.token } })
  const { data } = await supabaseAsA.from('salons').select().eq('id', salonB.id).single()

  expect(data).toBeNull()
})
```

## GDPR

### Роли

- **Data Controller:** PL JDG <Имя>, NIP <X>
- **Data Subject:** конечный пользователь (владелица салона)
- **Data Processor:** Supabase, GitHub, Postmark, Stripe, Anthropic, Sentry, Plausible, Cloudflare

### Подпроцессоры

| Подпроцессор | Что обрабатывает             | Где          | DPA     |
| ------------ | ---------------------------- | ------------ | ------- |
| Supabase     | БД, auth, storage, functions | Frankfurt EU | ✓       |
| GitHub       | Хостинг кода + Pages         | Global edge  | ✓ (DPA) |
| Stripe       | Платежи, billing             | EU/US        | ✓       |
| Postmark     | Email                        | US           | ✓ (SCC) |
| Anthropic    | OCR                          | US           | ✓ (SCC) |
| Groq         | OCR fallback                 | US           | ✓ (SCC) |
| Sentry       | Логи ошибок                  | EU           | ✓       |
| Plausible    | Аналитика                    | EU           | ✓       |
| Cloudflare   | DNS (если включаем)          | Global       | ✓       |

### Права пользователя (GDPR Art. 15–22)

| Право              | Реализация                                        |
| ------------------ | ------------------------------------------------- |
| Access             | `/{salonId}/settings → Экспорт данных` (стадия 2) |
| Rectification      | UI для редактирования, всегда                     |
| Erasure            | Кнопка "Удалить салон" + 30 дней grace            |
| Portability        | CSV/JSON экспорт                                  |
| Restriction        | Email на `privacy@finkley.app`                     |
| Objection          | Аналогично                                        |
| Automated decision | Не применимо (AI — рекомендательные)              |

### Хранение данных

- **Активный аккаунт:** пока подписка активна
- **Cancelled подписка:** read-only 12 месяцев
- **Удалённый:** 30 дней grace, потом hard delete
- **Backups:** Supabase ежедневные, retention 30 дней
- **Sentry логи:** 90 дней
- **Postmark логи:** 45 дней

## Privacy Policy — основные пункты

```
1. Кто мы
   Finkley — продукт <Юрлицо PL>, NIP <X>, адрес <Y>.
   Контакт: privacy@finkley.app

2. Какие данные собираем
   - Регистрация: email, пароль (хеш), имя
   - Салон: имя, страна, валюта, тип
   - Работа: визиты, расходы, мастера, клиенты салона
   - Интеграции: токены Booksy/wFirma (зашифрованы)
   - Технические: IP, user agent, временные метки

3. Зачем
   - Услуга учёта
   - Биллинг (Stripe)
   - Email-уведомления (Postmark)
   - Улучшение продукта (Plausible)
   - Юр.требования (хранение фактур 5 лет в PL)

4. Где
   - Frankfurt EU (Supabase)
   - Подробный список — в разделе X

5. Кому
   - Подпроцессорам по DPA
   - Налоговым органам только по запросу
   - Третьим лицам — никогда

6. Сколько храним
   - См. раздел "Хранение данных"

7. Ваши права
   - См. раздел "Права пользователя"
   - privacy@finkley.app, ответ в 30 дней

8. Cookies
   - Только функциональные (auth)
   - Plausible — без cookies
   - Маркетинговых cookies нет → нет cookie banner

9. Изменения
   - Уведомление по email за 14 дней
```

## Cookies

В стадии 1 — **только функциональные** (Supabase auth state):

- Supabase JS использует IndexedDB, не cookies, для session storage по умолчанию
- Если включить cookies-режим — cookies httpOnly, Secure, SameSite=Lax

Cookie banner НЕ нужен (нет non-essential cookies).

## Логирование

**Что логируем:**

- HTTP коды и латентность (Sentry)
- Ошибки со stack traces (Sentry)
- Audit log (стадия 5)
- Stripe webhook events
- Supabase auth events

**Что НЕ логируем:**

- Расшифрованные секреты
- Пароли
- Содержимое OCR-результатов после обработки

**Sentry scrubbing:**

```typescript
Sentry.init({
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers['authorization']
      delete event.request.headers['cookie']
    }
    return event
  },
})
```

## Инцидент-response

1. **Утечка БД:**
   - Ротировать `SECRETS_ENCRYPTION_KEY` (потребует перешифрования всех integration_credentials)
   - Уведомить GDPR Authority в 72ч (DPIA)
   - Уведомить пользователей по email
   - Постмортем в `docs/incidents/YYYY-MM-DD.md`

2. **Утечка Stripe webhook secret:**
   - Ротировать в Stripe dashboard
   - Не критично если есть подпись валидация

3. **Скомпрометированный аккаунт:**
   - Принудительный logout (revoke refresh tokens через Supabase)
   - Email юзеру

## Чек-лист безопасности перед публичным запуском

- [ ] RLS-политики покрыты тестами для всех таблиц
- [ ] `SECRETS_ENCRYPTION_KEY` в Supabase Function secrets, не коммичен
- [ ] Stripe webhook secret в Supabase Function secrets, проверка подписи
- [ ] CSP заголовки настроены (через GitHub Pages: `_headers` или meta tag)
- [ ] HSTS включён (GitHub Pages даёт по умолчанию)
- [ ] Email DKIM/SPF/DMARC для домена настроены через Postmark
- [ ] Privacy Policy и Terms of Service опубликованы
- [ ] DPA подписаны со всеми подпроцессорами
- [ ] Контакт `privacy@finkley.app` принимает почту
- [ ] Backup Supabase verified (восстановление протестировано)
- [ ] gitleaks pre-commit hook установлен
