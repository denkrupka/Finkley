import { describe, it, expect } from 'vitest'

import { computeDurationMin } from './booksy-duration'

describe('computeDurationMin', () => {
  it('60 минут при типичной паре', () => {
    expect(computeDurationMin('2026-05-21T10:00', '2026-05-21T11:00')).toBe(60)
  })

  it('2 часа = 120 минут (regression: Manicure hybrydowy)', () => {
    expect(computeDurationMin('2026-05-20T14:00', '2026-05-20T16:00')).toBe(120)
  })

  it('30 минут', () => {
    expect(computeDurationMin('2026-05-21T15:00', '2026-05-21T15:30')).toBe(30)
  })

  it('null если from/till отсутствуют', () => {
    expect(computeDurationMin(null, '2026-05-21T11:00')).toBeNull()
    expect(computeDurationMin('2026-05-21T10:00', null)).toBeNull()
    expect(computeDurationMin(undefined, undefined)).toBeNull()
  })

  it('null если till раньше from', () => {
    expect(computeDurationMin('2026-05-21T11:00', '2026-05-21T10:00')).toBeNull()
  })

  it('null если till === from', () => {
    expect(computeDurationMin('2026-05-21T10:00', '2026-05-21T10:00')).toBeNull()
  })

  it('через полночь — 30 мин', () => {
    expect(computeDurationMin('2026-05-21T23:45', '2026-05-22T00:15')).toBe(30)
  })
})
