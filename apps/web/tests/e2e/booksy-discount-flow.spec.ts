import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E discount auto-apply (ADR-017 §8):
 *   1) Создаём клиента со скидкой 15% (через DB seed)
 *   2) Открываем QuickEntryModal → выбираем клиента
 *   3) Выбираем услугу
 *   4) Видим hint «Скидка 15% из карточки клиента»
 *   5) Сохраняем → визит создан с discount_cents = round(amount * 0.15)
 *
 * Также проверяем что новая клиентская карточка позволяет вводить скидку
 * через ClientFormModal (формы добавили discount_percent поле).
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

test.describe('Booksy: discount auto-apply', () => {
  test.skip(!URL || !ANON || !SERVICE, 'Skipped: SUPABASE env vars missing')

  let createdUserId: string | null = null

  test.afterEach(async () => {
    if (createdUserId) {
      await admin().auth.admin.deleteUser(createdUserId)
      createdUserId = null
    }
  })

  test('клиент со скидкой 15% → авто-применение в визите', async ({ page }) => {
    const a = admin()
    const email = `e2e-discount-${Date.now()}@finkley.test`
    const { data: created } = await a.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    createdUserId = created.user!.id

    const userClient = createClient(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'discount-spec' },
    })
    await userClient.auth.signInWithPassword({ email, password: PASSWORD })
    const { data: salonId } = await userClient.rpc('create_salon_with_setup', {
      p_name: 'Discount E2E',
      p_country_code: 'PL',
      p_currency: 'PLN',
      p_timezone: 'Europe/Warsaw',
      p_salon_type: 'hair',
      p_locale: 'ru',
      p_staff: [{ full_name: 'Анна', payout_percent: 40 }],
      p_services: [
        {
          category_name: 'Стрижки',
          name: 'Стрижка',
          default_price_cents: 10000,
          default_duration_min: 60,
        },
      ],
      p_expense_categories: ['Аренда'],
    })

    // Клиент со скидкой 15% (вставляем напрямую в БД через service-role)
    await a.from('clients').insert({
      salon_id: salonId,
      name: 'VIP клиент',
      phone: '+48600000001',
      discount_percent: 15,
    })

    await page.addInitScript(() => {
      window.localStorage.setItem('finkley:tour:dismissed', '1')
    })

    // Login
    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${salonId}/dashboard`), { timeout: 15_000 })

    // Открываем QuickEntryModal через FAB
    await page.getByTestId('fab-add').click()
    await page.getByTestId('fab-action-visit').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Выбираем клиента
    await page.getByTestId('qe-client').click()
    await page.getByRole('button', { name: /VIP клиент/i }).click()

    // Выбираем услугу
    await page.getByRole('combobox', { name: /^Услуга/i }).click()
    await page.getByRole('option', { name: /Стрижка/i }).click()

    // Hint «Скидка 15% из карточки клиента» должен появиться (русская локаль)
    await expect(page.getByText(/Скидка 15% из карточки клиента/i)).toBeVisible({
      timeout: 5_000,
    })

    // Сохраняем визит
    await page.getByTestId('qe-submit').click()
    await expect(page.getByText(/Визит добавлен/).first()).toBeVisible({ timeout: 10_000 })

    // Проверяем что visit создан с правильным discount_cents = 1500 (15% от 10000)
    const { data: visits } = await a
      .from('visits')
      .select('amount_cents, discount_cents')
      .eq('salon_id', salonId)
    expect(visits).toHaveLength(1)
    expect(visits![0]!.amount_cents).toBe(10000)
    expect(visits![0]!.discount_cents).toBe(1500)
  })

  test('ClientFormModal принимает discount_percent', async ({ page }) => {
    const a = admin()
    const email = `e2e-clform-${Date.now()}@finkley.test`
    const { data: created } = await a.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    createdUserId = created.user!.id

    const userClient = createClient(URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'clform-spec' },
    })
    await userClient.auth.signInWithPassword({ email, password: PASSWORD })
    const { data: salonId } = await userClient.rpc('create_salon_with_setup', {
      p_name: 'ClientForm E2E',
      p_country_code: 'PL',
      p_currency: 'PLN',
      p_timezone: 'Europe/Warsaw',
      p_salon_type: 'hair',
      p_locale: 'ru',
      p_staff: [{ full_name: 'Аня', payout_percent: 40 }],
      p_services: [{ category_name: 'Стрижки', name: 'Стрижка', default_price_cents: 5000 }],
      p_expense_categories: ['Аренда'],
    })

    await page.addInitScript(() => {
      window.localStorage.setItem('finkley:tour:dismissed', '1')
    })

    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${salonId}/dashboard`), { timeout: 15_000 })

    // Открываем reports/clients
    await page.goto(`/${salonId}/reports?tab=clients&client=list`)
    await page.getByTestId('add-client-reports').waitFor({ timeout: 10_000 })
    await page.getByTestId('add-client-reports').click()
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByTestId('cl-name').fill('Клиент со скидкой')
    await page.locator('#cl-discount').fill('20')
    await page.getByTestId('cl-submit').click()

    await expect(page.getByText(/Клиент добавлен/).first()).toBeVisible({ timeout: 10_000 })

    // Проверка в БД: discount_percent сохранилось
    const { data: clients } = await a
      .from('clients')
      .select('name, discount_percent')
      .eq('salon_id', salonId)
    const newClient = clients?.find((c) => c.name === 'Клиент со скидкой')
    expect(newClient).toBeTruthy()
    expect(Number(newClient!.discount_percent)).toBe(20)
  })
})
