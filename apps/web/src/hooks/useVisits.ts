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
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type VisitsPeriod = { start: string; end: string }

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
    onSuccess: () => {
      // Свежий список + KPI должны перерисоваться.
      qc.invalidateQueries({ queryKey: visitsKeys(salonId) })
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: visitsKeys(salonId) })
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
    },
  })
}

export function useDeleteVisit(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (visitId: string) => {
      // soft delete
      const { error } = await supabase
        .from('visits')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', visitId)
      if (error) throw error
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
