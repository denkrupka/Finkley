import { describe, expect, it } from 'vitest'

import {
  canPermission,
  defaultForRole,
  lookupPermission,
  permsMarker,
  type PermissionsMap,
} from './permissions-logic'

describe('lookupPermission', () => {
  it('owner всегда edit независимо от матрицы', () => {
    expect(lookupPermission('owner', null, 'income')).toBe('edit')
    expect(lookupPermission('owner', { 'income.*': 'view' }, 'income')).toBe('edit')
  })

  it('admin всегда edit', () => {
    expect(lookupPermission('admin', null, 'expenses')).toBe('edit')
    expect(lookupPermission('admin', {}, 'reports')).toBe('edit')
  })

  it('staff с NULL permissions: только income.visits view + settings.profile_user edit', () => {
    expect(lookupPermission('staff', null, 'income', 'visits')).toBe('view')
    expect(lookupPermission('staff', null, 'settings', 'profile_user')).toBe('edit')
    expect(lookupPermission('staff', null, 'income', 'sales')).toBe('none')
    expect(lookupPermission('staff', null, 'expenses')).toBe('none')
  })

  it('accountant с NULL permissions: read-only dashboard/income/expenses/reports/finance', () => {
    expect(lookupPermission('accountant', null, 'dashboard')).toBe('view')
    expect(lookupPermission('accountant', null, 'income')).toBe('view')
    expect(lookupPermission('accountant', null, 'reports', 'pnl')).toBe('view')
    expect(lookupPermission('accountant', null, 'settings', 'profile_user')).toBe('edit')
    expect(lookupPermission('accountant', null, 'marketing')).toBe('none')
    expect(lookupPermission('accountant', null, 'messenger')).toBe('none')
  })

  it('точная матрица: exactKey приоритетнее wildcard', () => {
    const perms: PermissionsMap = {
      'income.*': 'view',
      'income.visits': 'edit',
    }
    expect(lookupPermission('staff', perms, 'income', 'visits')).toBe('edit')
    expect(lookupPermission('staff', perms, 'income', 'sales')).toBe('view')
  })

  it('wildcard на категорию без sub', () => {
    const perms: PermissionsMap = { 'expenses.*': 'edit' }
    expect(lookupPermission('staff', perms, 'expenses')).toBe('edit')
    expect(lookupPermission('staff', perms, 'expenses', 'paid')).toBe('edit')
  })

  it('категория без правил → none для staff/accountant', () => {
    expect(lookupPermission('staff', {}, 'inventory')).toBe('none')
    expect(lookupPermission('accountant', {}, 'inventory')).toBe('none')
  })

  it('null role → none', () => {
    expect(lookupPermission(null, { 'income.*': 'edit' }, 'income')).toBe('none')
  })
})

describe('canPermission', () => {
  it('owner может всё', () => {
    expect(canPermission('owner', null, 'income')).toBe(true)
    expect(canPermission('owner', null, 'income', 'edit')).toBe(true)
    expect(canPermission('owner', null, 'income', 'visits', 'edit')).toBe(true)
  })

  it('view-доступ не даёт edit', () => {
    const perms: PermissionsMap = { 'income.*': 'view' }
    expect(canPermission('staff', perms, 'income')).toBe(true)
    expect(canPermission('staff', perms, 'income', 'edit')).toBe(false)
  })

  it('edit-доступ даёт и view', () => {
    const perms: PermissionsMap = { 'expenses.*': 'edit' }
    expect(canPermission('staff', perms, 'expenses')).toBe(true)
    expect(canPermission('staff', perms, 'expenses', 'edit')).toBe(true)
  })

  it('перегрузка: (cat, "view") и (cat, sub, "view") эквивалентны для категории без sub', () => {
    const perms: PermissionsMap = { 'reports.*': 'view' }
    expect(canPermission('staff', perms, 'reports', 'view')).toBe(true)
    expect(canPermission('staff', perms, 'reports', undefined, 'view')).toBe(true)
  })

  it('none → false для любого action', () => {
    expect(canPermission('staff', null, 'expenses')).toBe(false)
    expect(canPermission('staff', null, 'expenses', 'edit')).toBe(false)
  })
})

describe('defaultForRole', () => {
  it('staff: income.visits=view, остальное none', () => {
    expect(defaultForRole('staff', 'income', 'visits')).toBe('view')
    expect(defaultForRole('staff', 'expenses')).toBe('none')
  })

  it('accountant: финансовые разделы view, профиль edit', () => {
    expect(defaultForRole('accountant', 'finance')).toBe('view')
    expect(defaultForRole('accountant', 'settings', 'profile_user')).toBe('edit')
  })

  it('owner / admin не должны попадать сюда (lookupPermission ранний return), но fallback view', () => {
    // Для unknown ролей возвращаем view (fallback)
    expect(defaultForRole('unknown_role', 'income')).toBe('view')
  })
})

describe('permsMarker', () => {
  it('null → "null"', () => {
    expect(permsMarker(null)).toBe('null')
    expect(permsMarker(undefined)).toBe('null')
  })

  it('сортирует ключи для стабильности', () => {
    const a: PermissionsMap = { 'income.visits': 'edit', 'expenses.paid': 'view' }
    const b: PermissionsMap = { 'expenses.paid': 'view', 'income.visits': 'edit' }
    expect(permsMarker(a)).toBe(permsMarker(b))
  })

  it('разные значения → разные маркеры', () => {
    const a: PermissionsMap = { 'income.*': 'view' }
    const b: PermissionsMap = { 'income.*': 'edit' }
    expect(permsMarker(a)).not.toBe(permsMarker(b))
  })
})
