import { describe, expect, it } from 'vitest'

import {
  computePercent,
  computeSetupSteps,
  DAY_MS,
  ENDOWED_PERCENT,
  groupSetupSteps,
  isAllComplete,
  isCoreComplete,
  isRewardEligible,
  MAX_VISIBLE_AGE_DAYS,
  remainingExtraSteps,
  remainingSteps,
  rewardDaysLeft,
  SETUP_GROUP_ORDER,
  SETUP_PROGRESS_DEFAULTS,
  SETUP_REQUIRED_STEPS,
  SETUP_STEP_ORDER,
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
    ...SETUP_PROGRESS_DEFAULTS,
    ...over,
  }
}

const NONE = new Set<SetupStepId>()

/** Полностью заполненные серверные данные — все шаги serverDone=true. */
function makeAllServerDone(over: Partial<SetupProgressData> = {}): SetupProgressData {
  return makeData({
    has_visit: true,
    has_expense: true,
    booksy_connected: true,
    bank_connected: true,
    dashboard_opened: true,
    has_first_client_closed: true,
    has_expense_calculated: true,
    has_scheduled_payment: true,
    bank_synced: true,
    has_bank_tx_linked: true,
    has_finance_report: true,
    has_competitor: true,
    has_social_page: true,
    has_google_profile: true,
    has_inventory_item: true,
    has_marketing_broadcast: true,
    has_messenger_message: true,
    ai_assistant_seen: true,
    booking_connected: true,
    any_integration: true,
    ...over,
  })
}

/** Все extra-шаги, которые можно пропустить (для удобного «всё dismissed»). */
const ALL_DISMISSABLE: SetupStepId[] = SETUP_STEP_ORDER.filter(
  (id) => id !== 'visit' && id !== 'expense' && id !== 'dashboard',
)

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

  it('maps v2 extra server booleans and marks them as non-required', () => {
    const steps = computeSetupSteps(
      makeData({ has_competitor: true, has_inventory_item: true, ai_assistant_seen: true }),
      NONE,
    )
    expect(steps.find((s) => s.id === 'competitor')?.serverDone).toBe(true)
    expect(steps.find((s) => s.id === 'competitor')?.required).toBe(false)
    expect(steps.find((s) => s.id === 'inventory_item')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'ai_assistant')?.done).toBe(true)
    // extra-шаги, не выполненные на сервере, остаются not-done
    expect(steps.find((s) => s.id === 'finance_report')?.done).toBe(false)
  })

  it('renders the full ordered checklist with the 5 core steps required', () => {
    const steps = computeSetupSteps(makeData(), NONE)
    expect(steps.length).toBe(SETUP_STEP_ORDER.length)
    expect(steps.filter((s) => s.required).map((s) => s.id)).toEqual(SETUP_REQUIRED_STEPS)
    expect(SETUP_REQUIRED_STEPS).toEqual(['visit', 'expense', 'booksy', 'bank', 'dashboard'])
  })
})

describe('computePercent / remainingSteps (all non-dismissed steps)', () => {
  it('starts at ENDOWED_PERCENT with nothing done (endowed progress)', () => {
    const steps = computeSetupSteps(makeData(), NONE)
    expect(computePercent(steps)).toBe(ENDOWED_PERCENT)
    // remaining = все незадизмиссенные = весь набор
    expect(remainingSteps(steps)).toBe(SETUP_STEP_ORDER.length)
  })

  it('counts extra steps toward the percentage (not only core)', () => {
    // Один extra-шаг сделан → процент чуть выше endowed (а раньше extra игнорился).
    const steps = computeSetupSteps(makeData({ has_competitor: true }), NONE)
    expect(computePercent(steps)).toBeGreaterThan(ENDOWED_PERCENT)
    expect(remainingSteps(steps)).toBe(SETUP_STEP_ORDER.length - 1)
  })

  it('does NOT reach 100% when only the 5 core steps are done but extra remain', () => {
    // Регрессия бага «100% · всё готово» при незавершённых extra-заданиях.
    const data = makeData({
      has_visit: true,
      has_expense: true,
      booksy_connected: true,
      bank_connected: true,
      dashboard_opened: true,
    })
    const steps = computeSetupSteps(data, NONE)
    expect(isCoreComplete(steps)).toBe(true)
    expect(isAllComplete(steps)).toBe(false)
    expect(computePercent(steps)).toBeLessThan(100)
    expect(remainingSteps(steps)).toBeGreaterThan(0)
  })

  it('reaches 100% only when every step is done or dismissed', () => {
    // Core реально сделан, все остальные dismissable — пропущены.
    const data = makeData({ has_visit: true, has_expense: true, dashboard_opened: true })
    const steps = computeSetupSteps(data, new Set<SetupStepId>(ALL_DISMISSABLE))
    expect(isAllComplete(steps)).toBe(true)
    expect(computePercent(steps)).toBe(100)
    expect(remainingSteps(steps)).toBe(0)
  })

  it('reaches 100% when all server-done (no dismissals)', () => {
    const steps = computeSetupSteps(makeAllServerDone(), NONE)
    expect(isAllComplete(steps)).toBe(true)
    expect(computePercent(steps)).toBe(100)
    expect(remainingSteps(steps)).toBe(0)
  })

  it('dismissed steps drop out of the denominator', () => {
    // База: один шаг реально сделан → ненулевой числитель.
    const base = computeSetupSteps(makeData({ has_visit: true }), NONE)
    const basePercent = computePercent(base)
    // Тот же сделанный шаг, но пропущены все остальные dismissable-шаги →
    // знаменатель схлопывается до незадизмиссенных (core + сам visit),
    // та же done-доля весит сильно больше → процент заметно растёт.
    const withDismiss = computeSetupSteps(
      makeData({ has_visit: true }),
      new Set<SetupStepId>(ALL_DISMISSABLE),
    )
    expect(computePercent(withDismiss)).toBeGreaterThan(basePercent)
  })

  it('remainingExtraSteps drops when extra steps are done', () => {
    const base = computeSetupSteps(makeData(), NONE)
    const some = computeSetupSteps(
      makeData({ has_competitor: true, has_inventory_item: true }),
      NONE,
    )
    expect(remainingExtraSteps(some)).toBe(remainingExtraSteps(base) - 2)
  })
})

describe('isCoreComplete vs isAllComplete', () => {
  it('core complete does not imply all complete', () => {
    const data = makeData({
      has_visit: true,
      has_expense: true,
      booksy_connected: true,
      bank_connected: true,
      dashboard_opened: true,
    })
    const steps = computeSetupSteps(data, NONE)
    expect(isCoreComplete(steps)).toBe(true)
    expect(isAllComplete(steps)).toBe(false)
  })

  it('all complete implies core complete', () => {
    const steps = computeSetupSteps(makeAllServerDone(), NONE)
    expect(isAllComplete(steps)).toBe(true)
    expect(isCoreComplete(steps)).toBe(true)
  })
})

describe('groupSetupSteps', () => {
  it('groups steps by category in SETUP_GROUP_ORDER and counts done/total', () => {
    const steps = computeSetupSteps(makeData({ has_visit: true }), NONE)
    const groups = groupSetupSteps(steps)
    expect(groups.map((g) => g.group)).toEqual(
      SETUP_GROUP_ORDER.filter((g) => steps.some((s) => s.group === g)),
    )
    const income = groups.find((g) => g.group === 'income')
    expect(income).toBeDefined()
    expect(income?.steps.some((s) => s.id === 'visit')).toBe(true)
    expect(income?.doneCount).toBe(1) // visit done
    expect(income?.complete).toBe(false)
  })

  it('marks a group complete when all its steps are done/dismissed', () => {
    const steps = computeSetupSteps(makeAllServerDone(), NONE)
    const groups = groupSetupSteps(steps)
    expect(groups.every((g) => g.complete)).toBe(true)
  })

  it('every step lands in exactly one returned group', () => {
    const steps = computeSetupSteps(makeData(), NONE)
    const groups = groupSetupSteps(steps)
    const total = groups.reduce((sum, g) => sum + g.total, 0)
    expect(total).toBe(steps.length)
  })
})

describe('rewardDaysLeft', () => {
  it('counts down within the 7-day window', () => {
    expect(rewardDaysLeft(new Date(NOW - 1 * DAY_MS).toISOString(), NOW)).toBe(6)
    expect(rewardDaysLeft(new Date(NOW - 7 * DAY_MS).toISOString(), NOW)).toBe(0)
    expect(rewardDaysLeft(new Date(NOW - 30 * DAY_MS).toISOString(), NOW)).toBe(0)
  })
})

describe('isRewardEligible (gated on CORE, not 100%)', () => {
  const coreDone = () =>
    makeData({
      has_visit: true,
      has_expense: true,
      booksy_connected: true,
      bank_connected: true,
      dashboard_opened: true,
    })

  it('eligible when CORE complete even if extra steps remain', () => {
    const data = coreDone()
    const steps = computeSetupSteps(data, NONE)
    // НЕ всё сделано (extra остались), но награда за CORE доступна.
    expect(isAllComplete(steps)).toBe(false)
    expect(isRewardEligible(data, steps, NOW)).toBe(true)
  })

  it('eligible when core done via real visit/expense + dismissed booksy/bank', () => {
    const data = makeData({ has_visit: true, has_expense: true, dashboard_opened: true })
    const steps = computeSetupSteps(data, new Set<SetupStepId>(['booksy', 'bank']))
    expect(isCoreComplete(steps)).toBe(true)
    expect(isRewardEligible(data, steps, NOW)).toBe(true)
  })

  it('not eligible without real visit+expense even if dismissed', () => {
    const data = makeData({ dashboard_opened: true })
    const steps = computeSetupSteps(data, new Set<SetupStepId>(['booksy', 'bank']))
    expect(isRewardEligible(data, steps, NOW)).toBe(false)
  })

  it('not eligible after the 7-day window', () => {
    const data = coreDone()
    data.created_at = new Date(NOW - 8 * DAY_MS).toISOString()
    const steps = computeSetupSteps(data, NONE)
    expect(isRewardEligible(data, steps, NOW)).toBe(false)
  })

  it('not eligible once already granted', () => {
    const data = coreDone()
    data.reward_granted_at = new Date(NOW).toISOString()
    const steps = computeSetupSteps(data, NONE)
    expect(isRewardEligible(data, steps, NOW)).toBe(false)
  })
})

describe('shouldShowSetupBar (visible until all done/dismissed)', () => {
  it('hidden for non-owner roles', () => {
    const data = makeData()
    const steps = computeSetupSteps(data, NONE)
    expect(shouldShowSetupBar(data, steps, 'staff', NOW)).toBe(false)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(true)
  })

  it('STAYS visible after reward granted while extra steps remain', () => {
    // Награда выдана, но extra-задачи не завершены → бар не прячем.
    const data = makeData({
      has_visit: true,
      has_expense: true,
      booksy_connected: true,
      bank_connected: true,
      dashboard_opened: true,
      reward_granted_at: new Date(NOW).toISOString(),
    })
    const steps = computeSetupSteps(data, NONE)
    expect(isAllComplete(steps)).toBe(false)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(true)
  })

  it('STAYS visible when all core complete but extra steps remain (the 100% bug fix)', () => {
    const data = makeData({
      has_visit: true,
      has_expense: true,
      booksy_connected: true,
      bank_connected: true,
      dashboard_opened: true,
    })
    const steps = computeSetupSteps(data, NONE)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(true)
  })

  it('hidden once every step is done or dismissed', () => {
    const data = makeData({ has_visit: true, has_expense: true, dashboard_opened: true })
    const steps = computeSetupSteps(data, new Set<SetupStepId>(ALL_DISMISSABLE))
    expect(isAllComplete(steps)).toBe(true)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(false)
  })

  it('hidden when all server-done', () => {
    const data = makeAllServerDone()
    const steps = computeSetupSteps(data, NONE)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(false)
  })

  it('hidden for salons older than the backstop age', () => {
    const data = makeData({
      created_at: new Date(NOW - (MAX_VISIBLE_AGE_DAYS + 1) * DAY_MS).toISOString(),
    })
    const steps = computeSetupSteps(data, NONE)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(false)
  })

  it('still visible at 31 days (no longer the old 30-day cap)', () => {
    const data = makeData({ created_at: new Date(NOW - 31 * DAY_MS).toISOString() })
    const steps = computeSetupSteps(data, NONE)
    expect(shouldShowSetupBar(data, steps, 'owner', NOW)).toBe(true)
  })
})
