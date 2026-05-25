import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E банкинга:
 *  1) Маркер «Банк» на расходе с bank_transaction_id.
 *  2) AlertTriangle needs_review когда auto-link низкой уверенности.
 *  3) sync_interval Select в /settings/integrations меняет значение в БД.
 *
 * Seed через service-role admin: bank_connections + bank_accounts +
 * bank_transactions + expenses со связью. RPC create_salon_with_setup
 * создаёт salon + категории расходов.
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

/**
 * Поднимает user + salon + connected bank_connection + bank_account.
 * Возвращает id'шники для дальнейшего seed'а транзакций/расходов.
 */
async function bootstrap(prefix: string): Promise<{
  userId: string
  salonId: string
  connectionId: string
  accountId: string
  email: string
  categoryId: string
}> {
  const a = admin()
  const email = `${prefix}-${Date.now()}@finkley.test`

  const { data: created, error: cErr } = await a.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (cErr || !created.user) throw cErr ?? new Error('user not created')
  const userId = created.user.id

  // Логин юзером для RPC create_salon_with_setup (RLS режет admin'а на этом RPC).
  const userClient = createClient(URL!, ANON!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `${prefix}-setup-${Date.now()}`,
    },
  })
  await userClient.auth.signInWithPassword({ email, password: PASSWORD })

  const { data: salonId, error: rpcErr } = await userClient.rpc('create_salon_with_setup', {
    p_name: `${prefix} Banking E2E`,
    p_country_code: 'PL',
    p_currency: 'EUR',
    p_timezone: 'Europe/Warsaw',
    p_salon_type: 'hair',
    p_locale: 'ru',
    p_staff: [],
    p_services: [],
    p_expense_categories: ['Аренда', 'Материалы'],
  })
  if (rpcErr || !salonId) throw rpcErr ?? new Error('salon RPC failed')

  // Тянем созданную категорию «Аренда» (RLS пропускает member'а).
  const { data: cats } = await userClient
    .from('expense_categories')
    .select('id, name')
    .eq('salon_id', salonId as string)
  const rent = (cats ?? []).find((c) => c.name === 'Аренда')
  if (!rent) throw new Error('rent category not seeded')

  // Connection + account через admin (status=connected чтобы прошёл UI-фильтр).
  const { data: conn, error: connErr } = await a
    .from('bank_connections')
    .insert({
      salon_id: salonId as string,
      bank_aspsp_name: 'TestBank',
      bank_country: 'PL',
      history_days: 90,
      status: 'connected',
      session_id: `e2e-${Date.now()}`,
      valid_until: new Date(Date.now() + 90 * 86400_000).toISOString(),
      last_synced_at: new Date().toISOString(),
      created_by: userId,
    })
    .select('id')
    .single()
  if (connErr || !conn) throw connErr ?? new Error('connection insert failed')

  const { data: account, error: accErr } = await a
    .from('bank_accounts')
    .insert({
      connection_id: conn.id,
      external_id: `eb-acc-${Date.now()}`,
      iban: 'PL61109010140000071219812874',
      name: 'Test Current Account',
      currency: 'EUR',
      is_active: true,
    })
    .select('id')
    .single()
  if (accErr || !account) throw accErr ?? new Error('account insert failed')

  return {
    userId,
    salonId: salonId as string,
    connectionId: conn.id as string,
    accountId: account.id as string,
    email,
    categoryId: rent.id as string,
  }
}

test.describe('Banking flow', () => {
  test.skip(!URL || !ANON || !SERVICE, 'Skipped: SUPABASE env vars missing')

  const trash: Array<{ userId: string; salonId: string; connectionId: string }> = []

  test.afterEach(async () => {
    const a = admin()
    while (trash.length) {
      const ctx = trash.pop()!
      // bank_connection.on delete cascade → bank_accounts + bank_transactions
      await a.from('bank_connections').delete().eq('id', ctx.connectionId)
      await a.from('salons').delete().eq('id', ctx.salonId)
      await a.auth.admin.deleteUser(ctx.userId)
    }
  })

  test('маркер «Банк» рисуется на расходе с bank_transaction_id', async ({ page }) => {
    const ctx = await bootstrap('e2e-bank-link')
    trash.push(ctx)
    const a = admin()

    // Создаём bank_tx (debit) + expense с обратной связью на этот tx.
    const today = new Date().toISOString().slice(0, 10)
    const { data: tx } = await a
      .from('bank_transactions')
      .insert({
        account_id: ctx.accountId,
        external_id: `eb-tx-${Date.now()}`,
        type: 'debit',
        amount_cents: 25000,
        currency: 'EUR',
        description: 'E2E payment for rent',
        counterparty: 'Landlord',
        executed_at: new Date().toISOString(),
        needs_review: false,
      })
      .select('id')
      .single()
    if (!tx) throw new Error('tx insert failed')

    await a.from('expenses').insert({
      salon_id: ctx.salonId,
      category_id: ctx.categoryId,
      expense_at: today,
      amount_cents: 25000,
      payment_method: 'transfer',
      description: 'E2E ренда (привязана к банку)',
      bank_transaction_id: tx.id,
      created_by: ctx.userId,
    })
    // И симметрично — обновим bank_tx.expense_id (как делает sync).
    await a.from('bank_transactions').update({ expense_id: undefined }).eq('id', tx.id)

    // Скип onboarding tour чтобы не перехватывал клики.
    await page.addInitScript(() => {
      window.localStorage.setItem('finkley:tour:dismissed', '1')
    })

    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(ctx.email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${ctx.salonId}/dashboard`), { timeout: 15_000 })

    await page.goto(`/${ctx.salonId}/expenses`)
    // Строка расхода рендерится
    await expect(page.getByTestId('expense-row').first()).toBeVisible({ timeout: 10_000 })
    // Бейдж «Банк» виден рядом с описанием
    await expect(page.getByText('E2E ренда (привязана к банку)')).toBeVisible()
    // i18n.expenses.bank_badge = "Банк" — рендерится uppercase в span
    await expect(page.getByText(/^Банк$/).first()).toBeVisible({ timeout: 5_000 })
  })

  test('AlertTriangle needs_review на расходе с low-confidence auto-link', async ({ page }) => {
    const ctx = await bootstrap('e2e-bank-review')
    trash.push(ctx)
    const a = admin()

    const today = new Date().toISOString().slice(0, 10)
    const { data: tx } = await a
      .from('bank_transactions')
      .insert({
        account_id: ctx.accountId,
        external_id: `eb-tx-${Date.now()}`,
        type: 'debit',
        amount_cents: 15000,
        currency: 'EUR',
        description: 'Auto-matched, needs review',
        counterparty: 'Some Vendor',
        executed_at: new Date().toISOString(),
        needs_review: true,
      })
      .select('id')
      .single()
    if (!tx) throw new Error('tx insert failed')

    const { data: exp } = await a
      .from('expenses')
      .insert({
        salon_id: ctx.salonId,
        category_id: ctx.categoryId,
        expense_at: today,
        amount_cents: 15000,
        payment_method: 'transfer',
        description: 'E2E расход требует проверки',
        bank_transaction_id: tx.id,
        created_by: ctx.userId,
      })
      .select('id')
      .single()
    if (!exp) throw new Error('expense insert failed')

    // Сделаем backref tx.expense_id чтобы useBankLinkedIncomeIds увидел его в
    // needsReviewExpenseIds (hook читает bank_transactions, не expenses).
    await a.from('bank_transactions').update({ expense_id: exp.id }).eq('id', tx.id)

    await page.addInitScript(() => {
      window.localStorage.setItem('finkley:tour:dismissed', '1')
    })

    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(ctx.email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${ctx.salonId}/dashboard`), { timeout: 15_000 })

    await page.goto(`/${ctx.salonId}/expenses`)
    await expect(page.getByTestId('expense-row').first()).toBeVisible({ timeout: 10_000 })
    // Иконка обёрнута <span title="i18n.expenses.needs_review_tooltip"> — ищем по title.
    await expect(page.locator('span[title*="Авто-привязка"]').first()).toBeVisible({
      timeout: 5_000,
    })
  })

  test('sync_interval Select меняет sync_interval_minutes в БД', async ({ page }) => {
    const ctx = await bootstrap('e2e-bank-interval')
    trash.push(ctx)
    const a = admin()

    await page.addInitScript(() => {
      window.localStorage.setItem('finkley:tour:dismissed', '1')
    })

    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(ctx.email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${ctx.salonId}/dashboard`), { timeout: 15_000 })

    await page.goto(`/${ctx.salonId}/settings/integrations?tab=banking`)
    // BankingSection шапка
    await expect(page.getByTestId('banking-add')).toBeVisible({ timeout: 15_000 })
    // Connection-карточка с дефолтным «Каждые 6 часов»
    await expect(page.getByText('TestBank').first()).toBeVisible({ timeout: 10_000 })

    // Radix Select: aria-name на combobox это accessibleName из SelectValue
    // (он рендерит просто текст без label), поэтому ищем по hasText.
    const select = page
      .getByRole('combobox')
      .filter({ hasText: /Каждые 6 часов/ })
      .first()
    await select.click()
    // Выбираем «Раз в день» = 1440
    await page.getByRole('option', { name: /Раз в день/i }).click()

    // Toast i18n.banking.toast_interval_saved = «Частота синхронизации обновлена»
    await expect(page.getByText(/Частота синхронизации обновлена/i).first()).toBeVisible({
      timeout: 10_000,
    })

    // Проверяем в БД
    const { data: refreshed } = await a
      .from('bank_connections')
      .select('sync_interval_minutes')
      .eq('id', ctx.connectionId)
      .single()
    expect(refreshed?.sync_interval_minutes).toBe(1440)
  })
})
