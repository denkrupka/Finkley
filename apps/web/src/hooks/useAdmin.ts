import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Hooks для super-admin панели. Все вызовы через edge function `admin-stats`,
 * которая сама проверяет app_admins и возвращает данные с service-role.
 */

async function callAdmin<T>(action: string): Promise<T> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('not_authenticated')
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  const r = await fetch(`${baseUrl}/functions/v1/admin-stats?action=${action}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `HTTP ${r.status}`)
  }
  return (await r.json()) as T
}

async function postAdmin<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) throw new Error('not_authenticated')
  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  const r = await fetch(`${baseUrl}/functions/v1/admin-stats?action=${action}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `HTTP ${r.status}`)
  }
  return (await r.json()) as T
}

export type AdminOverview = {
  salons: {
    total: number
    subscribed: number
    on_trial: number
    trial_expired: number
    inactive_no_sub: number
    blocked: number
  }
  users: { total: number; members: number; active_30d: number }
  charts: {
    salons_by_month: Array<{ month: string; count: number }>
    users_by_month: Array<{ month: string; count: number }>
    visits_by_month: Array<{ month: string; count: number }>
  }
}

export type AdminSalonRow = {
  id: string
  name: string
  currency: string
  plan_status: string | null
  trial_ends_at: string | null
  bonus_until: string | null
  sub_source: string | null
  created_at: string
  owner_id: string | null
  owner_email: string | null
  owner_full_name: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  owner_phone: string | null
  blocked_at: string | null
  blocked_reason: string | null
  period_months: number
  avg_profit_cents: number
  portal_revenue_cents: number
  effective_status: 'blocked' | 'subscribed' | 'on_trial' | 'trial_expired' | 'inactive'
  valid_until: string | null
}

export type AdminUserRow = {
  id: string
  email: string | null
  last_sign_in_at: string | null
  created_at: string
  banned_until: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  app_role: 'super_admin' | 'admin' | null
  is_tester: boolean
  salons: Array<{ salon_id: string; salon_name: string; role: string }>
}

export type AdminFeedbackRow = {
  id: string
  telegram_chat_id: number | null
  sender_username: string | null
  sender_first_name: string | null
  message_text: string | null
  ai_summary: string | null
  status: 'open' | 'in_progress' | 'fixed' | 'wontfix' | 'duplicate'
  severity: string | null
  kind: 'bug' | 'feature'
  area: string | null
  source: 'team' | 'client' | 'admin_ui' | 'tester'
  requires_approval: boolean
  approved_by: string | null
  approved_at: string | null
  reporter_user_id: string | null
  reporter_email: string | null
  reporter_full_name: string | null
  reporter_phone: string | null
  reporter_telegram: string | null
  reporter_salons: Array<{ salon_id: string; salon_name: string; role: string }>
  salon_id: string | null
  salon_name: string | null
  attachments: Array<{
    type?: string
    storage_path?: string | null
    mime?: string
    size?: number
    name?: string
    vision_summary?: string
  }> | null
  notes: string | null
  reported_at: string
  created_at: string
}

export function useAdminOverview() {
  return useQuery<AdminOverview>({
    queryKey: ['admin-overview'],
    queryFn: () => callAdmin<AdminOverview>('overview'),
  })
}

export function useAdminSalons() {
  return useQuery<{ salons: AdminSalonRow[] }>({
    queryKey: ['admin-salons'],
    queryFn: () => callAdmin<{ salons: AdminSalonRow[] }>('salons'),
  })
}

export function useAdminUsers() {
  return useQuery<{ users: AdminUserRow[] }>({
    queryKey: ['admin-users'],
    queryFn: () => callAdmin<{ users: AdminUserRow[] }>('users'),
  })
}

export function useAdminFeedback() {
  return useQuery<{ feedback: AdminFeedbackRow[] }>({
    queryKey: ['admin-feedback'],
    queryFn: () => callAdmin<{ feedback: AdminFeedbackRow[] }>('feedback'),
  })
}

function useInvalidateSalons() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['admin-salons'] })
    qc.invalidateQueries({ queryKey: ['admin-overview'] })
  }
}

export function useSalonBlock() {
  const invalidate = useInvalidateSalons()
  return useMutation({
    mutationFn: (vars: { salon_id: string; reason?: string }) =>
      postAdmin<{ ok: true }>('salon_block', vars),
    onSuccess: invalidate,
  })
}

export function useSalonUnblock() {
  const invalidate = useInvalidateSalons()
  return useMutation({
    mutationFn: (vars: { salon_id: string }) => postAdmin<{ ok: true }>('salon_unblock', vars),
    onSuccess: invalidate,
  })
}

export function useSalonDelete() {
  const invalidate = useInvalidateSalons()
  return useMutation({
    mutationFn: (vars: { salon_id: string }) =>
      postAdmin<{ ok: true; deleted_users: number }>('salon_delete', vars),
    onSuccess: invalidate,
  })
}

export function useSalonAddUser() {
  const invalidate = useInvalidateSalons()
  return useMutation({
    mutationFn: (vars: { salon_id: string; email: string; role?: string }) =>
      postAdmin<{ ok: true; mode: 'attached' | 'invited'; user_id?: string }>(
        'salon_add_user',
        vars,
      ),
    onSuccess: invalidate,
  })
}

function useInvalidateUsers() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] })
  }
}

export function useUserBlock() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: (vars: { user_id: string }) => postAdmin<{ ok: true }>('user_block', vars),
    onSuccess: invalidate,
  })
}

export function useUserUnblock() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: (vars: { user_id: string }) => postAdmin<{ ok: true }>('user_unblock', vars),
    onSuccess: invalidate,
  })
}

function useInvalidateFeedback() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['admin-feedback'] })
  }
}

export function useFeedbackApprove() {
  const invalidate = useInvalidateFeedback()
  return useMutation({
    mutationFn: (vars: { id: string }) => postAdmin<{ ok: true }>('feedback_approve', vars),
    onSuccess: invalidate,
  })
}

export function useFeedbackReject() {
  const invalidate = useInvalidateFeedback()
  return useMutation({
    mutationFn: (vars: { id: string }) => postAdmin<{ ok: true }>('feedback_reject', vars),
    onSuccess: invalidate,
  })
}

export type FeedbackAttachment = {
  storage_path?: string | null
  mime?: string
  name?: string
  type?: string
  vision_summary?: string
  transcript?: string
  signed_url?: string | null
}

export function useFeedbackAttachments(bugId: string | null) {
  return useQuery<{ attachments: FeedbackAttachment[] }>({
    queryKey: ['admin-feedback-attachments', bugId],
    queryFn: () =>
      postAdmin<{ attachments: FeedbackAttachment[] }>('feedback_attachments', { id: bugId! }),
    enabled: !!bugId,
    staleTime: 30 * 60 * 1000,
  })
}

export function useFeedbackStatus() {
  const invalidate = useInvalidateFeedback()
  return useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      postAdmin<{ ok: true }>('feedback_status', vars),
    onSuccess: invalidate,
  })
}

export function useAdminGrant() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: (vars: { user_id: string; is_super?: boolean }) =>
      postAdmin<{ ok: true }>('admin_grant', vars),
    onSuccess: invalidate,
  })
}

export function useAdminRevoke() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: (vars: { user_id: string }) => postAdmin<{ ok: true }>('admin_revoke', vars),
    onSuccess: invalidate,
  })
}

export function useUpdateUserProfile() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: (vars: {
      user_id: string
      first_name?: string
      last_name?: string
      phone?: string
      email?: string
    }) => postAdmin<{ ok: true }>('user_update_profile', vars),
    onSuccess: invalidate,
  })
}

export function useSetTesterFlag() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: (vars: { user_id: string; is_tester: boolean }) =>
      postAdmin<{ ok: true }>('user_set_tester', vars),
    onSuccess: invalidate,
  })
}

export function useMemberRoleChange() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: (vars: { salon_id: string; user_id: string; role: string }) =>
      postAdmin<{ ok: true }>('member_role_change', vars),
    onSuccess: invalidate,
  })
}

export function useSalonExtendDemo() {
  const invalidate = useInvalidateSalons()
  return useMutation({
    mutationFn: (vars: { salon_id: string; until_iso: string; reason?: string }) =>
      postAdmin<{ ok: true; mode: 'create' | 'bonus' | 'extend_trial' }>('salon_extend_demo', vars),
    onSuccess: invalidate,
  })
}
