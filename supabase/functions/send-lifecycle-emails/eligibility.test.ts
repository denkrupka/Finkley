import { describe, expect, it } from 'vitest'

import {
  ageDaysUtc,
  decideActivationKind,
  DEMO_TRIAL_DAYS,
  isTrialExpiredForWinback,
} from './eligibility.ts'

const DAY = 86_400_000
// Фиксированный «сейчас» в UTC-полночь, чтобы day-floor был детерминирован.
const NOW = Date.UTC(2026, 5, 25) // 2026-06-25T00:00:00Z

describe('ageDaysUtc', () => {
  it('создан сегодня → 0', () => {
    expect(ageDaysUtc(new Date(NOW).toISOString(), NOW)).toBe(0)
  })

  it('создан 2 UTC-дня назад → 2', () => {
    expect(ageDaysUtc(new Date(NOW - 2 * DAY).toISOString(), NOW)).toBe(2)
  })

  it('day-floor: создан 2д назад +5ч всё ещё 2 (округление по UTC-полуночи)', () => {
    // created 2 UTC-дня назад, но в 05:00 того же дня → midnight всё та же дата.
    expect(ageDaysUtc(new Date(NOW - 2 * DAY + 5 * 3_600_000).toISOString(), NOW + 0)).toBe(2)
  })

  it('невалидная дата → -1', () => {
    expect(ageDaysUtc('not-a-date', NOW)).toBe(-1)
  })
})

describe('decideActivationKind', () => {
  it('day2, нет визита → activation_visit_d2', () => {
    expect(
      decideActivationKind({
        hasVisit: false,
        hasExpense: false,
        ageDays: 2,
        rewardGranted: false,
      }),
    ).toBe('activation_visit_d2')
  })

  it('day2, визит уже есть → null', () => {
    expect(
      decideActivationKind({ hasVisit: true, hasExpense: false, ageDays: 2, rewardGranted: false }),
    ).toBeNull()
  })

  it('day3, нет расхода (визит есть) → activation_visit_d3', () => {
    expect(
      decideActivationKind({ hasVisit: true, hasExpense: false, ageDays: 3, rewardGranted: false }),
    ).toBe('activation_visit_d3')
  })

  it('day3, нет визита → activation_visit_d3', () => {
    expect(
      decideActivationKind({
        hasVisit: false,
        hasExpense: false,
        ageDays: 3,
        rewardGranted: false,
      }),
    ).toBe('activation_visit_d3')
  })

  it('day3, есть и визит и расход → activation_reward_d3', () => {
    expect(
      decideActivationKind({ hasVisit: true, hasExpense: true, ageDays: 3, rewardGranted: false }),
    ).toBe('activation_reward_d3')
  })

  it('rewardGranted → null даже если всё подходит', () => {
    expect(
      decideActivationKind({ hasVisit: true, hasExpense: true, ageDays: 3, rewardGranted: true }),
    ).toBeNull()
    expect(
      decideActivationKind({ hasVisit: false, hasExpense: false, ageDays: 2, rewardGranted: true }),
    ).toBeNull()
  })

  it('ageDays 1 / 4 → null (вне окна капельной серии)', () => {
    expect(
      decideActivationKind({
        hasVisit: false,
        hasExpense: false,
        ageDays: 1,
        rewardGranted: false,
      }),
    ).toBeNull()
    expect(
      decideActivationKind({
        hasVisit: false,
        hasExpense: false,
        ageDays: 4,
        rewardGranted: false,
      }),
    ).toBeNull()
  })
})

describe('isTrialExpiredForWinback', () => {
  it('implicit-trial 15д назад без подписки → true', () => {
    expect(
      isTrialExpiredForWinback({
        status: null,
        trialEndsAt: null,
        bonusUntil: null,
        createdAtMs: NOW - 15 * DAY,
        nowMs: NOW,
      }),
    ).toBe(true)
  })

  it('implicit-trial ровно 14д назад (граница) → ещё в доступе (false)', () => {
    expect(
      isTrialExpiredForWinback({
        createdAtMs: NOW - DEMO_TRIAL_DAYS * DAY,
        nowMs: NOW,
      }),
    ).toBe(false)
  })

  it('active подписка → false', () => {
    expect(
      isTrialExpiredForWinback({
        status: 'active',
        createdAtMs: NOW - 30 * DAY,
        nowMs: NOW,
      }),
    ).toBe(false)
  })

  it('past_due подписка → false', () => {
    expect(
      isTrialExpiredForWinback({
        status: 'past_due',
        createdAtMs: NOW - 30 * DAY,
        nowMs: NOW,
      }),
    ).toBe(false)
  })

  it('bonus_until в будущем → false', () => {
    expect(
      isTrialExpiredForWinback({
        status: null,
        bonusUntil: new Date(NOW + 5 * DAY).toISOString(),
        createdAtMs: NOW - 30 * DAY,
        nowMs: NOW,
      }),
    ).toBe(false)
  })

  it('trialing с trial_ends_at в будущем → false', () => {
    expect(
      isTrialExpiredForWinback({
        status: 'trialing',
        trialEndsAt: new Date(NOW + 5 * DAY).toISOString(),
        createdAtMs: NOW - 5 * DAY,
        nowMs: NOW,
      }),
    ).toBe(false)
  })

  it('bonus_until уже истёк + implicit-trial истёк → true', () => {
    expect(
      isTrialExpiredForWinback({
        status: 'canceled',
        bonusUntil: new Date(NOW - 2 * DAY).toISOString(),
        createdAtMs: NOW - 20 * DAY,
        nowMs: NOW,
      }),
    ).toBe(true)
  })
})
