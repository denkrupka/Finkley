/**
 * Pure-helper для hydrate-логики OnboardingPage. Вынесен из useEffect
 * для unit-тестируемости.
 *
 * Принимает row из salons (или null) и возвращает Partial<OnboardingState>
 * с полями которые надо смержить в state. Если row null или
 * onboarding_completed_at != null — возвращает null (не делаем hydrate).
 */
import type { OpeningHoursDraft } from './StepSchedule'
import type { OnboardingState } from './OnboardingPage'

export type HydrateRow = {
  id: string
  onboarding_state: OnboardingState | null
  onboarding_step_id: string | null
  onboarding_completed_at: string | null
  opening_hours: OpeningHoursDraft | null
  address: string | null
  city: string | null
  lat: number | null
  lng: number | null
  google_place_id: string | null
  google_place_url: string | null
  financial_settings: OnboardingState['financial_settings'] | null
  accounting_settings: { nip?: string | null; company_name?: string | null } | null
}

export type HydrateResult = {
  salonId: string
  stepId: string | null
  /** Merged state — onboarding_state как база + БД-extras override. */
  state: Partial<OnboardingState>
}

export function computeHydrate(row: HydrateRow | null): HydrateResult | null {
  if (!row) return null
  if (row.onboarding_completed_at) return null

  const dbExtras: Partial<OnboardingState> = {}
  if (row.opening_hours) dbExtras.opening_hours = row.opening_hours
  if (row.address || row.city || row.google_place_id) {
    dbExtras.address = {
      address: row.address ?? '',
      city: row.city ?? '',
      lat: row.lat != null ? String(row.lat) : '',
      lng: row.lng != null ? String(row.lng) : '',
      google_place_id: row.google_place_id,
      google_place_url: row.google_place_url,
    }
  }
  if (row.financial_settings) dbExtras.financial_settings = row.financial_settings
  if (row.accounting_settings?.nip) dbExtras.nip = row.accounting_settings.nip
  if (row.accounting_settings?.company_name)
    dbExtras.company_name = row.accounting_settings.company_name

  const merged: Partial<OnboardingState> = row.onboarding_state
    ? { ...row.onboarding_state, ...dbExtras, created_salon_id: row.id }
    : { ...dbExtras, created_salon_id: row.id }

  return {
    salonId: row.id,
    stepId: row.onboarding_step_id,
    state: merged,
  }
}
