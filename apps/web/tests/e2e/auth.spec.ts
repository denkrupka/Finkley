import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E авторизации (TASK-05): UI login → logout, валидация форм, обработка ошибок.
 *
 * Зависимости:
 * - Реальный Supabase staging (берёт URL/ANON/SERVICE из env)
 * - Локальный dev server на :5173 (стартует webServer из playwright.config.ts)
 *
 * Стратегия: создаём тестового юзера через `auth.admin.createUser` (admin API
 * не валидирует email-формат и не шлёт реальное письмо), затем гоняем UI-флоу
 * логина и логаута через настоящий браузер. Это проверяет TASK-05 AC без
 * зависимости от настроек email-валидации Supabase / SMTP-провайдера.
 *
 * Signup-форма покрывается тестом валидации (client-side Zod).
 */

const URL = process.env.VITE_SUPABASE_URL_TEST || process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY_TEST || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY_TEST || process.env.SUPABASE_SERVICE_ROLE_KEY

const PASSWORD = 'TestPass123!'

function adminClient(): SupabaseClient {
  if (!URL || !SERVICE) throw new Error('SUPABASE env vars missing for E2E auth test')
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('Auth UI flow', () => {
  test.skip(
    !URL || !ANON || !SERVICE,
    'Skipped: SUPABASE env vars missing (need URL + ANON + SERVICE_ROLE)',
  )

  let createdUserId: string | null = null
  let testEmail: string

  test.beforeEach(() => {
    testEmail = `e2e-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@finkley.test`
  })

  test.afterEach(async () => {
    if (createdUserId) {
      await adminClient().auth.admin.deleteUser(createdUserId)
      createdUserId = null
    }
  })

  test('login → /onboarding (нет салонов) → exit → /login', async ({ page }) => {
    // Создаём подтверждённого юзера без салона через admin API
    const admin = adminClient()
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: testEmail,
      password: PASSWORD,
      email_confirm: true,
    })
    expect(createErr).toBeNull()
    expect(created.user).toBeDefined()
    createdUserId = created.user!.id

    // Login через UI
    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(testEmail)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()

    // У свежего юзера нет салонов → RootRedirect → /onboarding
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 })
    await expect(page.getByTestId('onboarding')).toBeVisible()
    await expect(page.getByTestId('onboarding-step-salon')).toBeVisible()

    // Sign-out через кнопку «Выйти» в шапке онбординга
    await page.getByTestId('onboarding-exit').click()
    await page.waitForURL(/\/login$/, { timeout: 10_000 })
    await expect(page.getByTestId('login-form')).toBeVisible()
  })

  test('неверные креды показывают ошибку', async ({ page }) => {
    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill('nobody-exists@finkley.test')
    await page.locator('#password').fill('wrongpass-12345')
    await page.getByTestId('login-submit').click()

    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/login$/)
  })

  test('signup форма валидирует пароли (client-side Zod)', async ({ page }) => {
    await page.goto('/signup')
    await page.getByTestId('signup-form').waitFor()

    // Несовпадающие пароли
    await page.locator('#email').fill('whatever@finkley.test')
    await page.locator('#password').fill('TestPass123!')
    await page.locator('#passwordConfirm').fill('DifferentPass123!')
    await page.getByTestId('signup-submit').click()

    await expect(page.getByText('Пароли не совпадают')).toBeVisible()
    await expect(page).toHaveURL(/\/signup$/)

    // Слишком короткий пароль
    await page.locator('#password').fill('short')
    await page.locator('#passwordConfirm').fill('short')
    await page.getByTestId('signup-submit').click()
    await expect(page.getByText(/не менее 8 символов/i)).toBeVisible()
  })
})
