import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E расходов (TASK-13): свежий юзер с салоном → /expenses → добавить расход
 * → проверка тоста + появление в списке + summary-карточка по категории.
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

test.describe('Expense flow', () => {
  test.skip(!URL || !ANON || !SERVICE, 'Skipped: SUPABASE env vars missing')

  let createdUserId: string | null = null

  test.afterEach(async () => {
    if (createdUserId) {
      await admin().auth.admin.deleteUser(createdUserId)
      createdUserId = null
    }
  })

  test('добавление расхода появляется в списке и в summary', async ({ page }) => {
    const a = admin()
    const email = `e2e-exp-${Date.now()}@finkley.test`

    const { data: created, error: cErr } = await a.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    expect(cErr).toBeNull()
    createdUserId = created.user!.id

    // Создаём салон с категориями расходов через RPC
    const userClient = createClient(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'expense-spec' },
    })
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email,
      password: PASSWORD,
    })
    expect(signInErr).toBeNull()

    const { data: salonId, error: rpcErr } = await userClient.rpc('create_salon_with_setup', {
      p_name: 'Expense E2E Salon',
      p_country_code: 'PL',
      p_currency: 'EUR',
      p_timezone: 'Europe/Warsaw',
      p_salon_type: 'hair',
      p_locale: 'ru',
      p_staff: [],
      p_services: [],
      p_expense_categories: ['Аренда', 'Материалы', 'Реклама'],
    })
    expect(rpcErr).toBeNull()

    // Скипаем onboarding-tour чтобы не перехватывал клики.
    await page.addInitScript(() => {
      window.localStorage.setItem('finkley:tour:dismissed', '1')
    })

    // Логин в UI
    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${salonId}/dashboard`), { timeout: 15_000 })

    // Перейти на страницу расходов
    await page.goto(`/${salonId}/expenses`)
    await expect(page.getByRole('heading', { level: 1, name: /Расход/i })).toBeVisible()

    // Открыть форму добавления
    await page.getByTestId('add-expense').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Заполнить форму: категория «Аренда», сумма 250, описание обязательно
    await page.getByTestId('exp-cat').click()
    await page.getByRole('option', { name: 'Аренда' }).click()
    await page.getByTestId('exp-description').fill('E2E ренда офиса')
    await page.getByTestId('exp-amount').fill('250')
    await page.getByTestId('exp-submit').click()

    // Тоаст об успехе
    await expect(page.getByText(/добавлен/i).first()).toBeVisible({ timeout: 10_000 })
    // Модалка закрылась
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // Запись в списке
    await expect(page.getByTestId('expense-row').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/250,00\s?€/).first()).toBeVisible()

    // Summary-карточка «Аренда» содержит 250,00
    const arendaCard = page
      .locator('div')
      .filter({ hasText: /^Аренда/i })
      .first()
    await expect(arendaCard).toContainText(/250,00/)
  })
})
