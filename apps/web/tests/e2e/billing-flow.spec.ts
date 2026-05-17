import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E billing flow (TASK-16):
 * - Юзер с активным салоном (без подписки) видит кнопку «Оформить подписку».
 * - Клик стартует POST к create-checkout-session → редирект на returned URL.
 *
 * Чтобы не плодить реальные Stripe-сессии в Live-моде, кликом по кнопке
 * мы перехватываем route на edge-function и подсовываем mock-URL.
 * Проверяется именно UI-флоу: получили URL → ушли на него.
 */

const URL_SB = process.env.VITE_SUPABASE_URL_TEST || process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY_TEST || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY_TEST || process.env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = 'TestPass123!'
const MOCK_CHECKOUT = 'http://localhost:5173/?stripe-mock=1'

function admin(): SupabaseClient {
  if (!URL_SB || !SERVICE) throw new Error('SUPABASE env missing')
  return createClient(URL_SB, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('Billing checkout flow', () => {
  test.skip(!URL_SB || !ANON || !SERVICE, 'Skipped: SUPABASE env vars missing')

  let createdUserId: string | null = null

  test.afterEach(async () => {
    if (createdUserId) {
      await admin().auth.admin.deleteUser(createdUserId)
      createdUserId = null
    }
  })

  test('кнопка «Оформить подписку» уводит на возвращённый url', async ({ page }) => {
    const a = admin()
    const email = `e2e-bill-${Date.now()}@finkley.test`
    const { data: created, error: cErr } = await a.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    expect(cErr).toBeNull()
    createdUserId = created.user!.id

    const userClient = createClient(URL_SB!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'bill-spec' },
    })
    await userClient.auth.signInWithPassword({ email, password: PASSWORD })
    const { data: salonId, error: rpcErr } = await userClient.rpc('create_salon_with_setup', {
      p_name: 'Billing Salon',
      p_country_code: 'PL',
      p_currency: 'EUR',
      p_timezone: 'Europe/Warsaw',
      p_salon_type: 'hair',
      p_locale: 'ru',
      p_staff: [],
      p_services: [],
      p_expense_categories: ['Аренда'],
    })
    expect(rpcErr).toBeNull()

    // Стабим вызов create-checkout-session: возвращаем mock-url, чтобы не идти в Stripe
    await page.route('**/functions/v1/create-checkout-session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: MOCK_CHECKOUT }),
      })
    })

    // Логин и переход в Settings
    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${salonId}/dashboard`), { timeout: 15_000 })

    // BillingButtons под /settings?tab=billing
    await page.goto(`/${salonId}/settings?tab=billing`)
    const checkoutBtn = page.getByTestId('billing-checkout')
    await expect(checkoutBtn).toBeVisible({ timeout: 10_000 })

    // Клик → переход на mock-url
    await checkoutBtn.click()
    await page.waitForURL(/stripe-mock=1/, { timeout: 10_000 })
  })
})
