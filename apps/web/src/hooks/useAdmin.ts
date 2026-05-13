import { useQuery } from '@tanstack/react-query'

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

export type AdminOverview = {
  salons: { total: number; active: number }
  users: { total: number }
  last30d: {
    visits: number
    revenue_cents: number
    expenses: number
    expenses_cents: number
    gross_profit_cents: number
  }
  messages_total: number
  messenger_integrations: Record<string, { connected: number; total: number }>
}

export type AdminSalonRow = {
  id: string
  name: string
  currency: string
  plan_status: string | null
  created_at: string
  owner_id: string | null
  owner_email: string | null
}

export type AdminUserRow = {
  id: string
  email: string | null
  last_sign_in_at: string | null
  created_at: string
  salons_count: number
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
