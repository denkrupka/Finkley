import { describe, expect, it } from 'vitest'

import {
  isHierarchicalCategory,
  pickDefaultParentId,
  type MinimalItem,
} from './onboarding-add-item'

describe('isHierarchicalCategory (T201)', () => {
  it('investments/flows/balance → true', () => {
    expect(isHierarchicalCategory('investments')).toBe(true)
    expect(isHierarchicalCategory('flows')).toBe(true)
    expect(isHierarchicalCategory('balance')).toBe(true)
  })

  it('flat categories → false', () => {
    expect(isHierarchicalCategory('cash_registers')).toBe(false)
    expect(isHierarchicalCategory('fixed')).toBe(false)
    expect(isHierarchicalCategory('variable')).toBe(false)
    expect(isHierarchicalCategory('taxes')).toBe(false)
    expect(isHierarchicalCategory('other_income')).toBe(false)
  })
})

describe('pickDefaultParentId (T201)', () => {
  const HEADERS: MinimalItem[] = [
    { id: 'inv_in' },
    { id: 'inv_in_a', parent_id: 'inv_in' },
    { id: 'inv_in_b', parent_id: 'inv_in' },
    { id: 'inv_out' },
    { id: 'inv_out_a', parent_id: 'inv_out' },
  ]

  it('override always wins', () => {
    expect(pickDefaultParentId(HEADERS, 'investments', 'inv_out')).toBe('inv_out')
  })

  it('hierarchical without override → first header', () => {
    expect(pickDefaultParentId(HEADERS, 'investments')).toBe('inv_in')
    expect(pickDefaultParentId(HEADERS, 'flows')).toBe('inv_in')
    expect(pickDefaultParentId(HEADERS, 'balance')).toBe('inv_in')
  })

  it('flat category → undefined', () => {
    expect(pickDefaultParentId(HEADERS, 'fixed')).toBeUndefined()
    expect(pickDefaultParentId(HEADERS, 'cash_registers')).toBeUndefined()
  })

  it('hierarchical with no headers → undefined', () => {
    const onlyChildren: MinimalItem[] = [
      { id: 'a', parent_id: 'gone' },
      { id: 'b', parent_id: 'gone' },
    ]
    expect(pickDefaultParentId(onlyChildren, 'investments')).toBeUndefined()
  })

  it('hierarchical empty items → undefined', () => {
    expect(pickDefaultParentId([], 'investments')).toBeUndefined()
  })

  it('works with custom items (no preset_key)', () => {
    // T187 — раньше фильтр требовал preset_key. После T187 любой header
    // годится — кастомные группы тоже.
    const custom: MinimalItem[] = [
      { id: 'custom_header' },
      { id: 'child', parent_id: 'custom_header' },
    ]
    expect(pickDefaultParentId(custom, 'investments')).toBe('custom_header')
  })
})
