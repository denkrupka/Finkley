import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { usePersistedCollapse } from './useCollapsedState'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('usePersistedCollapse', () => {
  it('по умолчанию open=true когда localStorage пуст', () => {
    const { result } = renderHook(() => usePersistedCollapse('test-1', true))
    expect(result.current.open).toBe(true)
  })

  it('по умолчанию open=false когда defaultOpen=false', () => {
    const { result } = renderHook(() => usePersistedCollapse('test-2', false))
    expect(result.current.open).toBe(false)
  })

  it('читает сохранённый open=1 (collapsed)', () => {
    localStorage.setItem('dashboard.collapsed.test-3', '1')
    const { result } = renderHook(() => usePersistedCollapse('test-3', true))
    expect(result.current.open).toBe(false)
  })

  it('читает сохранённый open=0 (expanded)', () => {
    localStorage.setItem('dashboard.collapsed.test-4', '0')
    const { result } = renderHook(() => usePersistedCollapse('test-4', false))
    expect(result.current.open).toBe(true)
  })

  it('toggle переключает + сохраняет в localStorage', () => {
    const { result } = renderHook(() => usePersistedCollapse('test-5', true))
    expect(result.current.open).toBe(true)

    act(() => result.current.toggle())
    expect(result.current.open).toBe(false)
    expect(localStorage.getItem('dashboard.collapsed.test-5')).toBe('1')

    act(() => result.current.toggle())
    expect(result.current.open).toBe(true)
    expect(localStorage.getItem('dashboard.collapsed.test-5')).toBe('0')
  })

  it('setOpen явный — обновляет и localStorage', () => {
    const { result } = renderHook(() => usePersistedCollapse('test-6', true))

    act(() => result.current.setOpen(false))
    expect(result.current.open).toBe(false)
    expect(localStorage.getItem('dashboard.collapsed.test-6')).toBe('1')
  })

  it('разные id — независимые состояния', () => {
    const { result: a } = renderHook(() => usePersistedCollapse('test-a', true))
    const { result: b } = renderHook(() => usePersistedCollapse('test-b', true))

    act(() => a.current.toggle())
    expect(a.current.open).toBe(false)
    expect(b.current.open).toBe(true) // не задет

    expect(localStorage.getItem('dashboard.collapsed.test-a')).toBe('1')
    expect(localStorage.getItem('dashboard.collapsed.test-b')).toBe('0')
  })
})
