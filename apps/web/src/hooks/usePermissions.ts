import { useMemo } from 'react'

import { useSalonMembership } from '@/hooks/useSalons'

import {
  canPermission,
  permsMarker,
  type PermissionAction,
  type PermissionsMap,
  type Role,
} from './permissions-logic'

export type { PermissionAction }

/**
 * T35 — usePermissions(salonId): применение матрицы прав из salon_members.permissions.
 *
 * Возвращает can(category, sub?, action='view'). Используется в UI:
 *   - Sidebar: скрывает пункты nav для которых нет 'view'.
 *   - Формы: disabled если нет 'edit'.
 *   - Кнопки действий: not-rendered если нет 'edit'.
 *
 * Pure-логика вынесена в permissions-logic.ts для unit-тестов (T49).
 */
export function usePermissions(salonId: string | undefined) {
  const { data: membership } = useSalonMembership(salonId)
  const role = (membership?.role ?? null) as Role | null
  const perms = (membership?.permissions ?? null) as PermissionsMap | null
  const marker = permsMarker(perms)

  return useMemo(() => {
    function can(
      category: string,
      subOrAction?: string | PermissionAction,
      action?: PermissionAction,
    ): boolean {
      return canPermission(role, perms, category, subOrAction, action)
    }
    return { can, role, isLoaded: membership !== undefined }
    // marker — стабильный hash от permissions jsonb; ref может меняться без
    // реальных изменений, marker исключает лишние пересчёты.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker, role, membership !== undefined])
}
