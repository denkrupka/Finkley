/**
 * React Query хуки + HTTP-клиент для общения с tg-userbot bridge
 * (services/tg-userbot/, развёрнут на https://userbot.finkley.app).
 *
 * Auth flow: phone → /auth/start → SMS-код → /auth/code → [2FA-пароль →
 * /auth/2fa] → готово, в tg_sessions появилась активная запись.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

const BRIDGE_URL = import.meta.env.VITE_TG_USERBOT_URL || 'https://userbot.finkley.app'

export type TgSessionRow = {
  id: string
  salon_id: string
  user_id: string
  phone: string
  tg_user_id: number | null
  tg_username: string | null
  tg_first_name: string | null
  tg_last_name: string | null
  status: 'active' | 'revoked' | 'error' | 'unauthorized'
  last_error: string | null
  last_seen_at: string | null
  created_at: string
}

async function bridgeFetch<T>(path: string, body: object): Promise<T> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('Не авторизован — войди в аккаунт заново')

  const r = await fetch(`${BRIDGE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    let detail: string
    try {
      const j = await r.json()
      detail = j.detail || j.message || `HTTP ${r.status}`
    } catch {
      detail = `HTTP ${r.status}`
    }
    throw new Error(detail)
  }
  return r.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Список своих сессий (RLS: user_id=auth.uid())
// ---------------------------------------------------------------------------

export function useTgSessions(salonId: string | undefined) {
  return useQuery<TgSessionRow[]>({
    queryKey: ['tg-sessions', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('tg_sessions')
        .select(
          'id, salon_id, user_id, phone, tg_user_id, tg_username, tg_first_name, tg_last_name, status, last_error, last_seen_at, created_at',
        )
        .eq('salon_id', salonId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as TgSessionRow[]
    },
    enabled: !!salonId,
    refetchInterval: 5_000,
  })
}

// ---------------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------------

export type AuthStartResp = { auth_flow_id: string; state: 'awaiting_code' }
export type AuthAwaiting2FAResp = { state: 'awaiting_2fa' }
export type AuthDoneResp = {
  state: 'done'
  session_id: string
  tg_user_id: number
  tg_username: string | null
  tg_first_name: string | null
}
export type AuthAnyResp = AuthAwaiting2FAResp | AuthDoneResp

export function useTgAuthStart() {
  return useMutation({
    mutationFn: (input: { salon_id: string; phone: string }) =>
      bridgeFetch<AuthStartResp>('/auth/start', input),
  })
}

export function useTgAuthCode() {
  return useMutation({
    mutationFn: (input: { auth_flow_id: string; code: string }) =>
      bridgeFetch<AuthAnyResp>('/auth/code', input),
  })
}

export function useTgAuth2FA() {
  return useMutation({
    mutationFn: (input: { auth_flow_id: string; password: string }) =>
      bridgeFetch<AuthDoneResp>('/auth/2fa', input),
  })
}

// ---------------------------------------------------------------------------
// Logout (мягко: помечаем status=revoked, worker сам остановит клиент)
// ---------------------------------------------------------------------------

export function useTgLogout(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { error } = await supabase
        .from('tg_sessions')
        .update({ status: 'revoked' })
        .eq('id', sessionId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tg-sessions', salonId] }),
  })
}
