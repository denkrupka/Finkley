/**
 * Тесты RPC из TASK-36:
 *   - compute_benchmarks() — k-anonymity ≥10
 *   - get_benchmark_comparison(salon_id) — мои метрики vs market
 *
 * Заметка про N=10: на staging/local в чистой БД нельзя достичь 10
 * opt-in салонов в одном bucket'е. Проверяем что compute_benchmarks
 * работает без ошибок и что get_benchmark_comparison корректно
 * сообщает available=false для пустого bucket'а.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, shouldSkip, teardown, type Ctx } from './_helpers'

describe.skipIf(shouldSkip)('compute_benchmarks + get_benchmark_comparison', () => {
  let ctx: Ctx | null = null

  beforeAll(async () => {
    ctx = await bootstrap('bench')
  }, 30_000)
  afterAll(async () => teardown(ctx))

  it('compute_benchmarks выполняется без ошибок (даже на пустой БД)', async () => {
    if (!ctx) throw new Error('no ctx')
    const { error } = await ctx.admin.rpc('compute_benchmarks')
    expect(error).toBeNull()
  })

  it('get_benchmark_comparison возвращает available=false если bucket пустой', async () => {
    if (!ctx) throw new Error('no ctx')
    const { data, error } = await ctx.admin.rpc('get_benchmark_comparison', {
      p_salon_id: ctx.salonId,
    })
    expect(error).toBeNull()
    const result = data as { available: boolean; reason?: string }
    expect(result.available).toBe(false)
    expect(result.reason).toBe('bucket_empty')
  })

  it('benchmarks_opt_in default = true для нового салона', async () => {
    if (!ctx) throw new Error('no ctx')
    const { data: salon } = await ctx.admin
      .from('salons')
      .select('benchmarks_opt_in')
      .eq('id', ctx.salonId)
      .single()
    expect(salon?.benchmarks_opt_in).toBe(true)
  })
})
