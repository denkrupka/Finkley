import { describe, expect, it } from 'vitest'

import {
  ACCOUNTING_PORTAL_OPTIONS,
  findAccountingPortal,
  type AccountingPortalOption,
} from './portals'

describe('ACCOUNTING_PORTAL_OPTIONS', () => {
  it('содержит wFirma / Fakturownia / inFakt / KSeF / other', () => {
    const values = ACCOUNTING_PORTAL_OPTIONS.map((p) => p.value)
    expect(values).toEqual(['wfirma', 'fakturownia', 'infakt', 'ksef', 'other'])
  })

  it('каждый портал (кроме other) имеет integration_provider', () => {
    for (const p of ACCOUNTING_PORTAL_OPTIONS) {
      if (p.value === 'other') {
        expect(p.integration_provider).toBeUndefined()
      } else {
        expect(p.integration_provider).toBe(p.value)
      }
    }
  })

  it('все label непустые', () => {
    for (const p of ACCOUNTING_PORTAL_OPTIONS) {
      expect(p.label.length).toBeGreaterThan(0)
    }
  })

  it('values уникальны', () => {
    const set = new Set(ACCOUNTING_PORTAL_OPTIONS.map((p) => p.value))
    expect(set.size).toBe(ACCOUNTING_PORTAL_OPTIONS.length)
  })
})

describe('findAccountingPortal', () => {
  it('возвращает option по value', () => {
    const r = findAccountingPortal('wfirma')
    expect(r).not.toBeNull()
    expect((r as AccountingPortalOption).label).toBe('wFirma')
  })

  it('возвращает null для unknown', () => {
    expect(findAccountingPortal('unknown_xyz')).toBeNull()
  })

  it('возвращает null для empty/null/undefined', () => {
    expect(findAccountingPortal('')).toBeNull()
    expect(findAccountingPortal(null)).toBeNull()
    expect(findAccountingPortal(undefined)).toBeNull()
  })

  it('other — корректно резолвится', () => {
    const r = findAccountingPortal('other')
    expect(r).not.toBeNull()
    expect((r as AccountingPortalOption).integration_provider).toBeUndefined()
  })
})
