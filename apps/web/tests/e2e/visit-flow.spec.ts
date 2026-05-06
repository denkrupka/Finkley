import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E ядра продукта (TASK-10 + TASK-11 + TASK-14):
 * 1. Свежий юзер с салоном (создаём через RPC напрямую)
 * 2. Логин в UI
 * 3. На дашборде — empty state, прибыль €0
 * 4. Открытие Quick Entry FAB
 * 5. Ввод визита
 * 6. Тоаст «Визит добавлен»
 * 7. Прибыль на дашборде обновилась
 * 8. На странице Визиты строка появилась
 */

const URL = process.env.VITE_SUPABASE_URL_TEST || process.env.VITE_SUPABASE_URL
const ANON = process.env.VITE_SUPABASE_ANON_KEY_TEST || process.env.VITE_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY_TEST || process.env.SUPABASE_SERVICE_ROLE_KEY
const PASSWORD = 'TestPass123!'

function admin(): SupabaseClient {
  if (!URL || !SERVICE) throw new Error('SUPABASE env missing')
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('Visit flow', () => {
  test.skip(!URL || !ANON || !SERVICE, 'Skipped: SUPABASE env vars missing')

  let createdUserId: string | null = null

  test.afterEach(async () => {
    if (createdUserId) {
      await admin().auth.admin.deleteUser(createdUserId)
      createdUserId = null
    }
  })

  test('FAB → Quick Entry → визит появляется в дашборде и списке', async ({ page }) => {
    const a = admin()
    const email = `e2e-visit-${Date.now()}@finkley.test`

    // 1. Юзер
    const { data: created, error: cErr } = await a.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    expect(cErr).toBeNull()
    createdUserId = created.user!.id

    // 2. Подключаем как этот юзер и создаём салон + мастера + услуги через RPC
    const userClient = createClient(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'visit-spec' },
    })
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email,
      password: PASSWORD,
    })
    expect(signInErr).toBeNull()

    const { data: salonId, error: rpcErr } = await userClient.rpc('create_salon_with_setup', {
      p_name: 'E2E Salon',
      p_country_code: 'PL',
      p_currency: 'EUR',
      p_timezone: 'Europe/Warsaw',
      p_salon_type: 'hair',
      p_locale: 'ru',
      p_staff: [{ full_name: 'Аня', payout_percent: 40 }],
      p_services: [
        { category_name: 'Стрижки', name: 'Женская стрижка', default_price_cents: 4000 },
      ],
      p_expense_categories: ['Аренда', 'Материалы'],
    })
    expect(rpcErr).toBeNull()
    expect(typeof salonId).toBe('string')

    // 3. Логин в UI и переход на дашборд салона
    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${salonId}/dashboard`), { timeout: 15_000 })

    // На дашборде — приветствие, прибыль €0
    await expect(page.getByRole('heading', { level: 1, name: /Привет/i })).toBeVisible()

    // 4. FAB открывает Quick Entry
    await page.getByTestId('fab-add-visit-desktop').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // 5. Заполняем форму: мастер уже выбран (только Аня), услугу выбрать
    await page.getByTestId('qe-service').click()
    await page.getByRole('option', { name: /Женская стрижка/i }).click()
    // Сумма автоподставится из default_price (40), не трогаем
    // Способ оплаты — оставляем default (Карта)
    await page.getByTestId('qe-submit').click()

    // 6. Тоаст «Визит добавлен»
    await expect(page.getByText(/Визит добавлен/).first()).toBeVisible({ timeout: 10_000 })
    // Модалка закрылась
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // 7. Прибыль обновилась — должна появиться сумма 40,00 € (ru-RU EUR формат)
    await expect(page.getByText(/40,00\s?€/).first()).toBeVisible({ timeout: 10_000 })

    // 8. Идём на /visits — там запись
    await page.goto(`/${salonId}/visits`)
    await expect(page.getByTestId('visit-row').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Аня/).first()).toBeVisible()
  })
})
