import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type CounterpartyCategoryRow = {
  id: string
  salon_id: string
  name: string
  archived_at: string | null
  created_at: string
}

export type CounterpartyRow = {
  id: string
  salon_id: string
  name: string
  nip: string | null
  address: string | null
  category_id: string | null
  notes: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

function cpKeys(salonId: string | undefined) {
  return ['counterparties', salonId] as const
}
function catKeys(salonId: string | undefined) {
  return ['counterparty-categories', salonId] as const
}

export function useCounterparties(
  salonId: string | undefined,
  options?: { includeArchived?: boolean },
) {
  return useQuery<CounterpartyRow[]>({
    queryKey: [...cpKeys(salonId), { archived: !!options?.includeArchived }],
    queryFn: async () => {
      if (!salonId) return []
      let q = supabase.from('counterparties').select('*').eq('salon_id', salonId)
      if (!options?.includeArchived) q = q.is('archived_at', null)
      const { data, error } = await q.order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as CounterpartyRow[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useCounterpartyCategories(salonId: string | undefined) {
  return useQuery<CounterpartyCategoryRow[]>({
    queryKey: catKeys(salonId),
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('counterparty_categories')
        .select('*')
        .eq('salon_id', salonId)
        .is('archived_at', null)
        .order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as CounterpartyCategoryRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export function useCreateCounterpartyCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase
        .from('counterparty_categories')
        .insert({ salon_id: salonId, name: input.name.trim() })
        .select('*')
        .single()
      if (error) throw error
      return data as CounterpartyCategoryRow
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: catKeys(salonId) }),
  })
}

export function useUpdateCounterpartyCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; archived_at?: string | null }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('counterparty_categories').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: catKeys(salonId) }),
  })
}

export type CreateCounterpartyInput = {
  name: string
  nip?: string | null
  address?: string | null
  category_id?: string | null
  notes?: string | null
}

export function useCreateCounterparty(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateCounterpartyInput) => {
      if (!salonId) throw new Error('no_salon')
      const payload = {
        salon_id: salonId,
        name: input.name.trim(),
        nip: input.nip?.trim() || null,
        address: input.address?.trim() || null,
        category_id: input.category_id ?? null,
        notes: input.notes?.trim() || null,
      }
      const { data, error } = await supabase
        .from('counterparties')
        .insert(payload)
        .select('*')
        .single()
      if (error) throw error
      return data as CounterpartyRow
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cpKeys(salonId) }),
  })
}

export function useUpdateCounterparty(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string } & Partial<CreateCounterpartyInput>) => {
      const { id, ...rest } = input
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined) continue
        patch[k] = typeof v === 'string' ? v.trim() || null : v
      }
      if (typeof rest.name === 'string') patch.name = rest.name.trim()
      const { error } = await supabase.from('counterparties').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cpKeys(salonId) }),
  })
}

export function useArchiveCounterparty(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('counterparties')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: cpKeys(salonId) }),
  })
}

/**
 * Поиск компании по NIP через публичное API Минфина РП (wl-api.mf.gov.pl).
 * Возвращает name + address, остальные поля можно заполнить вручную при
 * создании контрагента.
 *
 * Если subject не найден в реестре — возвращает null, чтобы фронт показал
 * подходящий тост и юзер заполнил поля руками.
 */
export async function lookupNip(nip: string): Promise<{ name: string; address: string } | null> {
  const { data, error } = await supabase.functions.invoke('dataport-nip-lookup', {
    body: { nip },
  })
  if (error) throw error
  const res = data as {
    ok?: boolean
    name?: string
    address?: string
    not_found?: boolean
    error?: string
  }
  if (res?.not_found) return null
  if (!res?.ok) throw new Error(res?.error ?? 'lookup_failed')
  return { name: res.name ?? '', address: res.address ?? '' }
}
