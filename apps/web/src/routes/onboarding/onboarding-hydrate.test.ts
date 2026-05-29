import { describe, expect, it } from 'vitest'

import { computeHydrate, type HydrateRow } from './onboarding-hydrate'

function row(overrides: Partial<HydrateRow> = {}): HydrateRow {
  return {
    id: 'salon-1',
    onboarding_state: null,
    onboarding_step_id: null,
    onboarding_completed_at: null,
    opening_hours: null,
    address: null,
    city: null,
    lat: null,
    lng: null,
    google_place_id: null,
    google_place_url: null,
    financial_settings: null,
    accounting_settings: null,
    ...overrides,
  }
}

describe('computeHydrate', () => {
  it('null row → null', () => {
    expect(computeHydrate(null)).toBeNull()
  })

  it('завершённый онбординг → null (не hydrate)', () => {
    expect(computeHydrate(row({ onboarding_completed_at: '2026-05-29T10:00:00Z' }))).toBeNull()
  })

  it('пустой row → state с created_salon_id, нет других полей', () => {
    const r = computeHydrate(row())
    expect(r).not.toBeNull()
    expect(r!.salonId).toBe('salon-1')
    expect(r!.state.created_salon_id).toBe('salon-1')
    expect(r!.stepId).toBeNull()
  })

  it('opening_hours из БД попадает в state', () => {
    const hours = { mon: { open: '10:00', close: '22:00' } }
    const r = computeHydrate(row({ opening_hours: hours }))
    expect(r!.state.opening_hours).toEqual(hours)
  })

  it('address fields собираются в один объект (с string coercion для lat/lng)', () => {
    const r = computeHydrate(
      row({
        address: 'ul. Marszałkowska 100',
        city: 'Warszawa',
        lat: 52.234,
        lng: 21.012,
        google_place_id: 'ChIJ-xxx',
        google_place_url: 'https://maps.google.com/?cid=xxx',
      }),
    )
    expect(r!.state.address).toEqual({
      address: 'ul. Marszałkowska 100',
      city: 'Warszawa',
      lat: '52.234',
      lng: '21.012',
      google_place_id: 'ChIJ-xxx',
      google_place_url: 'https://maps.google.com/?cid=xxx',
    })
  })

  it('пустой address (только null) → не создаёт state.address', () => {
    const r = computeHydrate(row())
    expect(r!.state.address).toBeUndefined()
  })

  it('financial_settings из БД', () => {
    const fin = { taxes: { items: [] } } as never
    const r = computeHydrate(row({ financial_settings: fin }))
    expect(r!.state.financial_settings).toBe(fin)
  })

  it('accounting_settings.nip / company_name распаковываются в state', () => {
    const r = computeHydrate(
      row({
        accounting_settings: { nip: '1234567890', company_name: 'JANE DOE BEAUTY' },
      }),
    )
    expect(r!.state.nip).toBe('1234567890')
    expect(r!.state.company_name).toBe('JANE DOE BEAUTY')
  })

  it('пустые поля accounting_settings игнорируются', () => {
    const r = computeHydrate(row({ accounting_settings: { nip: null, company_name: null } }))
    expect(r!.state.nip).toBeUndefined()
    expect(r!.state.company_name).toBeUndefined()
  })

  it('onboarding_state + dbExtras: extras override snapshot', () => {
    const snapshot = {
      opening_hours: { mon: { open: '09:00', close: '18:00' } },
      nip: 'old-nip',
    } as never
    const r = computeHydrate(
      row({
        onboarding_state: snapshot,
        opening_hours: { mon: { open: '10:00', close: '22:00' } },
        accounting_settings: { nip: 'new-nip-from-db' },
      }),
    )
    expect(r!.state.opening_hours).toEqual({ mon: { open: '10:00', close: '22:00' } })
    expect(r!.state.nip).toBe('new-nip-from-db')
  })

  it('stepId передаётся как есть', () => {
    const r = computeHydrate(row({ onboarding_step_id: 'staff' }))
    expect(r!.stepId).toBe('staff')
  })

  it('created_salon_id всегда из row.id, перетирает snapshot', () => {
    const snapshot = { created_salon_id: 'wrong-id' } as never
    const r = computeHydrate(row({ id: 'salon-correct', onboarding_state: snapshot }))
    expect(r!.state.created_salon_id).toBe('salon-correct')
  })
})
