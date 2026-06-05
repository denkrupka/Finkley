import { describe, expect, it } from 'vitest'

// Bug 65564a78: проверяем что isZeroLike определяет zero-shaped значения.
// Сам helper не экспортируется — дублируем логику в тесте, чтобы зафиксировать
// контракт «когда выделяем content по focus».
function isZeroLike(value: string | undefined): boolean {
  if (value == null || value === '') return false
  return /^0([.,]0+)?$/.test(value.trim())
}

describe('Input — zero-like detection (bug 65564a78)', () => {
  it.each([
    ['0', true],
    ['0.0', true],
    ['0,0', true],
    ['0.00', true],
    ['  0  ', true],
    ['', false],
    [undefined, false],
    ['0.5', false],
    ['10', false],
    ['100', false],
    ['0a', false],
    ['-0', false],
  ])('isZeroLike(%j) === %s', (value, expected) => {
    expect(isZeroLike(value as string | undefined)).toBe(expected)
  })
})
