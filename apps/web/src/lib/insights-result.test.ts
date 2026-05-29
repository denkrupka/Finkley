import { describe, expect, it } from 'vitest'

import { interpretInsightsResult } from './insights-result'

describe('interpretInsightsResult (T226)', () => {
  it('error → error', () => {
    expect(interpretInsightsResult(null, { message: 'boom' })).toBe('error')
  })

  it('null result → error', () => {
    expect(interpretInsightsResult(null)).toBe('error')
  })

  it('generated=0 → no_data', () => {
    expect(interpretInsightsResult({ ok: true, generated: 0 })).toBe('no_data')
  })

  it('generated=3 → success', () => {
    expect(interpretInsightsResult({ ok: true, generated: 3 })).toBe('success')
  })

  it('generated=undefined (legacy response) → error', () => {
    expect(interpretInsightsResult({ ok: true })).toBe('error')
  })

  it('generated negative (unexpected) → error', () => {
    expect(interpretInsightsResult({ ok: true, generated: -1 })).toBe('error')
  })

  it('error has priority over result', () => {
    expect(interpretInsightsResult({ ok: true, generated: 5 }, { message: 'boom' })).toBe('error')
  })
})
