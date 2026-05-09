import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type BankConnectionStatus = 'pending' | 'connected' | 'expired' | 'revoked' | 'error'

export type BankConnectionRow = {
  id: string
  salon_id: string
  provider: string
  bank_name: string | null
  bank_aspsp_name: string | null
  bank_country: string | null
  status: BankConnectionStatus
  valid_until: string | null
  last_synced_at: string | null
  last_error: string | null
  history_days: number
  created_at: string
}

export type BankAccountRow = {
  id: string
  connection_id: string
  external_id: string
  iban: string | null
  name: string | null
  currency: string | null
  is_active: boolean
}

export type AspspRow = {
  name: string
  country: string
  psu_types: string[]
  logo?: string
  beta?: boolean
}

export type BankTransactionRow = {
  id: string
  account_id: string
  external_id: string
  type: 'debit' | 'credit'
  amount_cents: number
  currency: string
  description: string | null
  counterparty: string | null
  executed_at: string
  expense_id: string | null
}

export type BankInflowRow = BankTransactionRow & {
  bank_name: string | null
  account_iban: string | null
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const FN_URL = SUPABASE_URL.replace(/\/$/, '') + '/functions/v1'

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { authorization: `Bearer ${token}` } : {}
}

// =============================================================================
// Queries
// =============================================================================

export function useBankConnections(salonId: string | undefined) {
  return useQuery<BankConnectionRow[]>({
    queryKey: ['bank-connections', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('bank_connections')
        .select('*')
        .eq('salon_id', salonId)
        .neq('status', 'revoked')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as BankConnectionRow[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useBankAccountsForConnections(connectionIds: string[]) {
  return useQuery<BankAccountRow[]>({
    queryKey: ['bank-accounts', connectionIds.sort().join(',')],
    queryFn: async () => {
      if (connectionIds.length === 0) return []
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('*')
        .in('connection_id', connectionIds)
        .eq('is_active', true)
      if (error) throw error
      return (data ?? []) as BankAccountRow[]
    },
    enabled: connectionIds.length > 0,
    staleTime: 60_000,
  })
}

/**
 * Поступления — credit-транзакции из всех подключённых банков салона за
 * период. RLS-проверка идёт через bank_accounts → bank_connections →
 * salon_members; поэтому достаточно фильтра по периоду + type='credit'.
 *
 * Возвращаем join'нутую форму с bank_name/iban для красивого UI.
 */
export function useBankInflows(
  salonId: string | undefined,
  period: { start: string; end: string },
) {
  return useQuery<BankInflowRow[]>({
    queryKey: ['bank-inflows', salonId, period],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('bank_transactions')
        .select(
          `id, account_id, external_id, type, amount_cents, currency, description,
           counterparty, executed_at, expense_id,
           bank_accounts!inner (
             iban,
             bank_connections!inner (
               salon_id, bank_name, bank_aspsp_name
             )
           )`,
        )
        .eq('type', 'credit')
        .eq('bank_accounts.bank_connections.salon_id', salonId)
        .gte('executed_at', period.start)
        .lt('executed_at', period.end)
        .order('executed_at', { ascending: false })
        .limit(500)
      if (error) throw error
      // Supabase возвращает nested foreign-table'ы как массивы (даже когда
      // отношение по факту 1:1), потому что выводит type из postgresql FK.
      // Берём первый элемент.
      type Joined = BankTransactionRow & {
        bank_accounts?: Array<{
          iban: string | null
          bank_connections?: Array<{
            bank_name: string | null
            bank_aspsp_name: string | null
          }> | null
        }> | null
      }
      return ((data ?? []) as unknown as Joined[]).map((r): BankInflowRow => {
        const account = r.bank_accounts?.[0]
        const conn = account?.bank_connections?.[0]
        return {
          id: r.id,
          account_id: r.account_id,
          external_id: r.external_id,
          type: r.type,
          amount_cents: r.amount_cents,
          currency: r.currency,
          description: r.description,
          counterparty: r.counterparty,
          executed_at: r.executed_at,
          expense_id: r.expense_id,
          bank_name: conn?.bank_name ?? conn?.bank_aspsp_name ?? null,
          account_iban: account?.iban ?? null,
        }
      })
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useAspsps(country: string | null) {
  return useQuery<AspspRow[]>({
    queryKey: ['aspsps', country],
    queryFn: async () => {
      if (!country) return []
      const headers = await authHeader()
      const res = await fetch(`${FN_URL}/banking-aspsps?country=${country}`, { headers })
      if (!res.ok) throw new Error(`aspsps ${res.status}: ${await res.text()}`)
      const json = (await res.json()) as { aspsps: AspspRow[] }
      return json.aspsps ?? []
    },
    enabled: !!country,
    staleTime: 5 * 60 * 1000,
  })
}

// =============================================================================
// Mutations
// =============================================================================

export function useStartBankConnect(salonId: string | undefined) {
  return useMutation({
    mutationFn: async (input: {
      aspsp_name: string
      aspsp_country: string
      history_days: number
    }) => {
      if (!salonId) throw new Error('no_salon')
      const headers = await authHeader()
      const res = await fetch(`${FN_URL}/banking-connect`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ salon_id: salonId, ...input }),
      })
      if (!res.ok) throw new Error(`connect ${res.status}: ${await res.text()}`)
      return (await res.json()) as { auth_url: string; connection_id: string }
    },
  })
}

export function useFinishBankConnect(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { code: string; state: string }) => {
      const headers = await authHeader()
      const res = await fetch(`${FN_URL}/banking-callback`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`callback ${res.status}: ${await res.text()}`)
      return (await res.json()) as {
        ok: boolean
        connection_id: string
        accounts_count: number
        bank_name: string | null
        valid_until: string | null
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-connections', salonId] })
    },
  })
}

export function useBankSyncNow(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const headers = await authHeader()
      const res = await fetch(`${FN_URL}/banking-sync`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ connection_id: connectionId }),
      })
      if (!res.ok) throw new Error(`sync ${res.status}: ${await res.text()}`)
      return (await res.json()) as {
        ok: boolean
        accounts_synced: number
        tx_total: number
        tx_new: number
        expenses_created: number
        error?: string
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-connections', salonId] })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
    },
  })
}

export function useBankDisconnect(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const headers = await authHeader()
      const res = await fetch(`${FN_URL}/banking-disconnect`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ connection_id: connectionId }),
      })
      if (!res.ok) throw new Error(`disconnect ${res.status}: ${await res.text()}`)
      return (await res.json()) as { ok: boolean }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-connections', salonId] })
    },
  })
}
