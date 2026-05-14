/**
 * E2E для /admin/* — super-admin может зайти в админку, видит плитки + графики,
 * страницы Salons/Users/Feedback рендерятся без падений.
 *
 * Создаёт временного super-admin через service-role, логинит через UI,
 * проверяет навигацию, чистит за собой.
 */
import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Playwright webServer переопределяет VITE_SUPABASE_URL/ANON_KEY на TEST-проект
// (см. playwright.config.ts). Поэтому e2e создают юзеров в TEST и логин через UI
// совпадает с тем же проектом. Все имена с префиксом e2e-admin-* и чистятся в afterEach.
const URL = process.env.VITE_SUPABASE_URL_TEST
const ANON = process.env.VITE_SUPABASE_ANON_KEY_TEST
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY_TEST

const PASSWORD = 'AdminPass123!'

function adminClient(): SupabaseClient {
  if (!URL || !SERVICE) throw new Error('SUPABASE env vars missing for admin E2E')
  return createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe('Admin UI flow', () => {
  test.skip(!URL || !ANON || !SERVICE, 'Skipped: SUPABASE env vars missing')

  let createdUserId: string | null = null
  let email: string

  test.beforeEach(async () => {
    email = `e2e-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@finkley.test`
    const admin = adminClient()
    const { data: created } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    })
    if (!created.user) throw new Error('admin user not created')
    createdUserId = created.user.id
    await admin
      .from('app_admins')
      .upsert({ user_id: created.user.id, is_super: true }, { onConflict: 'user_id' })
  })

  test.afterEach(async () => {
    if (createdUserId) {
      const admin = adminClient()
      await admin.from('app_admins').delete().eq('user_id', createdUserId)
      await admin.auth.admin.deleteUser(createdUserId)
      createdUserId = null
    }
  })

  async function loginAndWait(page: import('@playwright/test').Page) {
    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    // Просто дождёмся ухода с /login (RootRedirect перенесёт на /onboarding
    // т.к. салонов нет — этого нам достаточно для последующих goto в /admin).
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 15_000 })
  }

  test('super-admin login → /admin/overview → видит плитки + графики', async ({ page }) => {
    await loginAndWait(page)
    await page.goto('/admin/overview')

    // Плитки (точные тексты из ru.json)
    await expect(page.getByText('Всего салонов').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('На подписке').first()).toBeVisible()
    await expect(page.getByText('На демо').first()).toBeVisible()
    await expect(page.getByText('Демо закончилось').first()).toBeVisible()
    await expect(page.getByText('Неактивны').first()).toBeVisible()
    await expect(page.getByText('Всего пользователей').first()).toBeVisible()
    // Графики
    await expect(page.getByRole('heading', { name: 'Новые салоны по месяцам' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Новые пользователи по месяцам' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Визиты по месяцам' })).toBeVisible()
  })

  test('переход по табам Салоны / Пользователи / Фидбек / Блог не падает', async ({ page }) => {
    await loginAndWait(page)

    // На TEST-проекте могут быть накоплены тысячи салонов от прошлых
    // прогонов — admin-stats action=salons тяжелый (KPI 12 мес по каждому).
    // Поднимаем timeout до 45 секунд для admin-страниц.
    await page.goto('/admin/salons')
    await expect(page.getByRole('columnheader', { name: /Ср\. выручка/ }).first()).toBeVisible({
      timeout: 45_000,
    })

    await page.goto('/admin/users')
    await expect(page.getByRole('columnheader', { name: 'Email' }).first()).toBeVisible({
      timeout: 45_000,
    })
    await expect(page.getByRole('columnheader', { name: 'Имя' }).first()).toBeVisible()

    await page.goto('/admin/feedback')
    await expect(page.getByRole('heading', { name: 'Фидбек и баг-репорты' })).toBeVisible({
      timeout: 45_000,
    })

    await page.goto('/admin/media')
    await expect(page.getByTestId('new-post')).toBeVisible({ timeout: 45_000 })
  })
})

test.describe('Blocked pages', () => {
  test('публичный /blocked/account рендерится без авторизации', async ({ page }) => {
    await page.goto('/blocked/account')
    await expect(page.getByRole('heading', { name: 'Ваш аккаунт заблокирован' })).toBeVisible()
    await expect(page.getByText('support@finsalon.app')).toBeVisible()
  })
})
