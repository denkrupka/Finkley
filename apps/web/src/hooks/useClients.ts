import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'
import { normalizeSearchPhone } from '@/lib/utils/phone-search'

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
      let q = supabase
        .from('clients')
        .select('*')
        .eq('salon_id', salonId)
        .is('deleted_at', null)
        .limit(5000)

      // Сортировка применяется на сервере, чтобы LIMIT срабатывал по нужной оси
      if (sort === 'name') q = q.order('name', { ascending: true })
      else if (sort === 'revenue') q = q.order('total_revenue_cents', { ascending: false })
      else
        q = q
          .order('last_visit_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })

      const { data, error } = await q
      if (error) throw error
      let rows = (data ?? []) as ClientRow[]

      if (search) {
        const lower = search.toLowerCase()
        const phoneSearch = normalizeSearchPhone(search)
        rows = rows.filter((c) => {
          const nameMatch = c.name.toLowerCase().includes(lower)
          const phoneMatch =
            phoneSearch.length >= 2 &&
            c.phone &&
            normalizeSearchPhone(c.phone).includes(phoneSearch)
          const emailMatch = c.email && c.email.toLowerCase().includes(lower)
          return nameMatch || phoneMatch || emailMatch
        })
      }

      return rows
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
  notes?: string | null
}

export function useCreateClient(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateClientInput) => {
      const payload = {
        salon_id: input.salon_id,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        notes: input.notes?.trim() || null,
      }
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
  notes?: string | null
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
