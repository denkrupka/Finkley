import { describe, expect, it } from 'vitest'

import {
  computePercent,
  computeSetupSteps,
  DAY_MS,
  ENDOWED_PERCENT,
  isAllComplete,
  isRewardEligible,
  remainingSteps,
  rewardDaysLeft,
  shouldShowSetupBar,
  type SetupProgressData,
  type SetupStepId,
} from './setup-progress'

const NOW = new Date('2026-06-18T12:00:00Z').getTime()

function makeData(over: Partial<SetupProgressData> = {}): SetupProgressData {
  return {
    salon_created: true,
    has_visit: false,
    has_expense: false,
    booksy_connected: false,
    bank_connected: false,
    dashboard_opened: false,
    created_at: new Date(NOW - 1 * DAY_MS).toISOString(),
    reward_granted_at: null,
    ...over,
  }
}

const NONE = new Set<SetupStepId>()

describe('computeSetupSteps', () => {
  it('maps server booleans to step.done', () => {
    const steps = computeSetupSteps(makeData({ has_visit: true, bank_connected: true }), NONE)
    expect(steps.find((s) => s.id === 'visit')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'bank')?.serverDone).toBe(true)
    expect(steps.find((s) => s.id === 'expense')?.done).toBe(false)
  })

  it('dismissable steps count as done when dismissed; required steps do not', () => {
    const dismissed = new Set<SetupStepId>(['booksy', 'bank', 'visit'])
    const steps = computeSetupSteps(makeData(), dismissed)
    expect(steps.find((s) => s.id === 'booksy')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'bank')?.done).toBe(true)
    // 'visit' не dismissable — пропуск игнорируется.
    expect(steps.find((s) => s.id === 'visit')?.done).toBe(false)
    expect(steps.find((s) => s.id === 'visit')?.dismissed).toBe(false)
  })
})

describe('computePercent / remainingSteps', () => {
  it('starts at ENDOWED_PERCENT with nothing done (endowed progress)', () => {
    const steps = computeSetupSteps(makeData(), NONE)
    expect(computePercent(steps)).toBe(ENDOWED_PERCENT)
    expect(remainingSteps(steps)).toBe(5)
  })

  it('reaches 100% when all five steps done/dismissed', () => {
    const data = makeData({
      has_visit: true,
      has_expense: true,
      dashboard_opened: true,
    })
    const steps = computeSetupSteps(data, new Set<SetupStepId>(['booksy', 'bank']))
    expect(isAllComplete(steps)).toBe(true)
    expect(computePercent(steps)).toBe(100)
    expect(remainingSteps(steps)).toBe(0)
  })

  it('each completed step adds 12% above the endowed baseline', () => {
    const steps = computeSetupSteps(makeData({ has_visit: true }), NONE)
    expect(computePercent(steps)).toBe(ENDOWED_PERCENT + 12)
  })
})

describe('rewardDaysLeft', () => {
  it('counts down within the 7-day window', () => {
    expect(rewardDaysLeft(new Date(NOW - 1 * DAY_MS).toISOString(), NOW)).toBe(6)
    expect(rewardDaysLeft(new Date(NOW - 7 * DAY_MS).toISOString(), NOW)).toBe(0)
    expect(rewardDaysLeft(new Date(NOW - 30 * DAY_MS).toISOString(), NOW)).toBe(0)
  })
})

describe('isRewardEligible', () => {
  const allDone = () => makeData({ has_visit: true, has_expense: true, dashboard_opened: true })

  it('eligible when all done, real data present, within window, not granted', () => {
    const data = allDone()
    const steps = computeSetupSteps(data, new Set<SetupStepId>(['booksy', 'bank']))
    expect(isRewardEligible(data, steps, NOW)).toBe(true)
  })

  it('not eligible without real visit+expense even if dismissed to 100%', () => {
    // Пользователь пропустил всё, что можно — но нет реального визита/расхода.
    const data = makeData({ dashboard_opened: true })
    const steps = computeSetupSteps(data, new Set<SetupStepId>(['booksy', 'bank']))
    // visit/expense не dismissable → не all-complete и нет реальных данных.
    expect(isRewardEligible(data, steps, NOW)).toBe(false)
  })

  it('not eligible after the 7-day window', () => {
    const data = makeData({
      has_visit: true,
      has_expense: true,
      dashboard_opened: true,
      created_at: new Date(NOW - 8 * DAY_MS).toISOString(),
    })
    const steps = computeSetupSteps(data, new Set<SetupStepId>(['booksy', 'bank']))
    expect(isRewardEligible(data, steps, NOW)).toBe(false)
  })

  it('not eligible once already granted', () => {
    const data = allDone()
    data.reward_granted_at = new Date(NOW).toISOString()
    const steps = computeSetupSteps(data, new Set<SetupStepId>(['booksy', 'bank']))
    expect(isRewardEligible(data, steps, NOW)).toBe(false)
  })
})

describe('shouldShowSetupBar', () => {
  it('hidden for non-owner roles', () => {
    const data = makeData()
    const steps = computeSetupSteps(data, NONE)
    expect(shouldShowSetupBar(data, steps, 'staff', NOW)).toBe(false)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(true)
  })

  it('hidden once reward granted', () => {
    const data = makeData({ reward_granted_at: new Date(NOW).toISOString() })
    const steps = computeSetupSteps(data, NONE)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(false)
  })

  it('hidden for salons older than 30 days', () => {
    const data = makeData({ created_at: new Date(NOW - 31 * DAY_MS).toISOString() })
    const steps = computeSetupSteps(data, NONE)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(false)
  })

  it('shown while incomplete, hidden when all done and prize no longer claimable', () => {
    const incomplete = makeData({ has_visit: true })
    expect(shouldShowSetupBar(incomplete, computeSetupSteps(incomplete, NONE), 'owner', NOW)).toBe(
      true,
    )

    // Всё сделано, но окно приза истекло (8 дней) → скрываем.
    const doneLate = makeData({
      has_visit: true,
      has_expense: true,
      dashboard_opened: true,
      created_at: new Date(NOW - 8 * DAY_MS).toISOString(),
    })
    const lateSteps = computeSetupSteps(doneLate, new Set<SetupStepId>(['booksy', 'bank']))
    expect(shouldShowSetupBar(doneLate, lateSteps, 'owner', NOW)).toBe(false)

    // Всё сделано в окне — показываем (есть кнопка забрать приз).
    const doneInWindow = makeData({
      has_visit: true,
      has_expense: true,
      dashboard_opened: true,
    })
    const winSteps = computeSetupSteps(doneInWindow, new Set<SetupStepId>(['booksy', 'bank']))
    expect(shouldShowSetupBar(doneInWindow, winSteps, 'owner', NOW)).toBe(true)
  })
})
