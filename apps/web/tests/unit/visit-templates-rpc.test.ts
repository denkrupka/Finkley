/**
 * Тесты RPC из TASK-24 финал:
 *   - upcoming_visit_templates(salon_id, horizon_days) — из visit_templates
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, shouldSkip, teardown, type Ctx } from './_helpers'

describe.skipIf(shouldSkip)('upcoming_visit_templates', () => {
  let ctx: Ctx | null = null
  let clientId = ''

  beforeAll(async () => {
    ctx = await bootstrap('templates')
    const { data: client } = await ctx!.admin
      .from('clients')
      .insert({ salon_id: ctx!.salonId, name: 'Тест Клиент' })
      .select('id')
      .single()
    clientId = client!.id
  }, 30_000)
  afterAll(async () => teardown(ctx))

  function isoDate(daysFromNow: number): string {
    const d = new Date()
    d.setDate(d.getDate() + daysFromNow)
    return d.toISOString().slice(0, 10)
  }

  it('возвращает только templates с next_due_at <= today + horizon', async () => {
    if (!ctx) throw new Error('no ctx')

    // Шаблон due через 3 дня (попадает в horizon=7)
    await ctx.admin.from('visit_templates').insert({
      salon_id: ctx.salonId,
      client_id: clientId,
      recurrence_days: 21,
      next_due_at: isoDate(3),
    })
    // Шаблон due через 30 дней (не попадает)
    await ctx.admin.from('visit_templates').insert({
      salon_id: ctx.salonId,
      client_id: clientId,
      recurrence_days: 30,
      next_due_at: isoDate(30),
    })
    // Просроченный (попадает)
    await ctx.admin.from('visit_templates').insert({
      salon_id: ctx.salonId,
      client_id: clientId,
      recurrence_days: 14,
      next_due_at: isoDate(-2),
    })

    const { data, error } = await ctx.admin.rpc('upcoming_visit_templates', {
      p_salon_id: ctx.salonId,
      p_horizon_days: 7,
    })
    expect(error).toBeNull()
    type Row = { id: string; days_until: number; client_name: string }
    const rows = (data ?? []) as Row[]
    expect(rows.length).toBe(2) // due in 3 + overdue
    // Sorted by next_due_at — overdue первый
    expect(Number(rows[0]!.days_until)).toBe(-2)
    expect(Number(rows[1]!.days_until)).toBe(3)
    // Имя клиента enriched
    expect(rows[0]!.client_name).toBe('Тест Клиент')
  })

  it('исключает paused-шаблоны', async () => {
    if (!ctx) throw new Error('no ctx')
    const { data: tpl } = await ctx.admin
      .from('visit_templates')
      .insert({
        salon_id: ctx.salonId,
        client_id: clientId,
        recurrence_days: 7,
        next_due_at: isoDate(1),
        paused_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (!tpl) throw new Error('tpl')

    const { data } = await ctx.admin.rpc('upcoming_visit_templates', {
      p_salon_id: ctx.salonId,
      p_horizon_days: 7,
    })
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
    expect(ids).not.toContain(tpl.id)
  })
})
