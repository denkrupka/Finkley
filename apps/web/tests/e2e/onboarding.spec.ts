import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E онбординга (TASK-08): свежий юзер → /onboarding → 5 шагов → создание салона
 * через RPC create_salon_with_setup → редирект в /{salonId}/dashboard.
 *
 * Не пытается тестировать пиксельную точность — только функциональный поток.
 * Cleanup: удаляем юзера через admin API в afterEach (cascade удаляет салон,
 * членство, staff, services, expense_categories).
 */

const URL = process.env.VITE_SUPABASE_URL_TEST || process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY_TEST || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY_TEST || process.env.SUPABASE_SERVICE_ROLE_KEY

const PASSWORD = 'TestPass123!'

function adminClient(): SupabaseClient {
  if (!URL || !SERVICE) throw new Error('SUPABASE env vars missing')
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('Onboarding flow', () => {
  test.skip(!URL || !ANON || !SERVICE, 'Skipped: SUPABASE env vars missing')

  let createdUserId: string | null = null

  test.afterEach(async () => {
    if (createdUserId) {
      await adminClient().auth.admin.deleteUser(createdUserId)
      createdUserId = null
    }
  })

  test('свежий юзер проходит 5 шагов и попадает на дашборд', async ({ page }) => {
    const admin = adminClient()
    const email = `e2e-onb-${Date.now()}@finkley.test`
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    expect(cErr).toBeNull()
    createdUserId = created.user!.id

    // Login
    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(/\/onboarding$/, { timeout: 10_000 })

    // Step 1 — Салон
    await expect(page.getByTestId('onboarding-step-salon')).toBeVisible()
    await page.getByTestId('onb-name').fill('Тест Студия')
    // Default страна = PL, тип = hair — оставляем
    await page.getByTestId('onboarding-next').click()

    // Step 2 — Мастера, можно пропустить (skip)
    await expect(page.getByTestId('onboarding-step-staff')).toBeVisible()
    await page.getByTestId('onboarding-skip').click()

    // Step 3 — Услуги, пропускаем (seed уже наполнил)
    await expect(page.getByTestId('onboarding-step-services')).toBeVisible()
    await page.getByTestId('onboarding-next').click()

    // Step 4 — Расходы (дефолтные категории), Next
    await expect(page.getByTestId('onboarding-step-expenses')).toBeVisible()
    await page.getByTestId('onboarding-next').click()

    // Step 5 — Готово, submit
    await expect(page.getByTestId('onboarding-step-done')).toBeVisible()
    await page.getByTestId('onboarding-submit').click()

    // После создания — редирект /{salonId}/dashboard
    await page.waitForURL(/\/[a-f0-9-]{36}\/dashboard/, { timeout: 15_000 })
    // На дашборде — приветствие «Привет, ...» + блок KPI «Прибыль»
    await expect(page.getByRole('heading', { level: 1, name: /Привет/i })).toBeVisible()
    await expect(page.getByText('Прибыль').first()).toBeVisible()
  })
})
