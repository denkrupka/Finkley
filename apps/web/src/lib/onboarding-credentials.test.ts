import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { consumeOnboardingCredentials, peekOnboardingCredentials } from './onboarding-credentials'

describe('onboarding-credentials (T150)', () => {
  const SALON_ID = 'salon-123'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  function seed(value: Record<string, Record<string, string>>): void {
    localStorage.setItem(`finkley:onboarding:credentials:${SALON_ID}`, JSON.stringify(value))
  }

  it('consume returns credentials for provider', () => {
    seed({ booksy: { email: 'a@b.c', password: 'pw' } })
    expect(consumeOnboardingCredentials(SALON_ID, 'booksy')).toEqual({
      email: 'a@b.c',
      password: 'pw',
    })
  })

  it('consume removes provider from storage', () => {
    seed({ booksy: { email: 'a@b.c' }, wfirma: { email: 'x@y.z' } })
    consumeOnboardingCredentials(SALON_ID, 'booksy')
    const remaining = JSON.parse(
      localStorage.getItem(`finkley:onboarding:credentials:${SALON_ID}`) ?? '{}',
    )
    expect(remaining).toEqual({ wfirma: { email: 'x@y.z' } })
  })

  it('consume removes storage key when all providers consumed', () => {
    seed({ booksy: { email: 'a@b.c' } })
    consumeOnboardingCredentials(SALON_ID, 'booksy')
    expect(localStorage.getItem(`finkley:onboarding:credentials:${SALON_ID}`)).toBeNull()
  })

  it('consume returns null when provider not present', () => {
    seed({ booksy: { email: 'a@b.c' } })
    expect(consumeOnboardingCredentials(SALON_ID, 'wfirma')).toBeNull()
  })

  it('consume returns null when storage empty', () => {
    expect(consumeOnboardingCredentials(SALON_ID, 'booksy')).toBeNull()
  })

  it('consume tolerates invalid JSON', () => {
    localStorage.setItem(`finkley:onboarding:credentials:${SALON_ID}`, '{invalid}')
    expect(consumeOnboardingCredentials(SALON_ID, 'booksy')).toBeNull()
  })

  it('peek returns credentials without removing', () => {
    seed({ booksy: { email: 'a@b.c' } })
    expect(peekOnboardingCredentials(SALON_ID, 'booksy')).toEqual({ email: 'a@b.c' })
    // Still there after peek.
    expect(peekOnboardingCredentials(SALON_ID, 'booksy')).toEqual({ email: 'a@b.c' })
  })

  it('peek returns null when not present', () => {
    expect(peekOnboardingCredentials(SALON_ID, 'booksy')).toBeNull()
  })

  it('per-salon isolation', () => {
    seed({ booksy: { email: 'a@b.c' } })
    expect(consumeOnboardingCredentials('other-salon', 'booksy')).toBeNull()
  })
})
