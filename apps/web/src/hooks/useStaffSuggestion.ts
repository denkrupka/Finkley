import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Подсказывает «обычного» мастера для пары (клиент, услуга) на основе
 * прошлых визитов. Возвращает staff_id того, кто чаще всех делал данную
 * услугу для данного клиента (mode по staff_id среди visits).
 *
 * Если визитов нет / клиент/услуга не заданы → null. Результат
 * подставляется в QuickEntryModal как умолчание; юзер может изменить.
 */
export function useSuggestedStaffForClientService(
  salonId: string | undefined,
  clientId: string | null | undefined,
  serviceId: string | null | undefined,
) {
  return useQuery<string | null>({
    queryKey: ['suggest-staff', salonId, clientId, serviceId],
    queryFn: async () => {
      if (!salonId || !clientId || !serviceId) return null
      const { data, error } = await supabase
        .from('visits')
        .select('staff_id')
        .eq('salon_id', salonId)
        .eq('client_id', clientId)
        .eq('service_id', serviceId)
        .is('deleted_at', null)
        .not('staff_id', 'is', null)
        .limit(200)
      if (error) throw error
      const counts = new Map<string, number>()
      for (const r of (data ?? []) as { staff_id: string }[]) {
        counts.set(r.staff_id, (counts.get(r.staff_id) ?? 0) + 1)
      }
      let bestId: string | null = null
      let bestCount = 0
      for (const [id, n] of counts) {
        if (n > bestCount) {
          bestId = id
          bestCount = n
        }
      }
      return bestId
    },
    enabled: !!(salonId && clientId && serviceId),
    staleTime: 60_000,
  })
}
