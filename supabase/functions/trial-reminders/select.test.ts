import { describe, expect, it } from 'vitest'

import {
  classifyTrialBucket,
  daysLeftForKind,
  deadlineDateUtc,
  effectiveTrialEndMs,
  isPaidSubscription,
  isTypeEnabled,
  templateForKind,
} from './select.ts'

const DAY = 86_400_000
// Фиксированный «сейчас» в UTC-полночь, чтобы day-floor был детерминирован.
const NOW = Date.UTC(2026, 5, 25) // 2026-06-25T00:00:00Z

describe('effectiveTrialEndMs', () => {
  it('без подписки → created_at + 14 дней', () => {
    const created = new Date(Date.UTC(2026, 5, 1)).toISOString()
    expect(effectiveTrialEndMs(null, created)).toBe(Date.UTC(2026, 5, 1) + 14 * DAY)
  })

  it('trial_ends_at позже created+14д → выигрывает trial_ends_at', () => {
    const created = new Date(Date.UTC(2026, 5, 1)).toISOString()
    const later = new Date(Date.UTC(2026, 6, 1)).toISOString()
    expect(effectiveTrialEndMs({ trial_ends_at: later }, created)).toBe(Date.UTC(2026, 6, 1))
  })

  it('bonus_until — самый поздний → выигрывает bonus_until', () => {
    const created = new Date(Date.UTC(2026, 5, 1)).toISOString()
    const trial = new Date(Date.UTC(2026, 5, 20)).toISOString()
    const bonus = new Date(Date.UTC(2026, 6, 10)).toISOString()
    expect(effectiveTrialEndMs({ trial_ends_at: trial, bonus_until: bonus }, created)).toBe(
      Date.UTC(2026, 6, 10),
    )
  })

  it('пустые поля sub → created+14д', () => {
    const created = new Date(Date.UTC(2026, 5, 1)).toISOString()
    expect(effectiveTrialEndMs({ trial_ends_at: null, bonus_until: null }, created)).toBe(
      Date.UTC(2026, 5, 1) + 14 * DAY,
    )
  })

  it('невалидная дата → 0', () => {
    expect(effectiveTrialEndMs(null, 'not-a-date')).toBe(0)
  })
})

describe('classifyTrialBucket', () => {
  it('ровно 3 UTC-дня → trial_3d', () => {
    expect(classifyTrialBucket(NOW + 3 * DAY, NOW)).toBe('trial_3d')
  })

  it('ровно 1 день → trial_1d', () => {
    expect(classifyTrialBucket(NOW + 1 * DAY, NOW)).toBe('trial_1d')
  })

  it('тот же UTC-день (0) → trial_expired', () => {
    expect(classifyTrialBucket(NOW, NOW)).toBe('trial_expired')
  })

  it('2 и 4 дня → null', () => {
    expect(classifyTrialBucket(NOW + 2 * DAY, NOW)).toBeNull()
    expect(classifyTrialBucket(NOW + 4 * DAY, NOW)).toBeNull()
  })

  it('day-floor: дедлайн через 3д+5ч всё ещё trial_3d (округление по UTC-полуночи)', () => {
    expect(classifyTrialBucket(NOW + 3 * DAY + 5 * 3_600_000, NOW + 0)).toBe('trial_3d')
  })

  it('уже просрочен (>1 дня назад) → null (дедуп закрывает single-shot)', () => {
    expect(classifyTrialBucket(NOW - 2 * DAY, NOW)).toBeNull()
  })

  it('некорректный дедлайн (0) → null', () => {
    expect(classifyTrialBucket(0, NOW)).toBeNull()
  })
})

describe('isPaidSubscription', () => {
  it('active / past_due → платный (skip)', () => {
    expect(isPaidSubscription({ status: 'active' })).toBe(true)
    expect(isPaidSubscription({ status: 'past_due' })).toBe(true)
  })

  it('trialing / canceled / null → не платный', () => {
    expect(isPaidSubscription({ status: 'trialing' })).toBe(false)
    expect(isPaidSubscription({ status: 'canceled' })).toBe(false)
    expect(isPaidSubscription(null)).toBe(false)
  })
})

describe('isTypeEnabled', () => {
  it('пустые prefs / отсутствие ключа → включено', () => {
    expect(isTypeEnabled(null, 'trial_ending')).toBe(true)
    expect(isTypeEnabled({}, 'trial_ending')).toBe(true)
  })

  it('явный false → выключено', () => {
    expect(isTypeEnabled({ trial_ending: false }, 'trial_ending')).toBe(false)
  })

  it('явный true → включено', () => {
    expect(isTypeEnabled({ trial_ending: true }, 'trial_ending')).toBe(true)
  })
})

describe('deadlineDateUtc / templateForKind / daysLeftForKind', () => {
  it('deadlineDateUtc → YYYY-MM-DD по UTC', () => {
    expect(deadlineDateUtc(Date.UTC(2026, 5, 25, 23, 59))).toBe('2026-06-25')
  })

  it('templateForKind', () => {
    expect(templateForKind('trial_3d')).toBe('trial_ending')
    expect(templateForKind('trial_1d')).toBe('trial_ending')
    expect(templateForKind('trial_expired')).toBe('trial_expired')
  })

  it('daysLeftForKind', () => {
    expect(daysLeftForKind('trial_3d')).toBe(3)
    expect(daysLeftForKind('trial_1d')).toBe(1)
    expect(daysLeftForKind('trial_expired')).toBe(0)
  })
})
