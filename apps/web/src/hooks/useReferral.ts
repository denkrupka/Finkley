import { useMutation, useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export function useReferralCode() {
  return useQuery<string | null>({
    queryKey: ['referral-code'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_or_create_referral_code')
      if (error) throw error
      return (data as string | null) ?? null
    },
    staleTime: 60 * 60_000,
  })
}

export function useReferralUses() {
  return useQuery({
    queryKey: ['referral-uses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referral_uses')
        .select('id, code, created_at, activated_at, referred_user_id')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useApplyReferralCode() {
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await supabase.rpc('apply_referral_code', { p_code: code })
      if (error) throw error
      const json = data as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'apply_failed')
      return json
    },
  })
}
