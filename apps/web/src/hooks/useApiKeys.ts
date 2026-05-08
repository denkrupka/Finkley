import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type ApiKey = {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export function useApiKeys(salonId: string | undefined) {
  return useQuery<ApiKey[]>({
    queryKey: ['api-keys', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, name, key_prefix, scopes, created_at, last_used_at, revoked_at')
        .eq('salon_id', salonId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ApiKey[]
    },
    enabled: !!salonId,
  })
}

export function useCreateApiKey(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; scopes: string[] }) => {
      const { data, error } = await supabase.functions.invoke('api-keys-create', {
        body: { salon_id: salonId, name: input.name, scopes: input.scopes },
      })
      if (error) throw error
      const json = data as { ok: boolean; api_key?: string; record?: ApiKey; error?: string }
      if (!json.ok || !json.api_key) throw new Error(json.error ?? 'create_failed')
      return { fullKey: json.api_key, record: json.record! }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', salonId] }),
  })
}

export function useRevokeApiKey(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', keyId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', salonId] }),
  })
}
