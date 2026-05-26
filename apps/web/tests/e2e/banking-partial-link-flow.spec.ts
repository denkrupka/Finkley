import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * E2E для partial-payment link flow (image #47/#48 + image #51):
 *  1) Расход 10000, уже есть installment на 4000 (paid_amount_cents = 4000).
 *  2) Открываем Banking-таб → кликаем «Связать» по дебет-tx 3000.
 *  3) В picker'е выбираем этот частично-оплаченный расход.
 *  4) Ожидаем что откроется PartiallyPaidExpenseDialog (не AmountMismatchDialog).
 *  5) Кликаем «Оплатить частично».
 *  6) Assert: создан новый installment 3000, tx.expense_id связан с расходом,
 *     paid_amount_cents расхода вырос до 7000.
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

  const userClient = createClient(URL!, ANON!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `${prefix}-setup-${Date.now()}`,
    },
  })
  await userClient.auth.signInWithPassword({ email, password: PASSWORD })

  const { data: salonId, error: rpcErr } = await userClient.rpc('create_salon_with_setup', {
    p_name: `${prefix} Partial E2E`,
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

  const { data: cats } = await userClient
    .from('expense_categories')
    .select('id, name')
    .eq('salon_id', salonId as string)
  const mat = (cats ?? []).find((c) => c.name === 'Материалы')
  if (!mat) throw new Error('Материалы category not seeded')

  const { data: conn, error: connErr } = await a
    .from('bank_connections')
    .insert({
      salon_id: salonId as string,
      bank_aspsp_name: 'TestBank',
      bank_country: 'PL',
      history_days: 90,
      status: 'connected',
      session_id: `partial-${Date.now()}`,
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
      external_id: `partial-acc-${Date.now()}`,
      iban: 'PL61109010140000071219812874',
      name: 'Partial Test Account',
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
    categoryId: mat.id as string,
  }
}

test.describe('Banking partial-payment link flow', () => {
  test.skip(!URL || !ANON || !SERVICE, 'Skipped: SUPABASE env vars missing')

  const trash: Array<{ userId: string; salonId: string; connectionId: string }> = []

  test.afterEach(async () => {
    const a = admin()
    while (trash.length) {
      const ctx = trash.pop()!
      await a.from('bank_connections').delete().eq('id', ctx.connectionId)
      await a.from('salons').delete().eq('id', ctx.salonId)
      await a.auth.admin.deleteUser(ctx.userId)
    }
  })

  test('частично-оплаченный расход → PartiallyPaidExpenseDialog → +installment', async ({
    page,
  }) => {
    const ctx = await bootstrap('e2e-partial-link')
    trash.push(ctx)
    const a = admin()

    // 1) Создаём расход 10000 EUR (full amount, paid=NULL = legacy «полностью»)
    const today = new Date().toISOString().slice(0, 10)
    const { data: exp } = await a
      .from('expenses')
      .insert({
        salon_id: ctx.salonId,
        category_id: ctx.categoryId,
        expense_at: today,
        amount_cents: 10000,
        payment_method: 'transfer',
        description: 'E2E partial expense',
        created_by: ctx.userId,
      })
      .select('id')
      .single()
    if (!exp) throw new Error('expense seed failed')

    // 2) Создаём первый installment 4000 — trigger пересчитает paid_amount_cents
    const { error: insErr } = await a.from('expense_payment_installments').insert({
      expense_id: exp.id,
      amount_cents: 4000,
      payment_method: 'cash',
      paid_at: new Date().toISOString(),
    })
    if (insErr) throw new Error(`first installment insert failed: ${insErr.message}`)

    // Проверяем что trigger сработал: paid_amount_cents = 4000
    const { data: expAfter } = await a
      .from('expenses')
      .select('paid_amount_cents')
      .eq('id', exp.id)
      .single()
    expect(expAfter?.paid_amount_cents).toBe(4000)

    // 3) Создаём бэнк-tx (debit, 3000) — будем привязывать через UI
    const { data: tx } = await a
      .from('bank_transactions')
      .insert({
        account_id: ctx.accountId,
        external_id: `partial-tx-${Date.now()}`,
        type: 'debit',
        amount_cents: 3000,
        currency: 'EUR',
        description: 'Bank transfer 3000',
        counterparty: 'Vendor LLC',
        executed_at: new Date().toISOString(),
        needs_review: false,
      })
      .select('id')
      .single()
    if (!tx) throw new Error('bank tx seed failed')

    // 4) Логинимся и идём на /expenses?tab=banking
    await page.addInitScript(() => {
      window.localStorage.setItem('finkley:tour:dismissed', '1')
    })

    await page.goto('/login')
    await page.getByTestId('login-form').waitFor()
    await page.locator('#email').fill(ctx.email)
    await page.locator('#password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await page.waitForURL(new RegExp(`/${ctx.salonId}/dashboard`), { timeout: 15_000 })

    await page.goto(`/${ctx.salonId}/expenses?tab=banking`)
    // Транзакция отрисовалась
    await expect(page.getByText('Vendor LLC').first()).toBeVisible({ timeout: 10_000 })

    // 5) Клик «Связать» по строке tx
    await page
      .getByRole('button', { name: /Связать/i })
      .first()
      .click()

    // 6) Откроется LinkTransactionDialog с embed ExpensesPage
    // — picker по умолчанию скрывает уже-связанные расходы (наш не связан).
    await expect(page.getByText('E2E partial expense').first()).toBeVisible({ timeout: 10_000 })

    // 7) Клик по расходу → должен открыться PartiallyPaidExpenseDialog
    await page.getByText('E2E partial expense').first().click()

    // Заголовок PartiallyPaidExpenseDialog
    await expect(page.getByText(/Привязка к частично оплаченному расходу/i).first()).toBeVisible({
      timeout: 10_000,
    })

    // Видны цифры: Оплачено 40,00, Осталось 60,00
    await expect(page.getByText(/40,00.*EUR/).first()).toBeVisible()
    await expect(page.getByText(/60,00.*EUR/).first()).toBeVisible()

    // 8) Клик «Оплатить частично»
    await page
      .getByRole('button', { name: /Оплатить частично/i })
      .first()
      .click()

    // 9) Тост успешный + диалог закрыт
    await expect(page.getByText(/Привязано как частичная оплата/i).first()).toBeVisible({
      timeout: 10_000,
    })

    // 10) Assert в БД: новый installment 3000 + tx.expense_id связан + paid = 7000
    const { data: installments } = await a
      .from('expense_payment_installments')
      .select('amount_cents, bank_transaction_id')
      .eq('expense_id', exp.id)
      .order('paid_at', { ascending: true })
    expect(installments).toHaveLength(2)
    expect(installments?.[0]?.amount_cents).toBe(4000)
    expect(installments?.[1]?.amount_cents).toBe(3000)
    expect(installments?.[1]?.bank_transaction_id).toBe(tx.id)

    const { data: txAfter } = await a
      .from('bank_transactions')
      .select('expense_id, needs_review')
      .eq('id', tx.id)
      .single()
    expect(txAfter?.expense_id).toBe(exp.id)
    expect(txAfter?.needs_review).toBe(false)

    const { data: expFinal } = await a
      .from('expenses')
      .select('paid_amount_cents')
      .eq('id', exp.id)
      .single()
    expect(expFinal?.paid_amount_cents).toBe(7000) // 4000 + 3000
  })
})
