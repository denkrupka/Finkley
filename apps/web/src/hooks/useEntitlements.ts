import { useSalon } from '@/hooks/useSalons'
import { useSubscription } from '@/hooks/useSubscription'
import {
  canAccessSection,
  canCreateMultipleSalons,
  effectivePlan,
  type Plan,
  type SectionId,
  type SubscriptionLike,
} from '@/lib/entitlements'

/**
 * Эффективный тарифный план салона + проверки доступа к секциям (T7).
 * Зеркалит usePermissions: пока грузится — оптимистично пускаем (isLoaded=false),
 * гейт срабатывает после первой загрузки.
 */
export function useEntitlements(salonId: string | undefined) {
  const { data: sub, isLoading: subLoading } = useSubscription(salonId)
  const { data: salon, isLoading: salonLoading } = useSalon(salonId)

  const isLoaded = !!salonId && !subLoading && !salonLoading
  const plan: Plan = effectivePlan(sub as SubscriptionLike, salon?.created_at)

  return {
    plan,
    isLoaded,
    canAccessSection: (section: SectionId) => canAccessSection(plan, section),
    canCreateMultipleSalons: canCreateMultipleSalons(plan),
  }
}
