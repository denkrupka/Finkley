# Testing Strategy

## Принципы

1. **Тестируем то, что ломает прод.** Не тестируем геттеры и тривиальную отрисовку.
2. **Пирамида тестов:** много юнит-тестов, средне интеграционных, мало E2E.
3. **Тесты должны быть быстрыми.** Юнит ≤100ms, E2E ≤30s на сценарий.
4. **Тесты — часть Definition of Done.** PR без тестов на новую логику не мержится.
5. **Когда баг — сначала пишем failing тест, потом фиксим.** Чтобы баг не вернулся.

## Стек

- **Vitest** — юнит и интеграционные тесты (быстрее Jest, нативная поддержка ESM)
- **Testing Library (React)** — для тестов компонентов
- **Playwright** — E2E тесты в реальном браузере
- **pgtap** — тесты RLS-политик и RPC-функций в Postgres
- **MSW** — mock внешних API в тестах (опционально, для интеграционных)

## Что покрываем

### Юнит-тесты (Vitest)

**Нужны для:**

- Чистые функции в `lib/` (форматирование, расчёты)
- Zod-схемы валидации (что отвергает невалидные значения)
- Hooks с нетривиальной логикой
- Компоненты с условным рендерингом и сложной логикой состояния

**Не нужны для:**

- Презентационных компонентов (`<Button>` — это shadcn, мы не его тестируем)
- Тривиальных wrapper-компонентов
- "100% coverage ради coverage"

#### Примеры

```typescript
// lib/utils/format-currency.test.ts
import { describe, it, expect } from 'vitest'
import { formatCurrency } from './format-currency'

describe('formatCurrency', () => {
  it('forms integer cents to PLN', () => {
    expect(formatCurrency(10000, 'PLN', 'ru')).toBe('100,00 zł')
  })

  it('handles zero', () => {
    expect(formatCurrency(0, 'EUR', 'ru')).toBe('0,00 €')
  })

  it('handles negative (loss)', () => {
    expect(formatCurrency(-5000, 'PLN', 'ru')).toBe('-50,00 zł')
  })

  it('handles large numbers without scientific notation', () => {
    expect(formatCurrency(99999999_99, 'PLN', 'ru')).toBe('99 999 999,99 zł')
  })
})
```

```typescript
// lib/validation/visit-schema.test.ts
import { describe, it, expect } from 'vitest'
import { visitSchema } from './visit-schema'

describe('visitSchema', () => {
  it('accepts valid visit', () => {
    const result = visitSchema.safeParse({
      visit_at: new Date(),
      staff_id: 'uuid',
      service_id: 'uuid',
      amount_cents: 10000,
      payment_method: 'cash',
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative amount', () => {
    const result = visitSchema.safeParse({
      visit_at: new Date(),
      amount_cents: -100,
      payment_method: 'cash',
    })
    expect(result.success).toBe(false)
  })

  it('rejects future date beyond reasonable', () => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 2)
    const result = visitSchema.safeParse({
      visit_at: future,
      amount_cents: 100,
      payment_method: 'cash',
    })
    expect(result.success).toBe(false)
  })
})
```

### Интеграционные тесты компонентов

```typescript
// components/domain/VisitForm.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VisitForm } from './VisitForm'

describe('VisitForm', () => {
  it('shows validation error for empty amount', async () => {
    render(<VisitForm salonId="test" onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }))

    await waitFor(() => {
      expect(screen.getByText(/сумма обязательна/i)).toBeInTheDocument()
    })
  })

  it('calls onSuccess after valid submission', async () => {
    const onSuccess = vi.fn()
    render(<VisitForm salonId="test" onSuccess={onSuccess} />)

    // ... заполнить форму ...
    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })
})
```

### RLS-тесты (через Vitest + Supabase JS)

**Критически важны.** Один баг в RLS = утечка между тенантами.

```typescript
// tests/rls/salons.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY!

describe('salons RLS', () => {
  let userA: { id: string; token: string }
  let userB: { id: string; token: string }
  let salonA: string

  beforeAll(async () => {
    userA = await createTestUser('a@test.com')
    userB = await createTestUser('b@test.com')
    salonA = await createTestSalon(userA, 'Salon A')
  })

  it('user A can read own salon', async () => {
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${userA.token}` } },
    })
    const { data } = await supa.from('salons').select().eq('id', salonA).single()
    expect(data).toBeDefined()
    expect(data!.name).toBe('Salon A')
  })

  it('user B cannot read user A salon', async () => {
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${userB.token}` } },
    })
    const { data } = await supa.from('salons').select().eq('id', salonA).maybeSingle()
    expect(data).toBeNull()
  })

  it('user B cannot update user A salon', async () => {
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: `Bearer ${userB.token}` } },
    })
    const { error } = await supa.from('salons').update({ name: 'Hacked' }).eq('id', salonA)
    // RLS возвращает success, но 0 rows affected
    const { data } = await supa.from('salons').select().eq('id', salonA).maybeSingle()
    expect(data).toBeNull() // user B всё ещё не видит
  })
})
```

**Покрытие RLS-тестами обязательно для каждой таблицы перед мерджем миграции.**

### E2E тесты (Playwright)

**Покрываем критические флоу.** Не каждую страницу, а **что произойдёт катастрофа если сломается**.

#### Стадия 1 — обязательные E2E

1. **signup → email confirm → login → logout**
2. **signup → onboarding → создание салона → редирект на дашборд**
3. **создание визита через bottom sheet → проверка появления на дашборде**
4. **создание расхода → проверка обновления прибыли**
5. **переключение периода на дашборде → проверка цифр**
6. **триал → checkout (с тестовой картой) → подписка активна**
7. **отмена подписки через customer portal → read-only режим**

#### Пример

```typescript
// tests/e2e/signup-onboarding.spec.ts
import { test, expect } from '@playwright/test'

test('user can sign up and complete onboarding', async ({ page }) => {
  // signup
  await page.goto('/signup')
  await page.getByLabel('Email').fill(`test-${Date.now()}@example.com`)
  await page.getByLabel('Пароль').fill('SecurePass123!')
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()

  // в реальном тесте — confirm email через test inbox (Mailtrap или Postmark sandbox)
  // Здесь упрощаем — assume auto-confirm в test mode Supabase

  // onboarding
  await expect(page).toHaveURL('/onboarding')
  await page.getByLabel('Название салона').fill('Test Salon')
  await page.getByRole('button', { name: 'Далее' }).click()

  await page.getByLabel('Страна').selectOption('PL')
  await page.getByRole('button', { name: 'Далее' }).click()

  await page.getByLabel('Тип салона').selectOption('hair')
  await page.getByRole('button', { name: 'Далее' }).click()

  // skip мастеров
  await page.getByRole('button', { name: 'Пропустить' }).click()

  await page.getByRole('button', { name: 'Открыть дашборд' }).click()

  // дашборд
  await expect(page).toHaveURL(/\/[a-f0-9-]+\/dashboard/)
  await expect(page.getByText('Прибыль')).toBeVisible()
})
```

### pgtap тесты (для RPC-функций)

```sql
-- supabase/tests/dashboard_kpis_test.sql
begin;

select plan(3);

-- Setup
insert into salons (id, name, country_code, salon_type, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'Test', 'PL', 'hair', auth.uid());

insert into visits (salon_id, amount_cents, visit_at, payment_method, status) values
  ('11111111-1111-1111-1111-111111111111', 10000, now(), 'cash', 'paid'),
  ('11111111-1111-1111-1111-111111111111', 5000, now() - interval '1 day', 'card', 'paid'),
  ('11111111-1111-1111-1111-111111111111', 3000, now() - interval '40 day', 'cash', 'paid');

-- Test 1: revenue за последний день включает только сегодняшний визит
select results_eq(
  $$ select revenue_cents from dashboard_kpis(
       '11111111-1111-1111-1111-111111111111',
       now() - interval '1 day',
       now() + interval '1 day'
     ) $$,
  $$ values (15000::bigint) $$,
  'revenue за последние 24ч учитывает оба свежих визита'
);

-- Test 2: visits_count корректен
select results_eq(
  $$ select visits_count from dashboard_kpis(
       '11111111-1111-1111-1111-111111111111',
       now() - interval '50 day',
       now() + interval '1 day'
     ) $$,
  $$ values (3::bigint) $$,
  'visits_count = 3 для всего периода'
);

-- Test 3: cancelled visits не считаются в revenue
update visits set status = 'cancelled' where amount_cents = 10000;
select results_eq(
  $$ select revenue_cents from dashboard_kpis(
       '11111111-1111-1111-1111-111111111111',
       now() - interval '1 day',
       now() + interval '1 day'
     ) $$,
  $$ values (5000::bigint) $$,
  'cancelled visit исключен из revenue'
);

select * from finish();
rollback;
```

## CI

`.github/workflows/ci.yml` запускает:

```yaml
- run: pnpm typecheck
- run: pnpm lint
- run: pnpm test # Vitest
- run: pnpm test:e2e --reporter=line # Playwright
- run: pnpm build
```

E2E тесты на CI требуют запуска dev-сервера и тестового Supabase. Можно использовать Supabase staging проект с pre-seeded data.

## Test Database

Для RLS-тестов и E2E нужна БД с известным состоянием:

1. **Локально:** `pnpm supabase start` — локальный Postgres + Auth
2. **CI:** Github Actions service container или удалённый staging Supabase
3. **`pnpm supabase db reset`** перед каждым тестом-сьютом — сбрасывает + применяет миграции

## Test data factories

`tests/factories/` — функции создания тестовых сущностей:

```typescript
// tests/factories/user.ts
export async function createTestUser(email?: string) {
  const finalEmail = email ?? `test-${crypto.randomUUID()}@example.com`
  const { data } = await supabaseAdmin.auth.admin.createUser({
    email: finalEmail,
    password: 'TestPass123!',
    email_confirm: true,
  })
  return { id: data.user!.id, email: finalEmail /* токен через signIn */ }
}

// tests/factories/salon.ts
export async function createTestSalon(user: TestUser, overrides = {}) {
  // ... insert через service-role + создать salon_member
}
```

## Что НЕ тестируем

- Код Supabase, Stripe, Postmark — это их ответственность
- Сетевые сбои (моки достаточны для unit, E2E run with retry)
- Поведение Tailwind / shadcn — они тестируются у себя
- Performance — отдельная задача (Lighthouse CI), не классические тесты

## Метрики качества

| Метрика             | Цель                                                |
| ------------------- | --------------------------------------------------- |
| Coverage статистика | Не отслеживаем процент. Покрываем критичную логику. |
| RLS-тесты           | 100% таблиц покрыты тестом изоляции                 |
| E2E время           | <5 минут для полного прогона                        |
| Юнит время          | <30 секунд на весь run                              |
| Flaky tests         | 0 на CI. Если flaky — fix или delete.               |

## Что делать когда тест мешает

Иногда тест мешает рефакторингу. Опции в порядке предпочтения:

1. **Тест прав, код был не прав** — фиксим код
2. **Тест проверяет implementation, а не behavior** — переписываем тест проверять behavior
3. **Тест устарел из-за изменения требований** — переписываем тест под новые требования
4. **Тест бесполезный** — удаляем (но честно, с коммитом "remove obsolete test: <reason>")

**НЕ делаем:**

- ❌ `it.skip(...)` без followup тикета удалить или починить
- ❌ Комментирование тестов "потом починим"
- ❌ `expect(true).toBe(true)` чтобы зелёный был

## Pre-commit хуки

Через husky + lint-staged:

- `prettier --write` на staged файлы
- `eslint --fix` на staged файлы
- Полный `pnpm typecheck` и `pnpm test` слишком долго для pre-commit, оставим CI

## Pre-push хук

Запускает `pnpm test` (только unit, не E2E) — чтобы не пушить заведомо красное.
