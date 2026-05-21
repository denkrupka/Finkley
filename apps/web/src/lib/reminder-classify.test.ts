import { describe, it, expect } from 'vitest'

import { classifyOffset, dueOffset } from './reminder-classify'

describe('dueOffset', () => {
  it('positive — будущее', () => {
    expect(dueOffset('2026-05-23', '2026-05-21')).toBe(2)
    expect(dueOffset('2026-05-22', '2026-05-21')).toBe(1)
  })

  it('zero — сегодня', () => {
    expect(dueOffset('2026-05-21', '2026-05-21')).toBe(0)
  })

  it('negative — просрочено', () => {
    expect(dueOffset('2026-05-19', '2026-05-21')).toBe(-2)
  })

  it('переход через месяц', () => {
    expect(dueOffset('2026-06-01', '2026-05-30')).toBe(2)
  })
})

describe('classifyOffset', () => {
  it('mapping by offset', () => {
    expect(classifyOffset(2)).toBe('payment_due_2d')
    expect(classifyOffset(1)).toBe('payment_due_1d')
    expect(classifyOffset(0)).toBe('payment_due_today')
    expect(classifyOffset(-1)).toBe('payment_overdue')
    expect(classifyOffset(-30)).toBe('payment_overdue')
  })

  it('null для будущего дальше 2 дней', () => {
    expect(classifyOffset(3)).toBeNull()
    expect(classifyOffset(7)).toBeNull()
    expect(classifyOffset(60)).toBeNull()
  })
})
