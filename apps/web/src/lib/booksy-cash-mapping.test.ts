import { describe, expect, it } from 'vitest'

import {
  buildCashRegisterByMethod,
  cashRegisterFor,
  type CashRegisterItem,
} from './booksy-cash-mapping'

describe('buildCashRegisterByMethod', () => {
  it('пустой массив → пустая карта', () => {
    expect(buildCashRegisterByMethod([])).toEqual({})
  })

  it('null / undefined → пустая карта (а не падение)', () => {
    expect(buildCashRegisterByMethod(null)).toEqual({})
    expect(buildCashRegisterByMethod(undefined)).toEqual({})
  })

  it('cash → uuid-кассы', () => {
    const items: CashRegisterItem[] = [
      { id: 'reg-cash', payment_method_mapping: 'cash' },
      { id: 'reg-card', payment_method_mapping: 'card' },
    ]
    expect(buildCashRegisterByMethod(items)).toEqual({
      cash: 'reg-cash',
      card: 'reg-card',
    })
  })

  it('archived позиции игнорируются — даже если у них есть маппинг', () => {
    const items: CashRegisterItem[] = [
      { id: 'reg-active', payment_method_mapping: 'cash', archived: false },
      { id: 'reg-old', payment_method_mapping: 'cash', archived: true },
    ]
    expect(buildCashRegisterByMethod(items)).toEqual({ cash: 'reg-active' })
  })

  it('позиции без mapping или без id — пропускаются', () => {
    const items: CashRegisterItem[] = [
      { id: 'reg-1' }, // нет mapping
      { payment_method_mapping: 'cash' }, // нет id
      { id: 'reg-2', payment_method_mapping: null }, // явный null
      { id: 'reg-3', payment_method_mapping: '' }, // пустая строка
    ]
    expect(buildCashRegisterByMethod(items)).toEqual({})
  })

  it('дубль mapping — последний выигрывает (детерминированно)', () => {
    const items: CashRegisterItem[] = [
      { id: 'reg-a', payment_method_mapping: 'cash' },
      { id: 'reg-b', payment_method_mapping: 'cash' },
    ]
    expect(buildCashRegisterByMethod(items)).toEqual({ cash: 'reg-b' })
  })
})

describe('cashRegisterFor', () => {
  const byMethod = { cash: 'reg-cash', card: 'reg-card' }

  it('известный метод → uuid', () => {
    expect(cashRegisterFor(byMethod, 'cash')).toBe('reg-cash')
    expect(cashRegisterFor(byMethod, 'card')).toBe('reg-card')
  })

  it('неизвестный метод → null', () => {
    expect(cashRegisterFor(byMethod, 'blik')).toBeNull()
  })

  it('null/undefined метод → null', () => {
    expect(cashRegisterFor(byMethod, null)).toBeNull()
    expect(cashRegisterFor(byMethod, undefined)).toBeNull()
  })

  it('пустая строка → null', () => {
    expect(cashRegisterFor(byMethod, '')).toBeNull()
  })
})
