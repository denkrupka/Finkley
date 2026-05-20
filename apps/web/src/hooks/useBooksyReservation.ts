import { useMutation } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type CreateBooksyReservationInput = {
  salonId: string
  staffIdExternal: string
  startAt: string // ISO
  endAt: string // ISO
  title: string
  /** Если задан — booksy-proxy сохранит reservation_id в visits.external_reservation_id
   *  → при удалении визита в портале мы сможем снять парную резервацию в Booksy. */
  visitId?: string | null
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
          visit_id: input.visitId ?? null,
        },
      })
      if (error) return null // silent
      const json = data as { ok?: boolean; reservation_id?: string | null }
      if (!json.ok) return null
      return json.reservation_id ?? null
    },
  })
}

/**
 * Удаляет резервацию в Booksy. Вызывается когда юзер удаляет блок времени
 * в портале (staff_time_blocks с external_source='booksy'). Silent.
 */
export function useDeleteBooksyReservation() {
  return useMutation({
    mutationFn: async (input: { salonId: string; reservationId: string }): Promise<boolean> => {
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: {
          action: 'delete_reservation',
          salon_id: input.salonId,
          reservation_id: input.reservationId,
        },
      })
      if (error) return false
      const json = data as { ok?: boolean }
      return !!json.ok
    },
  })
}
