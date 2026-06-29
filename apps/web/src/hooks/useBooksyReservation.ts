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

/** Результат попытки создать резервацию в Booksy. Раньше хук возвращал
 *  `string | null` и проглатывал причину отказа — из-за чего несинк выглядел
 *  как «тихо ничего не произошло». Теперь возвращаем структуру с реальной
 *  причиной от Booksy, чтобы caller показал её владельцу (toast). */
export type BooksyReservationResult = {
  ok: boolean
  /** id резервации в Booksy (если создана). */
  reservationId: string | null
  /** Машинный код ошибки (booksy_reservation_failed / код invoke-ошибки). */
  error?: string
  /** HTTP-статус ответа Booksy (если отказ на стороне Booksy). */
  status?: number
  /** Человекочитаемое сообщение от Booksy — для toast'а владельцу. */
  message?: string
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
 * НЕ silent: возвращает {@link BooksyReservationResult}. При успехе ok=true +
 * reservationId (booksy-proxy сам пишет visits.external_reservation_id). При
 * отказе ok=false + message/status/error — caller обязан показать это владельцу,
 * иначе несинк остаётся невидимым. mutationFn НЕ кидает — всегда резолвит
 * результат (callerу удобно через mutateAsync).
 */
export function useCreateBooksyReservation() {
  return useMutation({
    mutationFn: async (input: CreateBooksyReservationInput): Promise<BooksyReservationResult> => {
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
      if (error) {
        // FunctionsHttpError: при не-2xx ответе edge-функции (502 при отказе
        // Booksy) supabase-js кладёт сам ответ в error.context (Response).
        // Достаём оттуда тело {error,status,message}, чтобы показать причину.
        let status: number | undefined
        let message: string | undefined
        const ctx = (error as { context?: unknown }).context
        if (ctx && typeof (ctx as Response).json === 'function') {
          try {
            const body = (await (ctx as Response).json()) as {
              status?: number
              message?: string
              error?: string
            }
            status = body.status
            message = body.message ?? body.error
          } catch {
            /* тело не JSON — оставляем error.message */
          }
        }
        return { ok: false, reservationId: null, error: error.message, status, message }
      }
      const json = data as {
        ok?: boolean
        reservation_id?: string | null
        error?: string
        status?: number
        message?: string
      }
      if (!json.ok) {
        return {
          ok: false,
          reservationId: null,
          error: json.error,
          status: json.status,
          message: json.message,
        }
      }
      return { ok: true, reservationId: json.reservation_id ?? null }
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
