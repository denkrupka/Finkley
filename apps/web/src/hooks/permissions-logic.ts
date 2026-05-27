/**
 * T35/T49 — pure-логика permissions, вынесенная из usePermissions.ts для
 * unit-тестов. Сам хук usePermissions использует эти функции внутри useMemo.
 *
 * Описание: usePermissions применяет матрицу прав из salon_members.permissions
 *   - owner/admin: полный доступ (permissions ignored)
 *   - permissions IS NULL: дефолт по роли (см. defaultForRole)
 *   - permissions заполнено: точная матрица; 'edit' включает 'view'
 *
 * Ключи в матрице:
 *   '${category}.${sub}' — точное правило (e.g. 'income.visits')
 *   '${category}.*'      — wildcard на всю категорию
 */

export type PermissionAction = 'view' | 'edit'
export type Role = 'owner' | 'admin' | 'staff' | 'accountant'
export type PermissionsMap = Record<string, PermissionAction>

export function lookupPermission(
  role: Role | null,
  perms: PermissionsMap | null,
  category: string,
  sub?: string,
): PermissionAction | 'none' {
  // Null role — membership ещё не подгружен; не даём доступ до загрузки.
  if (!role) return 'none'

  // Owner / admin — всегда edit.
  if (role === 'owner' || role === 'admin') return 'edit'

  // Если permissions явно не задано — применяем дефолты по role.
  if (!perms) return defaultForRole(role, category, sub)

  const exactKey = sub ? `${category}.${sub}` : category
  const wildKey = `${category}.*`

  if (perms[exactKey]) return perms[exactKey]
  if (sub && perms[wildKey]) return perms[wildKey]
  if (!sub && perms[wildKey]) return perms[wildKey]
  return 'none'
}

export function canPermission(
  role: Role | null,
  perms: PermissionsMap | null,
  category: string,
  subOrAction?: string | PermissionAction,
  action?: PermissionAction,
): boolean {
  let sub: string | undefined
  let needed: PermissionAction = 'view'
  if (subOrAction === 'view' || subOrAction === 'edit') {
    needed = subOrAction
  } else {
    sub = subOrAction
    needed = action ?? 'view'
  }
  const got = lookupPermission(role, perms, category, sub)
  if (got === 'edit') return true
  if (got === 'view' && needed === 'view') return true
  return false
}

/**
 * Дефолтные права по роли когда явная матрица не задана.
 * Должно соответствовать presetForRole в PermissionsBlock.tsx.
 */
export function defaultForRole(
  role: Role | string | null,
  category: string,
  sub?: string,
): PermissionAction | 'none' {
  if (!role) return 'none'
  if (role === 'staff') {
    if (category === 'income' && sub === 'visits') return 'view'
    if (category === 'settings' && sub === 'profile_user') return 'edit'
    return 'none'
  }
  if (role === 'accountant') {
    if (
      category === 'dashboard' ||
      category === 'income' ||
      category === 'expenses' ||
      category === 'reports' ||
      category === 'finance'
    ) {
      return 'view'
    }
    if (category === 'settings' && sub === 'profile_user') return 'edit'
    return 'none'
  }
  return 'view'
}

/** Стабильный hash от permissions jsonb для useMemo deps. */
export function permsMarker(p: PermissionsMap | null | undefined): string {
  if (!p) return 'null'
  return Object.keys(p)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join('|')
}
