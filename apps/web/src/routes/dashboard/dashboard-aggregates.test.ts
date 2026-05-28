import { describe, expect, it } from 'vitest'

import {
  computeActiveClients,
  computeAvgRating,
  computeLocalInsights,
  computeMarketingSources,
  computeMaterialsStockPct,
  computeNeedsReactivation,
  computeNewClientsCount,
  computeNoShowsCount,
  computeOccupancyPct,
  computeOnlineBookingsPct,
  computeRegularClientsCount,
  computeRetentionPct,
  computeRevenueByCategory,
  computeRfm,
  computeTodayAppointments,
  workingDaysInRange,
} from './dashboard-aggregates'

const NOW = new Date('2026-05-28T12:00:00.000Z')

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString()
}

describe('computeRevenueByCategory', () => {
  const services = [
    { id: 's1', category_id: 'c1' },
    { id: 's2', category_id: 'c2' },
    { id: 's3', category_id: null },
  ]
  const categories = [
    { id: 'c1', name: 'Маникюр' },
    { id: 'c2', name: 'Педикюр' },
  ]

  it('пустые визиты → []', () => {
    expect(computeRevenueByCategory([], services, categories)).toEqual([])
  })

  it('только pending визиты → [] (берём только paid)', () => {
    const visits = [
      {
        service_id: 's1',
        status: 'pending' as const,
        amount_cents: 10000,
        discount_cents: 0,
        tip_cents: 0,
        paid_amount_cents: null,
        kind: 'visit' as const,
      },
    ]
    expect(computeRevenueByCategory(visits, services, categories)).toEqual([])
  })

  it('две категории — 50/50%', () => {
    const visits = [
      {
        service_id: 's1',
        status: 'paid' as const,
        amount_cents: 10000,
        discount_cents: 0,
        tip_cents: 0,
        paid_amount_cents: null,
        kind: 'visit' as const,
      },
      {
        service_id: 's2',
        status: 'paid' as const,
        amount_cents: 10000,
        discount_cents: 0,
        tip_cents: 0,
        paid_amount_cents: null,
        kind: 'visit' as const,
      },
    ]
    const result = computeRevenueByCategory(visits, services, categories)
    expect(result).toHaveLength(2)
    expect(result[0]?.pct).toBe(50)
    expect(result[1]?.pct).toBe(50)
  })

  it('retail kind → группируется как «Продажа материалов»', () => {
    const visits = [
      {
        service_id: null,
        status: 'paid' as const,
        amount_cents: 5000,
        discount_cents: 0,
        tip_cents: 0,
        paid_amount_cents: null,
        kind: 'retail' as const,
      },
    ]
    const result = computeRevenueByCategory(visits, services, categories)
    expect(result.at(0)?.name).toBe('Продажа материалов')
  })

  it('услуга без category → «Без категории»', () => {
    const visits = [
      {
        service_id: 's3',
        status: 'paid' as const,
        amount_cents: 5000,
        discount_cents: 0,
        tip_cents: 0,
        paid_amount_cents: null,
        kind: 'visit' as const,
      },
    ]
    const result = computeRevenueByCategory(visits, services, categories)
    expect(result.at(0)?.name).toBe('Без категории')
  })

  it('top-5 ограничение', () => {
    const services = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      category_id: `c${i}`,
    }))
    const categories = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      name: `Cat${i}`,
    }))
    const visits = services.map((s, i) => ({
      service_id: s.id,
      status: 'paid' as const,
      amount_cents: 10000 - i * 500,
      discount_cents: 0,
      tip_cents: 0,
      paid_amount_cents: null,
      kind: 'visit' as const,
    }))
    const result = computeRevenueByCategory(visits, services, categories)
    expect(result).toHaveLength(5)
  })
})

describe('computeNewClientsCount', () => {
  it('считает только клиентов в периоде', () => {
    const clients = [
      { created_at: '2026-05-01T00:00:00.000Z' },
      { created_at: '2026-05-15T00:00:00.000Z' },
      { created_at: '2026-04-30T23:59:59.000Z' }, // вне периода
      { created_at: '2026-06-01T00:00:00.000Z' }, // вне периода
    ]
    expect(
      computeNewClientsCount(clients, {
        start: '2026-05-01T00:00:00.000Z',
        end: '2026-06-01T00:00:00.000Z',
      }),
    ).toBe(2)
  })
})

describe('computeRegularClientsCount', () => {
  it('count(visit_count ≥ 3)', () => {
    const clients = [
      { visit_count: 0 },
      { visit_count: 2 },
      { visit_count: 3 },
      { visit_count: 10 },
    ]
    expect(computeRegularClientsCount(clients)).toBe(2)
  })
})

describe('computeRfm', () => {
  it('сегментирует по 6 корзинам', () => {
    const clients = [
      // Champion: 5+ визитов, последний ≤30 дн
      { visit_count: 7, last_visit_at: daysAgo(10), created_at: daysAgo(200) },
      // Loyal: 3+ визитов, ≤60 дн (но не champion)
      { visit_count: 4, last_visit_at: daysAgo(40), created_at: daysAgo(150) },
      // Potential (T92): 1-2 визита, last_visit ≤30 дн (не по created_at)
      { visit_count: 1, last_visit_at: daysAgo(5), created_at: daysAgo(15) },
      // Risk: 3+ визитов, 60-90 дн
      { visit_count: 5, last_visit_at: daysAgo(75), created_at: daysAgo(300) },
      // Sleep: 90-180 дн
      { visit_count: 2, last_visit_at: daysAgo(120), created_at: daysAgo(400) },
      // Lost: >180 дн
      { visit_count: 1, last_visit_at: daysAgo(300), created_at: daysAgo(500) },
    ]
    const result = computeRfm(clients, NOW)
    const byKey = Object.fromEntries(result.map((s) => [s.key, s.count]))
    expect(byKey.champions).toBe(1)
    expect(byKey.loyal).toBe(1)
    expect(byKey.potential).toBe(1)
    expect(byKey.risk).toBe(1)
    expect(byKey.sleep).toBe(1)
    expect(byKey.lost).toBe(1)
  })

  it('T92 fix: новый клиент с visit_count=0 НЕ попадает в Potential', () => {
    // Этот кейс был багом до T92: при массовом импорте 922/1000 клиентов
    // ловились в Potential потому что create_at=NOW + visit_count=0.
    // Теперь Potential требует visits ≥ 1 И last_visit ≤30 дней.
    const clients = Array.from({ length: 100 }, () => ({
      visit_count: 0,
      last_visit_at: null,
      created_at: daysAgo(5),
    }))
    const result = computeRfm(clients, NOW)
    const byKey = Object.fromEntries(result.map((s) => [s.key, s.count]))
    expect(byKey.potential).toBe(0)
    expect(byKey.lost).toBe(100)
  })

  it('T92 fix: импортированный клиент со старым визитом — не Potential', () => {
    // Booksy импорт — клиенты с created_at=NOW но last_visit полгода назад.
    // Должны идти в Lost, не в Potential.
    const clients = [
      { visit_count: 2, last_visit_at: daysAgo(200), created_at: daysAgo(5) },
    ]
    const result = computeRfm(clients, NOW)
    const byKey = Object.fromEntries(result.map((s) => [s.key, s.count]))
    expect(byKey.potential).toBe(0)
    expect(byKey.lost).toBe(1)
  })

  it('пустой список → 6 нулей', () => {
    const result = computeRfm([], NOW)
    expect(result).toHaveLength(6)
    expect(result.every((s) => s.count === 0)).toBe(true)
  })

  it('клиент без last_visit_at попадает в lost', () => {
    const result = computeRfm(
      [{ visit_count: 0, last_visit_at: null, created_at: daysAgo(400) }],
      NOW,
    )
    expect(result.find((s) => s.key === 'lost')?.count).toBe(1)
  })
})

describe('computeActiveClients', () => {
  it('считает клиентов с last_visit ≤90 дн', () => {
    const clients = [
      { last_visit_at: daysAgo(30) },
      { last_visit_at: daysAgo(89) },
      { last_visit_at: daysAgo(91) },
      { last_visit_at: null },
    ]
    expect(computeActiveClients(clients, NOW)).toBe(2)
  })
})

describe('computeNeedsReactivation', () => {
  it('клиенты 90-180 дн', () => {
    const clients = [
      { last_visit_at: daysAgo(30) }, // активный
      { last_visit_at: daysAgo(91) },
      { last_visit_at: daysAgo(180) },
      { last_visit_at: daysAgo(181) }, // потерянный
      { last_visit_at: null },
    ]
    expect(computeNeedsReactivation(clients, NOW)).toBe(2)
  })
})

describe('computeRetentionPct', () => {
  it('null если в прошлом периоде не было визитов', () => {
    const r = computeRetentionPct(
      [{ client_id: 'a', status: 'paid' }],
      [], // прошлый период пуст
    )
    expect(r.retentionPct).toBeNull()
  })

  it('50% если половина клиентов из прошлого вернулась', () => {
    const r = computeRetentionPct(
      [
        { client_id: 'a', status: 'paid' },
        { client_id: 'b', status: 'paid' },
      ],
      [
        { client_id: 'a', status: 'paid' }, // вернулся
        { client_id: 'c', status: 'paid' }, // не вернулся
      ],
    )
    expect(r.retentionPct).toBe(50)
    expect(r.returningCount).toBe(1)
    expect(r.churnedCount).toBe(1)
  })

  it('игнорирует не-paid визиты', () => {
    const r = computeRetentionPct(
      [{ client_id: 'a', status: 'pending' }],
      [{ client_id: 'a', status: 'paid' }],
    )
    expect(r.retentionPct).toBe(0)
    expect(r.churnedCount).toBe(1)
  })
})

describe('computeOccupancyPct', () => {
  it('считает % используемого времени', () => {
    // 1 мастер × 8 ч/день × 22 дня = 176 ч доступно
    // 4 визита × 60 мин = 4 ч использовано → 4/176 ≈ 2.27%
    const visits = [
      { duration_min: 60, status: 'paid' as const, kind: 'visit' as const },
      { duration_min: 60, status: 'paid' as const, kind: 'visit' as const },
      { duration_min: 60, status: 'paid' as const, kind: 'visit' as const },
      { duration_min: 60, status: 'paid' as const, kind: 'visit' as const },
    ]
    const pct = computeOccupancyPct(visits, 1)
    expect(pct).toBeCloseTo(2.27, 1)
  })

  it('null если нет активных мастеров', () => {
    expect(computeOccupancyPct([], 0)).toBeNull()
  })

  it('игнорирует retail визиты', () => {
    const visits = [{ duration_min: 60, status: 'paid' as const, kind: 'retail' as const }]
    expect(computeOccupancyPct(visits, 1)).toBe(0)
  })

  it('клипует до 100%', () => {
    // 1 мастер × 8×22 = 176 ч. Если 500 ч визитов → должно вернуть 100
    const visits = Array.from({ length: 500 }, () => ({
      duration_min: 60,
      status: 'paid' as const,
      kind: 'visit' as const,
    }))
    expect(computeOccupancyPct(visits, 1)).toBe(100)
  })

  it('null duration → fallback 60 мин', () => {
    const visits = [{ duration_min: null, status: 'paid' as const, kind: 'visit' as const }]
    const pct = computeOccupancyPct(visits, 1)
    // 1 час / 176 ч ≈ 0.568%
    expect(pct).toBeCloseTo(0.568, 1)
  })
})

describe('computeMarketingSources', () => {
  it('пустой список → []', () => {
    expect(computeMarketingSources([])).toEqual([])
  })

  it('T92: считает % по source БЕЗ humanize (raw как введено)', () => {
    // После T92 — никакого маппинга «instagram → Инстаграм». Раз юзер
    // ввёл «instagram», так и показываем. Прозрачно, без магии.
    const clients = [
      { source: 'instagram' },
      { source: 'instagram' },
      { source: 'recommendation' },
      { source: null },
    ]
    const result = computeMarketingSources(clients)
    expect(result.at(0)?.name).toBe('instagram')
    expect(result.at(0)?.pct).toBe(50)
  })

  it('T92: «Сарафан» и «сарафан» теперь две разные строки', () => {
    // Раньше humanize сваливал в одну. Теперь — раздельно (поможет юзеру
    // увидеть несогласованность в карточках клиентов и нормализовать
    // вручную).
    const clients = [{ source: 'Сарафан' }, { source: 'сарафан' }]
    const result = computeMarketingSources(clients)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const names = result.map((r) => r.name)
    expect(names).toContain('Сарафан')
    expect(names).toContain('сарафан')
  })

  it('null source → «Прочее»', () => {
    const result = computeMarketingSources([{ source: null }, { source: '' }])
    expect(result.at(0)?.name).toBe('Прочее')
  })

  it('top-5 ограничение', () => {
    const clients = Array.from({ length: 10 }, (_, i) => ({ source: `s${i}` }))
    expect(computeMarketingSources(clients)).toHaveLength(5)
  })
})

describe('computeMaterialsStockPct', () => {
  it('null если нет позиций', () => {
    expect(computeMaterialsStockPct([])).toBeNull()
  })

  it('50% если половина в норме', () => {
    const items = [
      { current_stock: 10, min_stock: 5 }, // ok
      { current_stock: 3, min_stock: 5 }, // не ok
    ]
    expect(computeMaterialsStockPct(items)).toBe(50)
  })

  it('min_stock=0 → не отслеживается → считается норма', () => {
    const items = [
      { current_stock: 0, min_stock: 0 }, // не отслеживается → ok
      { current_stock: 3, min_stock: 5 }, // не ok
    ]
    expect(computeMaterialsStockPct(items)).toBe(50)
  })
})

describe('computeTodayAppointments', () => {
  it('считает визиты сегодня кроме cancelled', () => {
    const today = new Date(NOW)
    today.setHours(10, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const visits = [
      { visit_at: today.toISOString(), status: 'pending' as const },
      { visit_at: today.toISOString(), status: 'paid' as const },
      { visit_at: today.toISOString(), status: 'cancelled' as const }, // исключён
      { visit_at: yesterday.toISOString(), status: 'paid' as const }, // не сегодня
    ]
    expect(computeTodayAppointments(visits, NOW)).toBe(2)
  })
})

describe('computeNoShowsCount', () => {
  it('считает status=cancelled', () => {
    const visits = [
      { status: 'paid' as const },
      { status: 'cancelled' as const },
      { status: 'cancelled' as const },
    ]
    expect(computeNoShowsCount(visits)).toBe(2)
  })
})

describe('computeOnlineBookingsPct', () => {
  it('null если нет визитов', () => {
    expect(computeOnlineBookingsPct([])).toBeNull()
  })

  it('считает % от booksy/online/web', () => {
    const visits: Array<{ source: string }> = [
      { source: 'booksy' },
      { source: 'online' },
      { source: 'web' },
      { source: 'manual' },
    ]
    expect(computeOnlineBookingsPct(visits)).toBe(75)
  })
})

describe('computeAvgRating', () => {
  const range = { start: '2026-05-01', end: '2026-06-01' }

  it('null если нет отзывов в периоде', () => {
    const result = computeAvgRating([], range)
    expect(result.avg).toBeNull()
    expect(result.count).toBe(0)
  })

  it('средний по отзывам в периоде', () => {
    const reviews = [
      { rating: 5, posted_at: '2026-05-10' },
      { rating: 4, posted_at: '2026-05-15' },
      { rating: 3, posted_at: '2026-04-30' }, // вне периода
    ]
    const result = computeAvgRating(reviews, range)
    expect(result.avg).toBe(4.5)
    expect(result.count).toBe(2)
  })

  it('игнорирует rating=null', () => {
    const reviews = [
      { rating: 5, posted_at: '2026-05-10' },
      { rating: null, posted_at: '2026-05-15' },
    ]
    const result = computeAvgRating(reviews, range)
    expect(result.avg).toBe(5)
    expect(result.count).toBe(1)
  })
})

describe('computeLocalInsights', () => {
  const base = {
    revenueCents: 100000,
    expenseCents: 50000,
    profitCents: 50000,
    prevRevenueCents: 100000,
    cashBalanceCents: 200000,
    needsReactivation: 0,
    lowStockCount: 0,
    occupancyPct: 75,
  }

  it('cash в минусе → critical', () => {
    const result = computeLocalInsights({ ...base, cashBalanceCents: -100 })
    expect(result.find((i) => i.id === 'cash-negative')?.severity).toBe('critical')
  })

  it('прибыль < 0 → critical', () => {
    const result = computeLocalInsights({ ...base, profitCents: -1000 })
    expect(result.find((i) => i.id === 'profit-negative')?.severity).toBe('critical')
  })

  it('выручка упала >30% → warning', () => {
    const result = computeLocalInsights({
      ...base,
      revenueCents: 60000,
      prevRevenueCents: 100000,
    })
    expect(result.find((i) => i.id === 'revenue-drop')?.severity).toBe('warning')
  })

  it('загрузка <50% → warning', () => {
    const result = computeLocalInsights({ ...base, occupancyPct: 30 })
    expect(result.find((i) => i.id === 'occupancy-low')?.severity).toBe('warning')
  })

  it('клиенты на реактивацию → info', () => {
    const result = computeLocalInsights({ ...base, needsReactivation: 10 })
    expect(result.find((i) => i.id === 'reactivation')?.severity).toBe('info')
  })

  it('low stock → warning', () => {
    const result = computeLocalInsights({ ...base, lowStockCount: 3 })
    expect(result.find((i) => i.id === 'low-stock')?.severity).toBe('warning')
  })

  it('ограничено 3 insights', () => {
    const result = computeLocalInsights({
      ...base,
      cashBalanceCents: -1,
      profitCents: -1,
      revenueCents: 1,
      prevRevenueCents: 100,
      occupancyPct: 10,
      needsReactivation: 5,
      lowStockCount: 5,
    })
    expect(result.length).toBeLessThanOrEqual(3)
  })

  it('всё ок → пусто', () => {
    expect(computeLocalInsights(base)).toEqual([])
  })
})

describe('workingDaysInRange', () => {
  it('будни (без воскресений) в неделе = 6', () => {
    // 2026-05-25 (понедельник) → 2026-05-31 (воскресенье) = 7 дней, минус 1 вс = 6
    expect(workingDaysInRange(new Date('2026-05-25'), new Date('2026-05-31'))).toBe(6)
  })

  it('один день — не воскресенье', () => {
    expect(workingDaysInRange(new Date('2026-05-27'), new Date('2026-05-27'))).toBe(1)
  })

  it('один день — воскресенье', () => {
    expect(workingDaysInRange(new Date('2026-05-31'), new Date('2026-05-31'))).toBe(1) // min 1
  })

  it('месяц май 2026 (31 день) ≈ 27 рабочих', () => {
    // 31 - кол-во воскресений (3, 10, 17, 24, 31) = 5 → 26
    expect(workingDaysInRange(new Date('2026-05-01'), new Date('2026-05-31'))).toBe(26)
  })
})
