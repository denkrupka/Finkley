/**
 * Shadow-тест для supabase/functions/_shared/salon-lookup.ts::pickLocale.
 *
 * Каскад выбора локали для серверных уведомлений:
 *   1. profile.locale (явный выбор юзера)
 *   2. salon.locale (онбординг салона)
 *   3. country_code → язык
 *   4. 'ru' fallback
 */
import { describe, expect, it } from 'vitest'

function pickLocale(
  profileLocale?: string | null,
  salonLocale?: string | null,
  countryCode?: string | null,
): string {
  if (profileLocale) return profileLocale
  if (salonLocale) return salonLocale
  if (countryCode) {
    const cc = countryCode.toUpperCase()
    if (cc === 'PL') return 'pl'
    if (['GB', 'US', 'IE', 'AU', 'CA', 'NZ'].includes(cc)) return 'en'
    if (['RU', 'UA', 'BY', 'KZ', 'KG', 'UZ', 'MD', 'AM', 'AZ'].includes(cc)) return 'ru'
  }
  return 'ru'
}

describe('pickLocale — каскад выбора локали', () => {
  describe('profile.locale > salon.locale > country > ru', () => {
    it('profile.locale выигрывает у всего', () => {
      expect(pickLocale('en', 'pl', 'PL')).toBe('en')
      expect(pickLocale('ru', 'pl', 'PL')).toBe('ru')
    })

    it('salon.locale если profile нет', () => {
      expect(pickLocale(null, 'pl', 'GB')).toBe('pl')
      expect(pickLocale(undefined, 'en', null)).toBe('en')
    })

    it('country_code если profile и salon оба пусты', () => {
      expect(pickLocale(null, null, 'PL')).toBe('pl')
      expect(pickLocale(undefined, undefined, 'GB')).toBe('en')
    })

    it("'ru' fallback если ничего не задано", () => {
      expect(pickLocale(null, null, null)).toBe('ru')
      expect(pickLocale(undefined, undefined, undefined)).toBe('ru')
    })
  })

  describe('country_code → локаль map', () => {
    it('PL → pl', () => {
      expect(pickLocale(null, null, 'PL')).toBe('pl')
      expect(pickLocale(null, null, 'pl')).toBe('pl') // case-insensitive
    })

    it('English-speaking → en (GB/US/IE/AU/CA/NZ)', () => {
      for (const cc of ['GB', 'US', 'IE', 'AU', 'CA', 'NZ']) {
        expect(pickLocale(null, null, cc)).toBe('en')
      }
    })

    it('CIS/RU-speaking → ru (RU/UA/BY/KZ/...)', () => {
      for (const cc of ['RU', 'UA', 'BY', 'KZ', 'KG', 'UZ', 'MD', 'AM', 'AZ']) {
        expect(pickLocale(null, null, cc)).toBe('ru')
      }
    })

    it('неизвестная страна → ru fallback', () => {
      expect(pickLocale(null, null, 'DE')).toBe('ru')
      expect(pickLocale(null, null, 'FR')).toBe('ru')
      expect(pickLocale(null, null, 'XX')).toBe('ru')
    })
  })

  describe('edge cases', () => {
    it('пустая строка profile считается falsy → переходит к salon', () => {
      expect(pickLocale('', 'pl', null)).toBe('pl')
    })

    it('пустая строка salon → переходит к country', () => {
      expect(pickLocale(null, '', 'PL')).toBe('pl')
    })

    it('country_code в lowercase нормализуется', () => {
      expect(pickLocale(null, null, 'pl')).toBe('pl')
      expect(pickLocale(null, null, 'gb')).toBe('en')
    })

    it("profile=undefined (не null) — корректно skip'ается", () => {
      expect(pickLocale(undefined, 'pl', null)).toBe('pl')
    })
  })
})
