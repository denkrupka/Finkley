import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type MFAFactor = {
  id: string
  friendly_name?: string
  factor_type: 'totp' | 'phone'
  status: 'verified' | 'unverified'
  created_at: string
}

/** Список MFA-факторов текущего юзера. */
export function useMFAFactors() {
  return useQuery<MFAFactor[]>({
    queryKey: ['mfa-factors'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      const all = (data?.all ?? []) as MFAFactor[]
      return all
    },
  })
}

/**
 * Enroll TOTP factor → возвращает QR код + secret. После вызова юзер
 * должен сосканировать QR в приложении (Google Authenticator/1Password/etc),
 * получить 6-значный код и вызвать verifyEnrollment.
 */
export function useEnrollTOTP() {
  return useMutation({
    mutationFn: async (friendlyName: string) => {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName,
      })
      if (error) throw error
      return {
        factorId: data.id,
        qrCode: data.totp.qr_code, // SVG markup
        secret: data.totp.secret,
        uri: data.totp.uri,
      }
    },
  })
}

/** Подтвердить enrollment 6-значным кодом из приложения. */
export function useVerifyEnrollment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { factorId: string; code: string }) => {
      // Сначала challenge → потом verify
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({
        factorId: input.factorId,
      })
      if (cErr) throw cErr
      const { data, error } = await supabase.auth.mfa.verify({
        factorId: input.factorId,
        challengeId: challenge.id,
        code: input.code,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfa-factors'] })
    },
  })
}

/** Удалить (отозвать) фактор. */
export function useUnenrollMFA() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (factorId: string) => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfa-factors'] })
    },
  })
}

/**
 * Login flow continuation: после signIn если у юзера есть verified
 * factor, Supabase возвращает session с `aal: 'aal1'`. Чтобы получить
 * `aal2` (нужно для чувствительных действий), вызываем challenge+verify
 * с уже введённым кодом.
 */
export function useChallengeMFA() {
  return useMutation({
    mutationFn: async (input: { factorId: string; code: string }) => {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({
        factorId: input.factorId,
      })
      if (cErr) throw cErr
      const { data, error } = await supabase.auth.mfa.verify({
        factorId: input.factorId,
        challengeId: challenge.id,
        code: input.code,
      })
      if (error) throw error
      return data
    },
  })
}

/** Текущий AAL (auth assurance level). */
export function useAAL() {
  return useQuery({
    queryKey: ['aal'],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (error) throw error
      return {
        currentLevel: data?.currentLevel ?? null,
        nextLevel: data?.nextLevel ?? null,
        currentAuthenticationMethods: data?.currentAuthenticationMethods ?? [],
      }
    },
    staleTime: 60_000,
  })
}
