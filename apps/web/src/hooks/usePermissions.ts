import { useMemo } from 'react'

import { useSalonMembership } from '@/hooks/useSalons'

export type PermissionAction = 'view' | 'edit'

/**
 * T35 — usePermissions(salonId): применение матрицы прав из salon_members.permissions.
 *
 * Возвращает can(category, sub?, action='view'). Используется в UI:
 *   - Sidebar: скрывает пункты nav для которых нет 'view'.
 *   - Формы: disabled если нет 'edit'.
 *   - Кнопки действий: not-rendered если нет 'edit'.
 *
 * Совместимость:
 *   - owner/admin: всегда полный доступ (permissions ignored).
 *   - permissions IS NULL: дефолт по роли (preset из PermissionsBlock).
 *   - permissions заполнено: точная матрица. 'edit' включает 'view'.
 *
 * Ключи в матрице:
 *   `${category}.${sub}` — точное правило (e.g. 'income.visits')
 *   `${category}.*`      — wildcard на всю категорию
 */
export function usePermissions(salonId: string | undefined) {
  const { data: membership } = useSalonMembership(salonId)
  const role = membership?.role ?? null
  const prefix = role === 'owner' || role === 'admin' ? 'all' : 'matrix'
  const permsMarker = perms_marker(membership?.permissions)

  return useMemo(() => {
    const perms = membership?.permissions ?? null

    function lookup(category: string, sub?: string): PermissionAction | 'none' {
      // Owner / admin — всегда edit.
      if (prefix === 'all') return 'edit'

      // Если permissions явно не задано — применяем дефолты по role.
      if (!perms) return defaultForRole(role, category, sub)

      const exactKey = sub ? `${category}.${sub}` : category
      const wildKey = `${category}.*`

      if (perms[exactKey]) return perms[exactKey]
      if (sub && perms[wildKey]) return perms[wildKey]
      // Если sub не указан — проверяем хотя бы wildcard.
      if (!sub && perms[wildKey]) return perms[wildKey]
      return 'none'
    }

    function can(
      category: string,
      subOrAction?: string | PermissionAction,
      action?: PermissionAction,
    ): boolean {
      // Перегрузка: can(cat, 'view') ~ can(cat, undefined, 'view'); или
      //              can(cat, 'income.visits', 'edit').
      let sub: string | undefined
      let needed: PermissionAction = 'view'
      if (subOrAction === 'view' || subOrAction === 'edit') {
        needed = subOrAction
      } else {
        sub = subOrAction
        needed = action ?? 'view'
      }
      const got = lookup(category, sub)
      if (got === 'edit') return true
      if (got === 'view' && needed === 'view') return true
      return false
    }

    return { can, role, isLoaded: membership !== undefined }
    // permsMarker — стабильный hash от permissions jsonb. membership ref может
    // меняться без реальных изменений; permsMarker исключает лишние пересчёты.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsMarker, prefix, role, membership !== undefined])
}

// Стабильный маркер для useMemo deps (избегаем reference-equality на jsonb).
function perms_marker(p: Record<string, 'view' | 'edit'> | null | undefined): string {
  if (!p) return 'null'
  return Object.keys(p)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join('|')
}

/**
 * Преднастройки по роли — копия из PermissionsBlock.presetForRole для serverless
 * пути (если permissions IS NULL). Держим синхронно с UI presetForRole.
 */
function defaultForRole(
  role: string | null,
  category: string,
  sub?: string,
): PermissionAction | 'none' {
  if (!role) return 'none'
  if (role === 'staff') {
    // Мастер: видит только свои визиты + редактирует профиль.
    if (category === 'income' && sub === 'visits') return 'view'
    if (category === 'settings' && sub === 'profile_user') return 'edit'
    return 'none'
  }
  if (role === 'accountant') {
    // Бухгалтер: видит финансы/отчёты, редактирует профиль.
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
  // Fallback — view везде.
  return 'view'
}
