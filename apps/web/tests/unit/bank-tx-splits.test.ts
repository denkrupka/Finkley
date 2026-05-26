/**
 * Тесты для bank_tx_splits (миграция 20260526120616) — bridge-таблица
 * multi-link (одна tx → N сущностей).
 *
 * Покрываем:
 *  - INSERT split'а member'ом салона через RLS
 *  - intruder не видит чужие splits
 *  - UNIQUE (tx, kind, entity_id) предотвращает дубль на ту же сущность
 *  - CHECK amount_cents > 0
 *  - on delete cascade: удаление bank_transactions сносит splits
 *  - kind enum принимает только expense/visit/other_income
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, shouldSkip, teardown, type Ctx } from './_helpers'

describe.skipIf(shouldSkip)('bank_tx_splits (multi-link)', () => {
  let owner: Ctx
  let intruder: Ctx
  let connectionId: string
  let accountId: string
  let txId: string

  beforeAll(async () => {
    owner = await bootstrap('splits-owner')
    intruder = await bootstrap('splits-intruder')
    // Seed: connection + account + один tx + один expense через admin.
    const { data: conn } = await owner.admin
      .from('bank_connections')
      .insert({
        salon_id: owner.salonId,
        bank_aspsp_name: 'TestBank',
        bank_country: 'PL',
        history_days: 90,
        status: 'connected',
        session_id: `splits-${Date.now()}`,
        valid_until: new Date(Date.now() + 90 * 86400_000).toISOString(),
        created_by: owner.userId,
      })
      .select('id')
      .single()
    if (!conn) throw new Error('connection insert failed')
    connectionId = conn.id as string

    const { data: acc } = await owner.admin
      .from('bank_accounts')
      .insert({
        connection_id: connectionId,
        external_id: `acc-${Date.now()}`,
        iban: 'PL61109010140000071219812874',
        currency: 'PLN',
        is_active: true,
      })
      .select('id')
      .single()
    if (!acc) throw new Error('account insert failed')
    accountId = acc.id as string

    const { data: tx } = await owner.admin
      .from('bank_transactions')
      .insert({
        account_id: accountId,
        external_id: `tx-${Date.now()}`,
        type: 'debit',
        amount_cents: 30000,
        currency: 'PLN',
        executed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (!tx) throw new Error('tx insert failed')
    txId = tx.id as string
  })

  afterAll(async () => {
    await teardown(owner)
    await teardown(intruder)
  })

  async function makeExpense(suffix: string): Promise<string> {
    const { data: cat } = await owner.admin
      .from('expense_categories')
      .insert({ salon_id: owner.salonId, name: `Test-${suffix}`, sort_order: 100 })
      .select('id')
      .single()
    if (!cat) throw new Error('category insert failed')
    const { data: exp } = await owner.admin
      .from('expenses')
      .insert({
        salon_id: owner.salonId,
        category_id: cat.id,
        expense_at: new Date().toISOString().slice(0, 10),
        amount_cents: 10000,
        payment_method: 'transfer',
        description: `Expense-${suffix}`,
        created_by: owner.userId,
      })
      .select('id')
      .single()
    if (!exp) throw new Error('expense insert failed')
    return exp.id as string
  }

  it('owner может INSERT split для своей tx', async () => {
    const expenseId = await makeExpense('A')
    const { error } = await owner.userClient.from('bank_tx_splits').insert({
      bank_transaction_id: txId,
      kind: 'expense',
      entity_id: expenseId,
      amount_cents: 10000,
    })
    expect(error).toBeNull()
  })

  it('intruder не видит чужие splits через RLS', async () => {
    const { data } = await intruder.userClient
      .from('bank_tx_splits')
      .select('id')
      .eq('bank_transaction_id', txId)
    expect(data).toEqual([])
  })

  it('UNIQUE (tx, kind, entity_id) — нельзя задублить split на ту же сущность', async () => {
    const expenseId = await makeExpense('B')
    // Первый — OK
    const r1 = await owner.userClient.from('bank_tx_splits').insert({
      bank_transaction_id: txId,
      kind: 'expense',
      entity_id: expenseId,
      amount_cents: 5000,
    })
    expect(r1.error).toBeNull()
    // Второй на ту же tx+kind+entity_id — fail
    const r2 = await owner.userClient.from('bank_tx_splits').insert({
      bank_transaction_id: txId,
      kind: 'expense',
      entity_id: expenseId,
      amount_cents: 3000,
    })
    expect(r2.error).not.toBeNull()
    expect(r2.error?.code).toBe('23505') // unique_violation
  })

  it('CHECK amount_cents > 0 — нельзя 0 или отрицательное', async () => {
    const expenseId = await makeExpense('C')
    const r = await owner.userClient.from('bank_tx_splits').insert({
      bank_transaction_id: txId,
      kind: 'expense',
      entity_id: expenseId,
      amount_cents: 0,
    })
    expect(r.error).not.toBeNull()
    expect(r.error?.message).toMatch(/check|constraint/i)
  })

  it('kind enum — принимает только expense/visit/other_income', async () => {
    const expenseId = await makeExpense('D')
    const r = await owner.userClient.from('bank_tx_splits').insert({
      bank_transaction_id: txId,
      kind: 'invalid_kind' as never,
      entity_id: expenseId,
      amount_cents: 100,
    })
    expect(r.error).not.toBeNull()
  })

  it('on delete cascade: удаление bank_transactions удаляет splits', async () => {
    // Seed: новая tx + split.
    const { data: newTx } = await owner.admin
      .from('bank_transactions')
      .insert({
        account_id: accountId,
        external_id: `tx-cascade-${Date.now()}`,
        type: 'debit',
        amount_cents: 500,
        currency: 'PLN',
        executed_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (!newTx) throw new Error('new tx insert failed')
    const expenseId = await makeExpense('E')
    await owner.userClient.from('bank_tx_splits').insert({
      bank_transaction_id: newTx.id,
      kind: 'expense',
      entity_id: expenseId,
      amount_cents: 500,
    })
    // Удаляем tx — splits должны исчезнуть
    const { error: delErr } = await owner.admin
      .from('bank_transactions')
      .delete()
      .eq('id', newTx.id)
    expect(delErr).toBeNull()
    const { data: leftover } = await owner.admin
      .from('bank_tx_splits')
      .select('id')
      .eq('bank_transaction_id', newTx.id)
    expect(leftover).toEqual([])
  })
})
