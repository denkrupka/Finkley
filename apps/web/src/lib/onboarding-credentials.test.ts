import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  consumeOnboardingCredentials,
  consumeOnboardingPrompt,
  peekOnboardingCredentials,
  saveOnboardingTransit,
} from './onboarding-credentials'

describe('onboarding-credentials (T150)', () => {
  const SALON_ID = 'salon-123'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  function seed(value: Record<string, Record<string, string>>): void {
    localStorage.setItem(`finkley:onboarding:${SALON_ID}`, JSON.stringify({ credentials: value }))
  }

  it('consume returns credentials for provider', () => {
    seed({ booksy: { email: 'a@b.c', password: 'pw' } })
    expect(consumeOnboardingCredentials(SALON_ID, 'booksy')).toEqual({
      email: 'a@b.c',
      password: 'pw',
    })
  })

  it('consume removes provider from storage (T199 unified key)', () => {
    seed({ booksy: { email: 'a@b.c' }, wfirma: { email: 'x@y.z' } })
    consumeOnboardingCredentials(SALON_ID, 'booksy')
    const raw = localStorage.getItem(`finkley:onboarding:${SALON_ID}`)
    const remaining = raw ? JSON.parse(raw) : null
    expect(remaining?.credentials ?? {}).toEqual({ wfirma: { email: 'x@y.z' } })
  })

  it('consume removes storage key when all providers consumed', () => {
    seed({ booksy: { email: 'a@b.c' } })
    consumeOnboardingCredentials(SALON_ID, 'booksy')
    expect(localStorage.getItem(`finkley:onboarding:${SALON_ID}`)).toBeNull()
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

describe('saveOnboardingTransit + consumeOnboardingPrompt (T199)', () => {
  const SALON_ID = 'salon-xyz'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('save credentials only — prompt is null', () => {
    saveOnboardingTransit(SALON_ID, { credentials: { booksy: { email: 'a@b.c' } } })
    expect(consumeOnboardingPrompt(SALON_ID)).toBeNull()
    expect(consumeOnboardingCredentials(SALON_ID, 'booksy')).toEqual({ email: 'a@b.c' })
  })

  it('save prompt only — credentials are absent', () => {
    saveOnboardingTransit(SALON_ID, { prompt: 'booksy,wfirma' })
    expect(consumeOnboardingPrompt(SALON_ID)).toBe('booksy,wfirma')
    expect(consumeOnboardingCredentials(SALON_ID, 'booksy')).toBeNull()
  })

  it('save both in one transit', () => {
    saveOnboardingTransit(SALON_ID, {
      credentials: { wfirma: { email: 'a@b.c', password: 'pw' } },
      prompt: 'wfirma,banking',
    })
    expect(consumeOnboardingPrompt(SALON_ID)).toBe('wfirma,banking')
    expect(consumeOnboardingCredentials(SALON_ID, 'wfirma')).toEqual({
      email: 'a@b.c',
      password: 'pw',
    })
  })

  it('consumeOnboardingPrompt removes prompt but keeps credentials', () => {
    saveOnboardingTransit(SALON_ID, {
      credentials: { booksy: { email: 'a@b.c' } },
      prompt: 'booksy',
    })
    consumeOnboardingPrompt(SALON_ID)
    expect(consumeOnboardingPrompt(SALON_ID)).toBeNull()
    expect(consumeOnboardingCredentials(SALON_ID, 'booksy')).toEqual({ email: 'a@b.c' })
  })

  it('consume both → storage entry removed', () => {
    saveOnboardingTransit(SALON_ID, {
      credentials: { booksy: { email: 'a@b.c' } },
      prompt: 'booksy',
    })
    consumeOnboardingPrompt(SALON_ID)
    consumeOnboardingCredentials(SALON_ID, 'booksy')
    expect(localStorage.getItem(`finkley:onboarding:${SALON_ID}`)).toBeNull()
  })

  it('consumeOnboardingPrompt returns null when nothing stored', () => {
    expect(consumeOnboardingPrompt(SALON_ID)).toBeNull()
  })
})
