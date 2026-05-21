import { describe, expect, it } from 'vitest'

import { dtEndForVisit, fold, ic, icsTime } from './ics-helpers'

describe('ic — escaping для iCalendar values', () => {
  it('обычный текст без спецсимволов — возвращает как есть', () => {
    expect(ic('Manicure hybrydowy')).toBe('Manicure hybrydowy')
  })

  it('запятые экранируются (RFC 5545 §3.3.11)', () => {
    expect(ic('Anna, Maria')).toBe('Anna\\, Maria')
  })

  it('точки с запятой экранируются', () => {
    expect(ic('Note; details')).toBe('Note\\; details')
  })

  it('обратный слэш экранируется первым (важен порядок)', () => {
    expect(ic('a\\b')).toBe('a\\\\b')
    // Если бы порядок был неправильный, мы бы экранировали уже-экранированные.
  })

  it('newlines заменяются на \\n literal', () => {
    expect(ic('line1\nline2')).toBe('line1\\nline2')
  })

  it('комбинация спецсимволов', () => {
    expect(ic('a; b, c\nd\\e')).toBe('a\\; b\\, c\\nd\\\\e')
  })

  it('пустая строка / null защита', () => {
    expect(ic('')).toBe('')
    expect(ic(null as unknown as string)).toBe('')
    expect(ic(undefined as unknown as string)).toBe('')
  })
})

describe('icsTime — UTC ISO → ICS DATE-TIME', () => {
  it('UTC time → YYYYMMDDTHHMMSSZ', () => {
    expect(icsTime('2026-05-08T12:30:00Z')).toBe('20260508T123000Z')
  })

  it('сохраняет seconds', () => {
    expect(icsTime('2026-01-15T09:05:42Z')).toBe('20260115T090542Z')
  })

  it('конвертирует non-UTC в UTC', () => {
    // 2026-05-08T15:30:00+03:00 = 2026-05-08T12:30:00Z
    expect(icsTime('2026-05-08T15:30:00+03:00')).toBe('20260508T123000Z')
  })

  it('полночь', () => {
    expect(icsTime('2026-06-01T00:00:00Z')).toBe('20260601T000000Z')
  })

  it('padding одноразрядных значений', () => {
    expect(icsTime('2026-01-05T09:05:08Z')).toBe('20260105T090508Z')
  })
})

describe('fold — line wrapping per RFC 5545 §3.1', () => {
  it('строка ≤75 символов — без изменений', () => {
    const s = 'SUMMARY:Short event title'
    expect(fold(s)).toBe(s)
  })

  it('ровно 75 символов — без изменений', () => {
    const s = 'A'.repeat(75)
    expect(fold(s)).toBe(s)
  })

  it('строка 76 символов — fold на 73 + перенос с " "', () => {
    const s = 'A'.repeat(76)
    const folded = fold(s)
    expect(folded).toContain('\r\n')
    const lines = folded.split('\r\n')
    expect(lines[0]?.length).toBe(73)
    // Continuation должна начинаться с пробела (RFC 5545).
    expect(lines[1]?.[0]).toBe(' ')
  })

  it('очень длинная строка нарезается каждые 73 символа', () => {
    const s = 'A'.repeat(220)
    const folded = fold(s)
    const lines = folded.split('\r\n')
    expect(lines.length).toBeGreaterThan(2)
    // Каждая последующая строка должна начинаться с " "
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]?.[0]).toBe(' ')
    }
  })
})

describe('dtEndForVisit — расчёт DTEND с учётом duration_min', () => {
  it('60 мин по умолчанию для null/undefined', () => {
    expect(dtEndForVisit('2026-05-08T12:00:00Z', null)).toBe('2026-05-08T13:00:00.000Z')
    expect(dtEndForVisit('2026-05-08T12:00:00Z', undefined)).toBe('2026-05-08T13:00:00.000Z')
  })

  it('кастомная duration', () => {
    expect(dtEndForVisit('2026-05-08T12:00:00Z', 90)).toBe('2026-05-08T13:30:00.000Z')
    expect(dtEndForVisit('2026-05-08T12:00:00Z', 30)).toBe('2026-05-08T12:30:00.000Z')
  })

  it('0 trated as null → fallback 60 мин (предотвращает zero-duration events)', () => {
    expect(dtEndForVisit('2026-05-08T12:00:00Z', 0)).toBe('2026-05-08T13:00:00.000Z')
  })

  it('переход через полночь', () => {
    expect(dtEndForVisit('2026-05-08T23:30:00Z', 60)).toBe('2026-05-09T00:30:00.000Z')
  })

  it('длинный визит — 4 часа', () => {
    expect(dtEndForVisit('2026-05-08T10:00:00Z', 240)).toBe('2026-05-08T14:00:00.000Z')
  })
})
