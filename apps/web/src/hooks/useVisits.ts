import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'online' | 'mixed'
export type VisitStatus = 'paid' | 'pending' | 'cancelled'
export type VisitKind = 'visit' | 'retail'

export type VisitRow = {
  id: string
  salon_id: string
  staff_id: string | null
  client_id: string | null
  service_id: string | null
  service_name_snapshot: string | null
  visit_at: string
  amount_cents: number
  tip_cents: number
  discount_cents: number
  payment_method: PaymentMethod
  status: VisitStatus
  comment: string | null
  source: string
  group_key: string | null
  kind: VisitKind
  /**
   * Длительность визита в минутах. null = используется
   * service.default_duration_min или 60-мин default. Заполняется
   * QuickEntryModal на основе end_time-start_time.
   */
  duration_min: number | null
  /** ID кассы (financial_settings.cash_registers.items[]) — image #82. */
  cash_register_id: string | null
  /** Для retail-визитов — товар со склада (для финотчёта по категориям). */
  inventory_item_id: string | null
  /** Image #51: сумма уже полученного по визиту (для частичных поступлений).
   *  NULL = полностью получено. См. income_payment_installments + trigger. */
  paid_amount_cents: number | null
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type VisitsPeriod = { start: string; end: string }

/**
 * Re-export pure-helper (см. lib/income/effective-received.ts) — старый
 * импорт `from '@/hooks/useVisits'` остаётся валидным для всех мест где
 * helper уже используется (CashFlowTab, FinancialReportTab, SalesTab, etc).
 */
export { effectiveReceivedFromVisit } from '@/lib/income/effective-received'

export function visitsKeys(salonId: string | undefined) {
  return ['visits', salonId] as const
}

export function useVisits(
  salonId: string | undefined,
  period: VisitsPeriod,
  filters?: {
    staffId?: string | null
    paymentMethod?: PaymentMethod | null
    serviceId?: string | null
    kind?: VisitKind | null
  },
) {
  const filterKey = filters ?? {}
  return useQuery<VisitRow[]>({
    queryKey: [...visitsKeys(salonId), 'list', period, filterKey],
    queryFn: async () => {
      if (!salonId) return []
      let q = supabase
        .from('visits')
        .select('*')
        .eq('salon_id', salonId)
        .is('deleted_at', null)
        .gte('visit_at', period.start)
        .lt('visit_at', period.end)
        .order('visit_at', { ascending: false })

      if (filters?.staffId) q = q.eq('staff_id', filters.staffId)
      if (filters?.paymentMethod) q = q.eq('payment_method', filters.paymentMethod)
      if (filters?.serviceId) q = q.eq('service_id', filters.serviceId)
      if (filters?.kind) q = q.eq('kind', filters.kind)

      const { data, error } = await q.limit(200)
      if (error) throw error
      return (data ?? []) as VisitRow[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export type CreateVisitInput = {
  salon_id: string
  staff_id?: string | null
  client_id?: string | null
  service_id?: string | null
  service_name_snapshot?: string | null
  visit_at: string
  amount_cents: number
  tip_cents?: number
  discount_cents?: number
  payment_method: PaymentMethod
  comment?: string | null
  kind?: VisitKind
  /** По умолчанию 'paid' (обычный QuickEntry создаёт оплаченный визит).
   *  Wizard продажи может явно задать 'paid'; reservations могут 'pending'. */
  status?: VisitStatus
  /** Группа связанных визитов (одна продажа из 2+ позиций, чаще всего
   *  retail-wizard). UI рендерит группу как раскрывающуюся строку. */
  group_key?: string | null
  /** Длительность визита в минутах (end_time − start_time из QuickEntry).
   *  Если null — на UI fallback на service.default_duration_min. */
  duration_min?: number | null
  /** ID кассы из financial_settings.cash_registers.items[] (image #82). */
  cash_register_id?: string | null
  /** Для retail-визитов — товар со склада (категория попадает в финотчёт). */
  inventory_item_id?: string | null
  /** VAT-нетто (миграция 20260602000001). NULL → fallback на amount_cents
   *  в P&L (через vatBreakdownFor). UI плательщика VAT всегда заполняет. */
  amount_net_cents?: number | null
  /** Ставка НДС % (0/5/8/23 для PL). NULL = не задано. */
  vat_rate_pct?: number | null
  /** True если документ пропущен (documentType='skip' в RetailSaleWizard
   *  или явная галочка в QuickEntry). vatBreakdownFor исключает такие
   *  суммы из расчёта НДС к оплате — деньги приняли, фискаль не выбит. */
  vat_skipped?: boolean | null
}

export function useCreateVisit(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateVisitInput) => {
      const { data, error } = await supabase
        .from('visits')
        .insert({
          ...input,
          status: (input.status ?? 'paid') as VisitStatus,
          source: 'manual',
        })
        .select('*')
        .single()
      if (error) throw error
      return data as VisitRow
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: visitsKeys(salonId) })
      // Optimistic insert: добавляем фейковую строку во все list-кэши.
      const tempId = `temp-${Date.now()}`
      const optimistic: VisitRow = {
        id: tempId,
        salon_id: input.salon_id,
        staff_id: input.staff_id ?? null,
        client_id: input.client_id ?? null,
        service_id: input.service_id ?? null,
        service_name_snapshot: input.service_name_snapshot ?? null,
        visit_at: input.visit_at,
        amount_cents: input.amount_cents,
        tip_cents: input.tip_cents ?? 0,
        discount_cents: input.discount_cents ?? 0,
        payment_method: input.payment_method,
        status: 'paid',
        comment: input.comment ?? null,
        source: 'manual',
        group_key: null,
        kind: input.kind ?? 'visit',
        duration_min: input.duration_min ?? null,
        cash_register_id: input.cash_register_id ?? null,
        inventory_item_id: input.inventory_item_id ?? null,
        paid_amount_cents: null,
        created_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      }
      const prevSnapshots: { key: readonly unknown[]; data: VisitRow[] }[] = []
      qc.getQueriesData<VisitRow[]>({ queryKey: visitsKeys(salonId) }).forEach(([key, list]) => {
        if (Array.isArray(list)) {
          prevSnapshots.push({ key, data: list })
          qc.setQueryData<VisitRow[]>(key, [optimistic, ...list])
        }
      })
      return { prevSnapshots, tempId }
    },
    onError: (_err, _input, ctx) => {
      ctx?.prevSnapshots.forEach(({ key, data }) => qc.setQueryData(key, data))
    },
    onSuccess: async () => {
      // Image #105: refetchType:'all' гарантирует что фоновые SalesTab /
      // VisitsCalendarView сразу подтянут новый визит — иначе после
      // retail wizard'а продажа не появляется в списке до reload.
      await Promise.all([
        qc.invalidateQueries({ queryKey: visitsKeys(salonId), refetchType: 'all' }),
        qc.invalidateQueries({ queryKey: ['dashboard', salonId] }),
      ])
    },
  })
}

export type UpdateVisitInput = {
  id: string
  staff_id?: string | null
  client_id?: string | null
  service_id?: string | null
  service_name_snapshot?: string | null
  visit_at?: string
  amount_cents?: number
  tip_cents?: number
  discount_cents?: number
  payment_method?: PaymentMethod
  status?: VisitStatus
  comment?: string | null
  /** Длительность визита в минутах (image #85). */
  duration_min?: number | null
  /** ID кассы (image #82). */
  cash_register_id?: string | null
  /** Группа связанных визитов. Нужен когда VisitDetailModal добавляет
   *  «+ услугу» к одиночному визиту: устанавливаем group_key на текущем и
   *  даём тот же на новом — UI начинает рендерить их как группу. */
  group_key?: string | null
}

export function useUpdateVisit(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateVisitInput) => {
      const { id, ...patch } = input
      const { data, error } = await supabase
        .from('visits')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data as VisitRow
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: visitsKeys(salonId), refetchType: 'all' }),
        qc.invalidateQueries({ queryKey: ['dashboard', salonId] }),
      ])
    },
  })
}

export function useDeleteVisit(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (visitId: string) => {
      // Тянем external_reservation_id и salon_id ДО soft-delete чтобы знать
      // нужно ли снять парный блок в Booksy. Visit мы создавали через портал
      // → reservation в Booksy наш, он portal-owned, удаляем симметрично.
      const { data: visitRow } = await supabase
        .from('visits')
        .select('external_reservation_id, salon_id')
        .eq('id', visitId)
        .maybeSingle()
      console.warn(
        `[useDeleteVisit] visit=${visitId} external_reservation_id=${visitRow?.external_reservation_id ?? 'null'}`,
      )
      const { error } = await supabase
        .from('visits')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', visitId)
      if (error) throw error
      // Best-effort: ошибка в Booksy не откатывает локальный delete.
      if (visitRow?.external_reservation_id && visitRow.salon_id) {
        try {
          const { data, error: invokeErr } = await supabase.functions.invoke('booksy-proxy', {
            body: {
              action: 'delete_reservation',
              salon_id: visitRow.salon_id,
              reservation_id: visitRow.external_reservation_id,
            },
          })
          if (invokeErr) {
            console.warn('[useDeleteVisit] booksy-proxy invoke error:', invokeErr.message)
          } else {
            const json = data as { ok?: boolean; error?: string; message?: string; status?: number }
            if (!json.ok) {
              console.warn(
                `[useDeleteVisit] booksy delete_reservation failed: ${json.error} ${json.message ?? ''} (status=${json.status ?? '?'})`,
              )
            } else {
              console.warn(
                `[useDeleteVisit] booksy reservation ${visitRow.external_reservation_id} deleted ok`,
              )
            }
          }
        } catch (e) {
          console.warn(
            '[useDeleteVisit] Booksy delete_reservation threw:',
            e instanceof Error ? e.message : String(e),
          )
        }
      } else {
        console.warn(`[useDeleteVisit] no external_reservation_id — skip booksy delete`)
      }
      return visitId
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitsKeys(salonId) })
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
    },
  })
}

export function useRestoreVisit(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (visitId: string) => {
      const { error } = await supabase.from('visits').update({ deleted_at: null }).eq('id', visitId)
      if (error) throw error
      return visitId
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitsKeys(salonId) })
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
    },
  })
}
