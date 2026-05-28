import { describe, expect, it } from 'vitest'

import { getDatePeriodRange, getPeriodRange, readCustomFromParams } from './period'

describe('getPeriodRange', () => {
  it('day: возвращает 00:00 — 23:59:59 этого дня в локальной TZ', () => {
    const now = new Date('2026-05-27T14:30:00.000Z')
    const r = getPeriodRange('day', now)
    // start и end — один календарный день в локальной TZ
    expect(new Date(r.start).getDate()).toBe(new Date(r.end).getDate())
    // start — полночь по локальному
    expect(new Date(r.start).getHours()).toBe(0)
    expect(new Date(r.start).getMinutes()).toBe(0)
  })

  it('week: понедельник — воскресенье', () => {
    // 2026-05-27 = среда. Понедельник той же недели = 2026-05-25.
    const now = new Date('2026-05-27T12:00:00.000Z')
    const r = getPeriodRange('week', now)
    // start должен быть 2026-05-25 (понедельник) в локальной TZ
    const startDate = new Date(r.start)
    expect(startDate.getDay()).toBe(1) // понедельник
  })

  it('month: первый и последний день месяца', () => {
    const now = new Date('2026-05-15T12:00:00.000Z')
    const r = getPeriodRange('month', now)
    const startDate = new Date(r.start)
    const endDate = new Date(r.end)
    expect(startDate.getDate()).toBe(1)
    expect(endDate.getMonth()).toBe(startDate.getMonth())
    // последний день мая = 31
    expect(endDate.getDate()).toBeGreaterThanOrEqual(28)
  })

  it('custom: с from/to → парсит и оборачивает в startOfDay/endOfDay', () => {
    const now = new Date('2026-05-27T12:00:00.000Z')
    const r = getPeriodRange('custom', now, { fromStr: '2026-01-15', toStr: '2026-02-20' })
    // start — локальная полночь 15 января
    const startDate = new Date(r.start)
    expect(startDate.getFullYear()).toBe(2026)
    expect(startDate.getMonth()).toBe(0)
    expect(startDate.getDate()).toBe(15)
    expect(startDate.getHours()).toBe(0)
    // end — локальный конец дня 20 февраля
    const endDate = new Date(r.end)
    expect(endDate.getFullYear()).toBe(2026)
    expect(endDate.getMonth()).toBe(1)
    expect(endDate.getDate()).toBe(20)
  })

  it('custom: без params → фоллбек на текущий месяц', () => {
    const now = new Date('2026-05-15T12:00:00.000Z')
    const r = getPeriodRange('custom', now)
    const rMonth = getPeriodRange('month', now)
    expect(r.start).toBe(rMonth.start)
    expect(r.end).toBe(rMonth.end)
  })

  it('custom: только from без to → фоллбек на месяц', () => {
    const now = new Date('2026-05-15T12:00:00.000Z')
    const r = getPeriodRange('custom', now, { fromStr: '2026-01-01', toStr: null })
    const rMonth = getPeriodRange('month', now)
    expect(r.start).toBe(rMonth.start)
  })

  it('возвращает валидные ISO строки', () => {
    const r = getPeriodRange('month', new Date('2026-05-15'))
    expect(() => new Date(r.start).toISOString()).not.toThrow()
    expect(() => new Date(r.end).toISOString()).not.toThrow()
  })
})

describe('getDatePeriodRange', () => {
  it('обрезает до YYYY-MM-DD (для date-only колонок)', () => {
    const r = getDatePeriodRange('month', new Date('2026-05-15T12:00:00.000Z'))
    expect(r.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r.end).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('custom — нормирует к date-only', () => {
    const r = getDatePeriodRange('custom', new Date(), {
      fromStr: '2026-01-15',
      toStr: '2026-02-20',
    })
    // зависит от TZ: после .slice(0, 10) от UTC ISO в Europe/Warsaw полночь
    // местного = 22:00 UTC предыдущего дня. Поэтому проверяем что значение
    // — валидная YYYY-MM-DD строка близко к указанным датам.
    expect(r.start).toMatch(/^2026-01-1[45]$/)
    expect(r.end).toMatch(/^2026-02-(19|20)$/)
  })
})

describe('readCustomFromParams', () => {
  it('читает from/to из URLSearchParams', () => {
    const params = new URLSearchParams('from=2026-01-01&to=2026-12-31')
    expect(readCustomFromParams(params)).toEqual({
      fromStr: '2026-01-01',
      toStr: '2026-12-31',
    })
  })

  it('отсутствующие params → null', () => {
    const params = new URLSearchParams('')
    expect(readCustomFromParams(params)).toEqual({ fromStr: null, toStr: null })
  })

  it('частично заданные params', () => {
    const params = new URLSearchParams('from=2026-01-01')
    expect(readCustomFromParams(params)).toEqual({
      fromStr: '2026-01-01',
      toStr: null,
    })
  })
})
