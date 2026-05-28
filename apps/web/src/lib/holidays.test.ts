import { describe, expect, it } from 'vitest'

import { getHolidays, HOLIDAY_COUNTRIES } from './holidays'

describe('getHolidays', () => {
  it('возвращает пустой массив для неизвестной страны', () => {
    expect(getHolidays('XX', 2026)).toEqual([])
    expect(getHolidays('', 2026)).toEqual([])
  })

  it('PL: возвращает 12 праздников', () => {
    const holidays = getHolidays('PL', 2026)
    expect(holidays).toHaveLength(12)
  })

  it('PL: фиксированные даты — Новый год, Рождество, День независимости', () => {
    const holidays = getHolidays('PL', 2026)
    const dates = holidays.map((h) => h.date)
    expect(dates).toContain('2026-01-01')
    expect(dates).toContain('2026-05-01')
    expect(dates).toContain('2026-05-03')
    expect(dates).toContain('2026-11-11')
    expect(dates).toContain('2026-12-25')
    expect(dates).toContain('2026-12-26')
  })

  it('PL: Пасха 2026 = 5 апреля → Пасхальный понедельник = 6 апреля', () => {
    // Известная Пасха-2026: 5 апреля (воскресенье)
    const holidays = getHolidays('PL', 2026)
    const easterMonday = holidays.find((h) => h.label === 'Пасхальный понедельник')
    expect(easterMonday?.date).toBe('2026-04-06')
  })

  it('PL: Пасха 2025 = 20 апреля → Пасхальный понедельник = 21 апреля', () => {
    const holidays = getHolidays('PL', 2025)
    const easterMonday = holidays.find((h) => h.label === 'Пасхальный понедельник')
    expect(easterMonday?.date).toBe('2025-04-21')
  })

  it('PL: Пасха 2024 = 31 марта → Пасхальный понедельник = 1 апреля', () => {
    const holidays = getHolidays('PL', 2024)
    const easterMonday = holidays.find((h) => h.label === 'Пасхальный понедельник')
    expect(easterMonday?.date).toBe('2024-04-01')
  })

  it('DE: Страстная пятница на 2 дня раньше Пасхи', () => {
    const holidays = getHolidays('DE', 2026)
    const goodFriday = holidays.find((h) => h.label === 'Страстная пятница')
    expect(goodFriday?.date).toBe('2026-04-03')
  })

  it('IT: Феррагосто всегда 15 августа', () => {
    const holidays = getHolidays('IT', 2026)
    const ferragosto = holidays.find((h) => h.label === 'Феррагосто')
    expect(ferragosto?.date).toBe('2026-08-15')
  })

  it("GB: English labels — New Year's Day, Good Friday", () => {
    const holidays = getHolidays('GB', 2026)
    expect(holidays.find((h) => h.date === '2026-01-01')?.label).toBe("New Year's Day")
    expect(holidays.find((h) => h.label === 'Christmas Day')?.date).toBe('2026-12-25')
  })

  it('UA: День независимости 24 августа', () => {
    const holidays = getHolidays('UA', 2026)
    expect(holidays.find((h) => h.label === 'День независимости')?.date).toBe('2026-08-24')
  })

  it('все коды стран в HOLIDAY_COUNTRIES возвращают непустой список', () => {
    for (const country of HOLIDAY_COUNTRIES) {
      const holidays = getHolidays(country.code, 2026)
      expect(holidays.length).toBeGreaterThan(0)
    }
  })

  it('все даты в формате YYYY-MM-DD с zero-padding', () => {
    for (const country of HOLIDAY_COUNTRIES) {
      const holidays = getHolidays(country.code, 2026)
      for (const h of holidays) {
        expect(h.date).toMatch(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
      }
    }
  })

  it('лейблы не пустые', () => {
    for (const country of HOLIDAY_COUNTRIES) {
      const holidays = getHolidays(country.code, 2026)
      for (const h of holidays) {
        expect(h.label.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('addDays корректно переходит через границу месяца (Пасха=март → Пасх.пн в апреле)', () => {
    // 2024: Пасха 31 марта → понедельник 1 апреля (переход март→апрель)
    const holidays = getHolidays('PL', 2024)
    const easterMonday = holidays.find((h) => h.label === 'Пасхальный понедельник')
    expect(easterMonday?.date).toBe('2024-04-01')
  })
})
