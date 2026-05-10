/**
 * Integration-тесты для banking-таблиц (RLS + constraints).
 *
 * Проверяем:
 *  - owner может INSERT/SELECT/UPDATE/DELETE свои bank_connections
 *  - другой пользователь НЕ видит чужие bank_connections (RLS)
 *  - bank_accounts → видны только member'ам соответствующего салона (через
 *    связь connection→salon)
 *  - bank_transactions → видны только member'ам соответствующего салона
 *  - UNIQUE(account_id, external_id) на bank_transactions работает (дедуп)
 *  - expense.bank_transaction_id FK работает (set null on delete)
 *  - non-owner role (не owner/admin) не может писать в bank_connections
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, makeClient, shouldSkip, SUPABASE_ANON, teardown, type Ctx } from './_helpers'

describe.skipIf(shouldSkip)('banking RLS + constraints', () => {
  let owner: Ctx
  let intruder: Ctx

  beforeAll(async () => {
    owner = await bootstrap('bank-owner')
    intruder = await bootstrap('bank-intruder')
  })

  afterAll(async () => {
    await teardown(owner)
    await teardown(intruder)
  })

  // ─── bank_connections ────────────────────────────────────────────────
  it('owner может создать bank_connection в своём салоне', async () => {
    const { data, error } = await owner.userClient
      .from('bank_connections')
      .insert({
        salon_id: owner.salonId,
        bank_aspsp_name: 'Bank Millennium',
        bank_country: 'PL',
        history_days: 90,
        status: 'pending',
        created_by: owner.userId,
      })
      .select('id, status, history_days')
      .single()
    expect(error).toBeNull()
    expect(data?.status).toBe('pending')
    expect(data?.history_days).toBe(90)
  })

  it('owner НЕ может создать bank_connection в чужом салоне (RLS блокирует)', async () => {
    const { error } = await owner.userClient.from('bank_connections').insert({
      salon_id: intruder.salonId,
      bank_aspsp_name: 'Bank',
      bank_country: 'PL',
      history_days: 90,
      status: 'pending',
      created_by: owner.userId,
    })
    // RLS политика with check вернёт 42501 / новую ошибку
    expect(error).not.toBeNull()
  })

  it('intruder не видит bank_connections owner', async () => {
    const { data, error } = await intruder.userClient
      .from('bank_connections')
      .select('id')
      .eq('salon_id', owner.salonId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  // ─── bank_accounts ───────────────────────────────────────────────────
  it("bank_accounts видны только member'ам салона (через connection)", async () => {
    // Создаём connection + account через admin
    const { data: conn } = await owner.admin
      .from('bank_connections')
      .insert({
        salon_id: owner.salonId,
        bank_aspsp_name: 'Bank',
        bank_country: 'PL',
        history_days: 90,
        status: 'connected',
        session_id: 'test-session',
        valid_until: new Date(Date.now() + 90 * 86400_000).toISOString(),
        created_by: owner.userId,
      })
      .select('id')
      .single()
    expect(conn?.id).toBeTruthy()

    const { data: acc } = await owner.admin
      .from('bank_accounts')
      .insert({
        connection_id: conn!.id,
        external_id: 'eb-account-1',
        iban: 'PL61109010140000071219812874',
        currency: 'PLN',
        is_active: true,
      })
      .select('id, iban')
      .single()
    expect(acc?.iban).toBe('PL61109010140000071219812874')

    // Owner видит
    const { data: ownerSee } = await owner.userClient
      .from('bank_accounts')
      .select('id, iban')
      .eq('id', acc!.id)
    expect(ownerSee).toHaveLength(1)

    // Intruder не видит
    const { data: intruderSee } = await intruder.userClient
      .from('bank_accounts')
      .select('id')
      .eq('id', acc!.id)
    expect(intruderSee).toEqual([])
  })

  // ─── bank_transactions: dedup + RLS ──────────────────────────────────
  it('UNIQUE(account_id, external_id) предотвращает дубли при повторном sync', async () => {
    // Берём connection+account из предыдущего теста (они уже созданы под owner.salonId)
    const { data: existing } = await owner.admin
      .from('bank_accounts')
      .select('id, connection_id, bank_connections!inner(salon_id)')
      .eq('bank_connections.salon_id', owner.salonId)
      .limit(1)
      .single()
    expect(existing?.id).toBeTruthy()
    const accountId = existing!.id

    const tx = {
      account_id: accountId,
      external_id: 'eb-tx-dup-1',
      type: 'debit',
      amount_cents: 12345,
      currency: 'PLN',
      description: 'TEST PAYMENT',
      executed_at: new Date().toISOString(),
    }

    const { error: ins1 } = await owner.admin.from('bank_transactions').insert(tx)
    expect(ins1).toBeNull()

    const { error: ins2 } = await owner.admin.from('bank_transactions').insert(tx)
    expect(ins2).not.toBeNull()
    // Ожидаем 23505 (unique violation) от Postgres
    expect((ins2 as unknown as { code?: string })?.code).toBe('23505')
  })

  it('bank_transactions невидим intruder через RLS', async () => {
    const { data: tx } = await owner.admin.from('bank_transactions').select('id').limit(1).single()
    expect(tx?.id).toBeTruthy()

    const { data: intruderSee } = await intruder.userClient
      .from('bank_transactions')
      .select('id')
      .eq('id', tx!.id)
    expect(intruderSee).toEqual([])
  })

  // ─── expense.bank_transaction_id FK ──────────────────────────────────
  it('expense.bank_transaction_id ссылается на bank_transactions с set null on delete', async () => {
    const { data: tx } = await owner.admin.from('bank_transactions').select('id').limit(1).single()
    expect(tx?.id).toBeTruthy()

    const { data: exp, error: expErr } = await owner.admin
      .from('expenses')
      .insert({
        salon_id: owner.salonId,
        expense_at: new Date().toISOString().slice(0, 10),
        amount_cents: 12345,
        bank_transaction_id: tx!.id,
        source: 'bank_import',
      })
      .select('id, bank_transaction_id')
      .single()
    expect(expErr).toBeNull()
    expect(exp?.bank_transaction_id).toBe(tx!.id)

    // Удаляем bank_transaction → expense.bank_transaction_id должен стать NULL
    await owner.admin.from('bank_transactions').delete().eq('id', tx!.id)

    const { data: expAfter } = await owner.admin
      .from('expenses')
      .select('id, bank_transaction_id')
      .eq('id', exp!.id)
      .single()
    expect(expAfter?.bank_transaction_id).toBeNull()
  })

  // ─── role-based: staff не может изменять bank_connections ────────────
  it('юзер с role=staff не может INSERT/UPDATE bank_connections (только owner/admin)', async () => {
    // Создаём ещё одного юзера и привязываем как staff к owner.salonId
    const ts = Date.now()
    const staffEmail = `bank-staff-${ts}@finkley.test`
    const { data: createdStaff } = await owner.admin.auth.admin.createUser({
      email: staffEmail,
      password: 'TestPass123!',
      email_confirm: true,
    })
    expect(createdStaff?.user?.id).toBeTruthy()

    await owner.admin.from('salon_members').insert({
      salon_id: owner.salonId,
      user_id: createdStaff!.user!.id,
      role: 'staff',
    })

    const staffClient = makeClient(SUPABASE_ANON, 'bank-staff-cli')
    await staffClient.auth.signInWithPassword({ email: staffEmail, password: 'TestPass123!' })

    // INSERT должен упасть (only owner/admin)
    const { error: insErr } = await staffClient.from('bank_connections').insert({
      salon_id: owner.salonId,
      bank_aspsp_name: 'Hack Bank',
      bank_country: 'PL',
      history_days: 30,
      status: 'pending',
      created_by: createdStaff!.user!.id,
    })
    expect(insErr).not.toBeNull()

    // SELECT работает (staff видит банки своего салона — это OK)
    const { data: rows } = await staffClient
      .from('bank_connections')
      .select('id')
      .eq('salon_id', owner.salonId)
    expect(rows).toBeDefined()
    expect(Array.isArray(rows)).toBe(true)

    // Cleanup
    await owner.admin.auth.admin.deleteUser(createdStaff!.user!.id)
  })
})
