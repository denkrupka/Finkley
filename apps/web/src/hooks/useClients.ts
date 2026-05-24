import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'
import { normalizeSearchPhone } from '@/lib/utils/phone-search'

export type ClientSocial = {
  /** instagram | facebook | telegram | custom. Иконка/UI берётся отсюда. */
  kind: 'instagram' | 'facebook' | 'telegram' | 'custom'
  /** Произвольный лейбл для custom kind (например, «VK», «TikTok»). */
  label?: string
  /** Username / номер / ссылка — что юзер вписал. */
  handle: string
}

export type ClientRow = {
  id: string
  salon_id: string
  name: string
  phone: string | null
  email: string | null
  birthday: string | null
  source: string | null
  tags: string[]
  notes: string | null
  socials: ClientSocial[]
  /** Персональная скидка клиента (%, 0..100). Авто-применяется в форме визита. */
  discount_percent: number | null
  visit_count: number
  total_revenue_cents: number
  last_visit_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type ClientSort = 'name' | 'last_visit' | 'revenue'

export function clientsKeys(salonId: string | undefined) {
  return ['clients', salonId] as const
}

/**
 * Список клиентов салона.
 *
 * - search фильтруется на клиенте: строка ищется в name (case-insensitive)
 *   и в phone (после normalizeSearchPhone). Размер списка обычно ≤ 5000,
 *   серверный поиск имеет смысл только при больших объёмах — в стадии 2 не нужно.
 */
/**
 * Per-client LTV metrics — gross/visits/lifetime. Revenue уже есть в
 * clients.total_revenue_cents, но RPC возвращает свежий пересчёт + gross
 * (с учётом services.cost_cents).
 */
export type ClientLtvMetrics = {
  client_id: string
  revenue_ltv_cents: number
  visits_count: number
  customer_lifetime_months: number
}

export function useClientLtvMetrics(salonId: string | undefined) {
  return useQuery<Map<string, ClientLtvMetrics>>({
    queryKey: ['client-ltv-metrics', salonId],
    queryFn: async () => {
      if (!salonId) return new Map()
      const { data, error } = await supabase.rpc('client_ltv_metrics', {
        p_salon_id: salonId,
      })
      if (error) throw error
      const m = new Map<string, ClientLtvMetrics>()
      for (const row of (data ?? []) as ClientLtvMetrics[]) {
        m.set(row.client_id, row)
      }
      return m
    },
    enabled: !!salonId,
    staleTime: 5 * 60 * 1000, // 5 min — пересчёт нужен реже чем список клиентов
  })
}

export function useClients(
  salonId: string | undefined,
  options?: { search?: string; sort?: ClientSort },
) {
  const search = options?.search?.trim() ?? ''
  const sort = options?.sort ?? 'last_visit'

  return useQuery<ClientRow[]>({
    queryKey: [...clientsKeys(salonId), 'list', { search, sort }],
    queryFn: async () => {
      if (!salonId) return []
      // Серверный поиск через ilike: при наборе текста запросом тянем
      // только релевантные строки (limit 300), не нагружая фронт фильтрацией
      // 5000 строк на каждый keystroke. Без search — берём всё (до 5000),
      // нужно для списков типа export/печать.
      let q = supabase.from('clients').select('*').eq('salon_id', salonId).is('deleted_at', null)
      if (search) {
        const escaped = search.replace(/[%_]/g, (m) => `\\${m}`)
        // Phone поиск — нормализуем pattern (digits only) и фильтруем через ilike.
        const phonePattern = normalizeSearchPhone(search)
        const orFilter =
          phonePattern.length >= 2
            ? `name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${phonePattern}%`
            : `name.ilike.%${escaped}%,email.ilike.%${escaped}%`
        q = q.or(orFilter).limit(300)
      } else {
        q = q.limit(5000)
      }

      // Сортировка применяется на сервере, чтобы LIMIT срабатывал по нужной оси.
      if (sort === 'name') q = q.order('name', { ascending: true })
      else if (sort === 'revenue') q = q.order('total_revenue_cents', { ascending: false })
      else
        q = q
          .order('last_visit_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ClientRow[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useClient(salonId: string | undefined, clientId: string | undefined | null) {
  return useQuery<ClientRow | null>({
    queryKey: [...clientsKeys(salonId), 'one', clientId],
    queryFn: async () => {
      if (!salonId || !clientId) return null
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .is('deleted_at', null)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as ClientRow | null
    },
    enabled: !!salonId && !!clientId,
    staleTime: 30_000,
  })
}

export type CreateClientInput = {
  salon_id: string
  name: string
  phone?: string | null
  email?: string | null
  source?: string | null
  notes?: string | null
  discount_percent?: number | null
  socials?: ClientSocial[]
}

export function useCreateClient(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateClientInput) => {
      const payload: Record<string, unknown> = {
        salon_id: input.salon_id,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        source: input.source?.trim() || null,
        notes: input.notes?.trim() || null,
      }
      if (input.discount_percent !== undefined) payload.discount_percent = input.discount_percent
      if (input.socials !== undefined) payload.socials = input.socials
      const { data, error } = await supabase.from('clients').insert(payload).select('*').single()
      if (error) throw error
      return data as ClientRow
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientsKeys(salonId) })
    },
  })
}

export type UpdateClientInput = {
  id: string
  name?: string
  phone?: string | null
  email?: string | null
  source?: string | null
  notes?: string | null
  discount_percent?: number | null
  socials?: ClientSocial[]
}

export function useUpdateClient(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateClientInput) => {
      const { id, ...rest } = input
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined) continue
        patch[k] = typeof v === 'string' ? v.trim() || null : v
      }
      if (typeof rest.name === 'string') patch.name = rest.name.trim()
      const { data, error } = await supabase
        .from('clients')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      return data as ClientRow
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: clientsKeys(salonId) })
      qc.invalidateQueries({ queryKey: [...clientsKeys(salonId), 'one', row.id] })
    },
  })
}

export function useDeleteClient(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from('clients')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', clientId)
      if (error) throw error
      return clientId
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clientsKeys(salonId) })
    },
  })
}

/**
 * Визиты конкретного клиента — для drawer'а истории.
 */
export function useClientVisits(salonId: string | undefined, clientId: string | undefined | null) {
  return useQuery({
    queryKey: ['client_visits', salonId, clientId],
    queryFn: async () => {
      if (!salonId || !clientId) return []
      const { data, error } = await supabase
        .from('visits')
        .select(
          'id, visit_at, amount_cents, tip_cents, payment_method, status, comment, staff_id, service_id, service_name_snapshot',
        )
        .eq('salon_id', salonId)
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .order('visit_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data ?? []
    },
    enabled: !!salonId && !!clientId,
    staleTime: 30_000,
  })
}
