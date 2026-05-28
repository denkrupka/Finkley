import { describe, expect, it } from 'vitest'

import { buildMonthCols } from './period-picker-utils'

describe('buildMonthCols', () => {
  it('один месяц — одна колонка', () => {
    const cols = buildMonthCols(new Date(2026, 4, 1), new Date(2026, 4, 31))
    expect(cols).toEqual([{ year: 2026, monthIdx: 4, key: '2026-05' }])
  })

  it('start > end — всё равно одна колонка start', () => {
    const cols = buildMonthCols(new Date(2026, 4, 1), new Date(2026, 0, 1))
    expect(cols).toHaveLength(1)
    expect(cols.at(0)?.key).toBe('2026-05')
  })

  it('start == end (один день) — одна колонка', () => {
    const cols = buildMonthCols(new Date(2026, 4, 15), new Date(2026, 4, 15))
    expect(cols).toEqual([{ year: 2026, monthIdx: 4, key: '2026-05' }])
  })

  it('полный 2026 год — 12 колонок jan..dec', () => {
    const cols = buildMonthCols(new Date(2026, 0, 1), new Date(2026, 11, 31))
    expect(cols).toHaveLength(12)
    expect(cols.at(0)?.key).toBe('2026-01')
    expect(cols.at(-1)?.key).toBe('2026-12')
    expect(cols[6]).toEqual({ year: 2026, monthIdx: 6, key: '2026-07' })
  })

  it('range через границу года: dec 2025 → feb 2026 → 3 колонки', () => {
    const cols = buildMonthCols(new Date(2025, 11, 15), new Date(2026, 1, 28))
    expect(cols.map((c) => c.key)).toEqual(['2025-12', '2026-01', '2026-02'])
  })

  it('2-летний range — ровно 24 колонки', () => {
    const cols = buildMonthCols(new Date(2025, 0, 1), new Date(2026, 11, 31))
    expect(cols).toHaveLength(24)
    expect(cols.at(0)?.key).toBe('2025-01')
    expect(cols.at(-1)?.key).toBe('2026-12')
  })

  it('MAX_COLS=60 — клипует длинный range от end назад', () => {
    // 6 лет: 2020-01 .. 2025-12 = 72 месяцев. MAX_COLS=60. Должны получить
    // последние 60 от end (2026-01).
    const cols = buildMonthCols(new Date(2020, 0, 1), new Date(2026, 0, 31))
    expect(cols).toHaveLength(60)
    expect(cols.at(-1)?.key).toBe('2026-01')
    expect(cols.at(0)?.key).toBe('2021-02')
  })

  it('«за всё время» с 2000-01-01 — клипуется до 60 без OOM', () => {
    const cols = buildMonthCols(new Date(2000, 0, 1), new Date(2026, 4, 31))
    expect(cols).toHaveLength(60)
    expect(cols.at(-1)?.key).toBe('2026-05')
    expect(cols.at(0)?.key).toBe('2021-06')
  })

  it('каждая колонка имеет правильно отформатированный key (year-MM с zero-padding)', () => {
    const cols = buildMonthCols(new Date(2026, 0, 1), new Date(2026, 11, 31))
    for (const col of cols) {
      expect(col.key).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
      expect(col.key).toBe(`${col.year}-${String(col.monthIdx + 1).padStart(2, '0')}`)
    }
  })

  it('start в середине месяца — колонка для всего месяца', () => {
    const cols = buildMonthCols(new Date(2026, 4, 27), new Date(2026, 5, 3))
    // май 27 → июнь 3 = пересекает 2 месяца
    expect(cols.map((c) => c.key)).toEqual(['2026-05', '2026-06'])
  })
})
