import { useMutation } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type CreateBooksyReservationInput = {
  salonId: string
  staffIdExternal: string
  startAt: string // ISO
  endAt: string // ISO
  title: string
}

/**
 * Создаёт в Booksy блокирующий слот (reservation) на staff + время, чтобы
 * клиент не мог забукать тот же слот через Booksy онлайн. Вызывается
 * после создания визита в Finkley когда:
 *   - Booksy integration подключён к этому салону
 *   - У мастера есть staff.external_id (импортирован из Booksy при синке)
 *   - У услуги есть default_duration_min
 *   - kind === 'visit' (не retail)
 *
 * Silent: если Booksy не подключён или вызов упал — тихо. Визит в Finkley
 * уже создан, reservation — enhancement. Возвращает booksy_reservation_id
 * или null. Caller сам решает: сохранить в visits.metadata.
 */
export function useCreateBooksyReservation() {
  return useMutation({
    mutationFn: async (input: CreateBooksyReservationInput): Promise<string | null> => {
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: {
          action: 'create_reservation',
          salon_id: input.salonId,
          staff_id_external: input.staffIdExternal,
          start_at: input.startAt,
          end_at: input.endAt,
          title: input.title,
        },
      })
      if (error) return null // silent
      const json = data as { ok?: boolean; reservation_id?: string | null }
      if (!json.ok) return null
      return json.reservation_id ?? null
    },
  })
}
