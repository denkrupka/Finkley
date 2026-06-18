import { type ReactNode } from 'react'
import { useParams } from 'react-router-dom'

import { useEntitlements } from '@/hooks/useEntitlements'
import { type SectionId } from '@/lib/entitlements'

import { UpgradeOverlay } from './UpgradeOverlay'

/**
 * Гейт секции по тарифу (T7). Если план салона не открывает секцию —
 * рендерит UpgradeOverlay (плашку) вместо контента. Секция остаётся в
 * навигации (активна), но «при переходе — Плашка».
 *
 * Пока энтайтлменты грузятся — оптимистично рендерим children (как
 * RequirePermission). Композируется поверх RequirePermission (RBAC):
 *   <RequirePermission category="expenses">
 *     <RequireEntitlement section="expenses">{<ExpensesPage/>}</RequireEntitlement>
 *   </RequirePermission>
 */
export function RequireEntitlement({
  section,
  children,
}: {
  section: SectionId
  children: ReactNode
}) {
  const { salonId } = useParams<{ salonId: string }>()
  const { canAccessSection, isLoaded } = useEntitlements(salonId)

  if (isLoaded && !canAccessSection(section)) {
    return <UpgradeOverlay section={section} />
  }
  return <>{children}</>
}
