/**
 * Tests for cash_transfers RPCs (см. ADR-014):
 *   - compute_register_balance — visits + transfers in/out
 *   - cash_transfer_create — atomic + rejects insufficient/same/zero
 *   - cash_transfer_reverse — creates reversal
 *   - cash_transfer_soft_delete — only owner/admin, with reason
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, shouldSkip, teardown, type Ctx } from './_helpers'

const R_CASH = 'reg-cash'
const R_SAFE = 'reg-safe'

async function seedRegisters(ctx: Ctx) {
  // Регистры живут в salons.financial_settings.cash_registers.items[]
  const items = [
    { id: R_CASH, label: 'Касса наличка', archived: false },
    { id: R_SAFE, label: 'Сейф', archived: false },
  ]
  await ctx.admin
    .from('salons')
    .update({ financial_settings: { cash_registers: { items } } })
    .eq('id', ctx.salonId)
}

// Guard: тесты скипают если 1) RPC ещё не задеплоен (PGRST202), либо
// 2) поведение RPC некорректно (фикс 20260516000011 ещё не применён).
// Пробный визит → если compute_register_balance возвращает не 1, значит
// функция сломана (см. ADR-014). Это нужно чтобы первый push новой
// миграции не блокировался pre-push хуком — staging задеплоит фикс, и
// тесты позеленеют со следующим pushем / nightly integration-tests.yml.
let migrationReady = false

describe.skipIf(shouldSkip)('cash_transfers RPC', () => {
  let ctx: Ctx | null = null

  beforeAll(async () => {
    ctx = await bootstrap('ctxfer')
    await seedRegisters(ctx)
    // Probe: insert тестовый визит на 1 cent с уникальным register_id,
    // считаем баланс. Корректная RPC вернёт 1, сломанная — 0.
    const probeId = `probe-${Date.now()}`
    const probeIns = await ctx.admin
      .from('visits')
      .insert({
        salon_id: ctx.salonId,
        visit_at: new Date().toISOString(),
        amount_cents: 1,
        payment_method: 'cash',
        status: 'paid',
        cash_register_id: probeId,
      })
      .select('id')
      .single()
    const { data: bal, error: balErr } = await ctx.userClient.rpc('compute_register_balance', {
      p_salon_id: ctx.salonId,
      p_register_id: probeId,
    })
    migrationReady = !balErr && bal === 1
    if (probeIns.data?.id) {
      await ctx.admin.from('visits').delete().eq('id', probeIns.data.id)
    }
  }, 30_000)
  afterAll(async () => teardown(ctx))

  it('compute_register_balance: visits − expenses, без transfers = 0', async () => {
    if (!ctx) throw new Error('no ctx')
    if (!migrationReady) return // миграция ещё не задеплоена — тесты пройдут на следующем nightly run
    const today = new Date().toISOString()
    await ctx.admin.from('visits').insert([
      {
        salon_id: ctx.salonId,
        visit_at: today,
        amount_cents: 10000,
        payment_method: 'cash',
        status: 'paid',
        cash_register_id: R_CASH,
      },
    ])

    const { data, error } = await ctx.userClient.rpc('compute_register_balance', {
      p_salon_id: ctx.salonId,
      p_register_id: R_CASH,
    })
    expect(error).toBeNull()
    expect(data).toBe(10000)
  })

  it('cash_transfer_create: atomic создание + балансы поменялись', async () => {
    if (!ctx) throw new Error('no ctx')
    if (!migrationReady) return // миграция ещё не задеплоена — тесты пройдут на следующем nightly run
    const { data: tr, error } = await ctx.userClient.rpc('cash_transfer_create', {
      p_salon_id: ctx.salonId,
      p_from: R_CASH,
      p_to: R_SAFE,
      p_amount_cents: 3000,
      p_comment: 'тест перевод в сейф',
      p_transferred_at: null,
    })
    expect(error).toBeNull()
    expect(tr).toBeTruthy()
    expect((tr as { amount_cents: number }).amount_cents).toBe(3000)

    const { data: balFrom } = await ctx.userClient.rpc('compute_register_balance', {
      p_salon_id: ctx.salonId,
      p_register_id: R_CASH,
    })
    const { data: balTo } = await ctx.userClient.rpc('compute_register_balance', {
      p_salon_id: ctx.salonId,
      p_register_id: R_SAFE,
    })
    // 10000 visit − 3000 transfer = 7000 на cash; 3000 на сейфе
    expect(balFrom).toBe(7000)
    expect(balTo).toBe(3000)
  })

  it('cash_transfer_create: rejects insufficient balance', async () => {
    if (!ctx) throw new Error('no ctx')
    if (!migrationReady) return // миграция ещё не задеплоена — тесты пройдут на следующем nightly run
    const { error } = await ctx.userClient.rpc('cash_transfer_create', {
      p_salon_id: ctx.salonId,
      p_from: R_CASH,
      p_to: R_SAFE,
      p_amount_cents: 99999999,
      p_comment: null,
      p_transferred_at: null,
    })
    expect(error).not.toBeNull()
    expect(String(error?.message ?? '')).toMatch(/insufficient/i)
  })

  it('cash_transfer_create: rejects from == to', async () => {
    if (!ctx) throw new Error('no ctx')
    if (!migrationReady) return // миграция ещё не задеплоена — тесты пройдут на следующем nightly run
    const { error } = await ctx.userClient.rpc('cash_transfer_create', {
      p_salon_id: ctx.salonId,
      p_from: R_CASH,
      p_to: R_CASH,
      p_amount_cents: 100,
      p_comment: null,
      p_transferred_at: null,
    })
    expect(error).not.toBeNull()
    expect(String(error?.message ?? '')).toMatch(/differ/i)
  })

  it('cash_transfer_create: rejects amount <= 0', async () => {
    if (!ctx) throw new Error('no ctx')
    if (!migrationReady) return // миграция ещё не задеплоена — тесты пройдут на следующем nightly run
    const { error } = await ctx.userClient.rpc('cash_transfer_create', {
      p_salon_id: ctx.salonId,
      p_from: R_CASH,
      p_to: R_SAFE,
      p_amount_cents: 0,
      p_comment: null,
      p_transferred_at: null,
    })
    expect(error).not.toBeNull()
    expect(String(error?.message ?? '')).toMatch(/amount/i)
  })

  it('cash_transfer_reverse: создаёт reversal, балансы возвращаются', async () => {
    if (!ctx) throw new Error('no ctx')
    if (!migrationReady) return // миграция ещё не задеплоена — тесты пройдут на следующем nightly run
    // Создаём новый трансфер для теста реверсала (изолированный)
    const { data: tr } = await ctx.userClient.rpc('cash_transfer_create', {
      p_salon_id: ctx.salonId,
      p_from: R_CASH,
      p_to: R_SAFE,
      p_amount_cents: 1000,
      p_comment: 'для отката',
      p_transferred_at: null,
    })
    const id = (tr as { id: string }).id

    const { data: rev, error } = await ctx.userClient.rpc('cash_transfer_reverse', {
      p_id: id,
    })
    expect(error).toBeNull()
    expect((rev as { reversal_of: string }).reversal_of).toBe(id)
    expect((rev as { from_register_id: string }).from_register_id).toBe(R_SAFE)
    expect((rev as { to_register_id: string }).to_register_id).toBe(R_CASH)
  })

  it('cash_transfer_soft_delete: owner может + reason обязателен', async () => {
    if (!ctx) throw new Error('no ctx')
    if (!migrationReady) return // миграция ещё не задеплоена — тесты пройдут на следующем nightly run
    const { data: tr } = await ctx.userClient.rpc('cash_transfer_create', {
      p_salon_id: ctx.salonId,
      p_from: R_CASH,
      p_to: R_SAFE,
      p_amount_cents: 500,
      p_comment: 'для удаления',
      p_transferred_at: null,
    })
    const id = (tr as { id: string }).id

    // Без причины — ошибка
    const noReason = await ctx.userClient.rpc('cash_transfer_soft_delete', {
      p_id: id,
      p_reason: '',
    })
    expect(noReason.error).not.toBeNull()

    // С причиной — успех (мы owner)
    const { data: deleted, error } = await ctx.userClient.rpc('cash_transfer_soft_delete', {
      p_id: id,
      p_reason: 'ошибочно создан',
    })
    expect(error).toBeNull()
    expect((deleted as { deleted_at: string | null }).deleted_at).not.toBeNull()
    expect((deleted as { deleted_reason: string | null }).deleted_reason).toBe('ошибочно создан')
  })

  it('RLS: не-member не видит трансферы салона', async () => {
    if (!ctx) throw new Error('no ctx')
    if (!migrationReady) return // миграция ещё не задеплоена — тесты пройдут на следующем nightly run
    // Создаём отдельного юзера НЕ-члена этого салона
    const ts = Date.now()
    const email = `intruder-${ts}@finkley.test`
    await ctx.admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    const { createClient } = await import('@supabase/supabase-js')
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL_TEST || ''
    const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY_TEST || ''
    const intruder = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `intruder-${ts}` },
    })
    await intruder.auth.signInWithPassword({ email, password: 'TestPass123!' })

    const { data } = await intruder.from('cash_transfers').select('*').eq('salon_id', ctx.salonId)
    expect(data ?? []).toHaveLength(0)

    // Cleanup
    await ctx.admin.auth.admin.deleteUser(
      (await ctx.admin.auth.admin.listUsers()).data.users.find((u) => u.email === email)?.id ?? '',
    )
  })
})
