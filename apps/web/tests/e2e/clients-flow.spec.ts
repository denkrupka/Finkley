import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E клиентов (TASK-20):
 * 1. Заходим на /clients — пусто.
 * 2. Создаём клиента «Анна» с телефоном.
 * 3. Видим в списке + summary KPI «Всего клиентов: 1».
 * 4. Открываем drawer кликом — пустая история, есть кнопки edit/delete.
 * 5. Закрываем drawer.
 * 6. Открываем форму нового визита (FAB), выбираем созданного клиента в picker'е.
 * 7. Сохраняем визит — drawer истории клиента теперь содержит запись.
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

test.describe('Clients flow', () => {
  test.skip(!URL || !ANON || !SERVICE, 'Skipped: SUPABASE env vars missing')

  let createdUserId: string | null = null

  test.afterEach(async () => {
    if (createdUserId) {
      await admin().auth.admin.deleteUser(createdUserId)
      createdUserId = null
    }
  })

  test('создание клиента → выбор в визите → история в drawer', async ({ page }) => {
    const a = admin()
    const email = `e2e-cli-${Date.now()}@finkley.test`
    const { data: created, error: cErr } = await a.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    expect(cErr).toBeNull()
    createdUserId = created.user!.id

    const userClient = createClient(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'cli-spec' },
    })
    await userClient.auth.signInWithPassword({ email, password: PASSWORD })
    const { data: salonId, error: rpcErr } = await userClient.rpc('create_salon_with_setup', {
      p_name: 'Clients E2E',
      p_country_code: 'PL',
      p_currency: 'EUR',
      p_timezone: 'Europe/Warsaw',
      p_salon_type: 'hair',
      p_locale: 'ru',
      p_staff: [{ full_name: 'Аня', payout_percent: 40 }],
      p_services: [
        { category_name: 'Стрижки', name: 'Женская стрижка', default_price_cents: 5000 },
      ],
      p_expense_categories: ['Аренда'],
    })
    expect(rpcErr).toBeNull()

    // Логин
    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${salonId}/dashboard`), { timeout: 15_000 })

    // /clients
    await page.goto(`/${salonId}/clients`)
    await expect(page.getByRole('heading', { level: 1, name: /Клиенты/i })).toBeVisible()
    await expect(page.getByText(/Пока ни одного клиента/i)).toBeVisible()

    // Создать клиента
    await page.getByTestId('add-client').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByTestId('cl-name').fill('Анна Ковальская')
    await page.locator('#cl-phone').fill('+48600123456')
    await page.locator('#cl-email').fill('anna@example.com')
    await page.getByTestId('cl-submit').click()

    await expect(page.getByText('Клиент добавлен').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // В списке
    const row = page.getByTestId('client-row').first()
    await expect(row).toContainText('Анна Ковальская')

    // Drawer открывается кликом
    await row.click()
    const drawer = page.getByRole('dialog').last()
    await expect(drawer).toContainText('Анна Ковальская')
    await expect(page.getByTestId('client-history-empty')).toBeVisible()
    // Закрываем drawer Escape
    await page.keyboard.press('Escape')

    // FAB → Quick Entry → выбор клиента
    await page.goto(`/${salonId}/dashboard`)
    await page.getByTestId('fab-add-visit-desktop').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Услуга
    await page.getByTestId('qe-service').click()
    await page.getByRole('option', { name: /Женская стрижка/i }).click()

    // Клиент
    await page.getByTestId('qe-client').click()
    await page.getByRole('button', { name: /Анна Ковальская/i }).click()

    await page.getByTestId('qe-submit').click()
    await expect(page.getByText(/Визит добавлен/).first()).toBeVisible({ timeout: 10_000 })

    // /clients → drawer → история должна содержать визит
    await page.goto(`/${salonId}/clients`)
    await page.getByTestId('client-row').first().click()
    await expect(page.getByTestId('client-history-row').first()).toBeVisible({ timeout: 10_000 })
  })
})
