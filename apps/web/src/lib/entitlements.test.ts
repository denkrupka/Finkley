import { describe, expect, it } from 'vitest'

import {
  canAccessSection,
  canCreateMultipleSalons,
  DEMO_TRIAL_DAYS,
  effectivePlan,
  GRANDFATHER_BEFORE,
  upgradeTargetForSection,
  type SubscriptionLike,
} from './entitlements'

const DAY = 24 * 60 * 60 * 1000
// «Сейчас» сильно позже даты грандфазеринга, чтобы новые салоны не попадали под него.
const NOW = new Date('2026-08-01T12:00:00Z').getTime()

describe('canAccessSection', () => {
  it('free unlocks only income/dashboard/settings', () => {
    expect(canAccessSection('free', 'income')).toBe(true)
    expect(canAccessSection('free', 'dashboard')).toBe(true)
    expect(canAccessSection('free', 'expenses')).toBe(false)
    expect(canAccessSection('free', 'reports')).toBe(false)
    expect(canAccessSection('free', 'ai')).toBe(false)
  })

  it('t19 unlocks expenses/reports/messenger but not marketing/ai/finance', () => {
    expect(canAccessSection('t19', 'expenses')).toBe(true)
    expect(canAccessSection('t19', 'reports')).toBe(true)
    expect(canAccessSection('t19', 'messenger')).toBe(true)
    expect(canAccessSection('t19', 'marketing')).toBe(false)
    expect(canAccessSection('t19', 'ai')).toBe(false)
    expect(canAccessSection('t19', 'finance')).toBe(false)
  })

  it('t49 adds marketing/ai but not finance/inventory', () => {
    expect(canAccessSection('t49', 'marketing')).toBe(true)
    expect(canAccessSection('t49', 'ai')).toBe(true)
    expect(canAccessSection('t49', 'finance')).toBe(false)
    expect(canAccessSection('t49', 'inventory')).toBe(false)
  })

  it('t69 and demo unlock everything', () => {
    for (const s of ['finance', 'inventory', 'marketing', 'ai', 'expenses'] as const) {
      expect(canAccessSection('t69', s)).toBe(true)
      expect(canAccessSection('demo', s)).toBe(true)
    }
  })
})

describe('upgradeTargetForSection', () => {
  it('points to the cheapest unlocking plan', () => {
    expect(upgradeTargetForSection('expenses')).toBe('t19')
    expect(upgradeTargetForSection('marketing')).toBe('t49')
    expect(upgradeTargetForSection('finance')).toBe('t69')
  })
})

describe('effectivePlan', () => {
  const recentCreated = new Date(NOW - 2 * DAY).toISOString()
  // Создан ПОСЛЕ cutoff грандфазеринга, но старше 14-дневного demo-окна.
  const oldCreated = new Date(NOW - 30 * DAY).toISOString()
  const grandfatheredCreated = new Date(new Date(GRANDFATHER_BEFORE).getTime() - DAY).toISOString()

  it('no sub + within demo window → demo', () => {
    expect(effectivePlan(null, recentCreated, NOW)).toBe('demo')
  })

  it('no sub + past demo window → free', () => {
    expect(effectivePlan(null, oldCreated, NOW)).toBe('free')
  })

  it('grandfathers salons created before launch → demo', () => {
    expect(effectivePlan(null, grandfatheredCreated, NOW)).toBe('demo')
  })

  it('active paid subscription → its plan', () => {
    const sub: SubscriptionLike = {
      status: 'active',
      plan: 't49',
      trial_ends_at: null,
      bonus_until: null,
    }
    expect(effectivePlan(sub, oldCreated, NOW)).toBe('t49')
  })

  it('active trial → demo (full access)', () => {
    const sub: SubscriptionLike = {
      status: 'trialing',
      plan: 't19',
      trial_ends_at: new Date(NOW + 5 * DAY).toISOString(),
      bonus_until: null,
    }
    expect(effectivePlan(sub, oldCreated, NOW)).toBe('demo')
  })

  it('expired trial → free', () => {
    const sub: SubscriptionLike = {
      status: 'trialing',
      plan: 't19',
      trial_ends_at: new Date(NOW - 1 * DAY).toISOString(),
      bonus_until: null,
    }
    expect(effectivePlan(sub, oldCreated, NOW)).toBe('free')
  })

  it('bonus_until in the future (reward/admin grant) → demo', () => {
    const sub: SubscriptionLike = {
      status: 'canceled',
      plan: null,
      trial_ends_at: null,
      bonus_until: new Date(NOW + 10 * DAY).toISOString(),
    }
    expect(effectivePlan(sub, oldCreated, NOW)).toBe('demo')
  })

  it('canceled with no bonus → free', () => {
    const sub: SubscriptionLike = {
      status: 'canceled',
      plan: 't69',
      trial_ends_at: null,
      bonus_until: null,
    }
    expect(effectivePlan(sub, oldCreated, NOW)).toBe('free')
  })
})

describe('canCreateMultipleSalons', () => {
  it('only t99 and demo allow multi-salon', () => {
    expect(canCreateMultipleSalons('t99')).toBe(true)
    expect(canCreateMultipleSalons('demo')).toBe(true)
    expect(canCreateMultipleSalons('t69')).toBe(false)
    expect(canCreateMultipleSalons('free')).toBe(false)
  })
})

void DEMO_TRIAL_DAYS
