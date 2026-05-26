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
  /** Период авто-синка в минутах. Range 60..1440, default 360 (6h). */
  sync_interval_minutes: number
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
  linked_visit_id: string | null
  linked_other_income_id: string | null
  needs_review: boolean
}

export type BankInflowRow = BankTransactionRow & {
  bank_name: string | null
  account_iban: string | null
}

export type BankOutflowRow = BankTransactionRow & {
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
          linked_visit_id: r.linked_visit_id,
          linked_other_income_id: r.linked_other_income_id,
          needs_review: r.needs_review,
          bank_name: conn?.bank_name ?? conn?.bank_aspsp_name ?? null,
          account_iban: account?.iban ?? null,
        }
      })
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

/**
 * Debit-транзакции (списания) для салона за период. Аналог useBankInflows
 * но `type='debit'`. Используется на странице Расходы → таб Банкинг.
 */
export function useBankOutflows(
  salonId: string | undefined,
  period: { start: string; end: string },
) {
  return useQuery<BankOutflowRow[]>({
    queryKey: ['bank-outflows', salonId, period],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('bank_transactions')
        .select(
          `id, account_id, external_id, type, amount_cents, currency, description,
           counterparty, executed_at, expense_id, linked_visit_id, linked_other_income_id,
           needs_review,
           bank_accounts!inner (
             iban,
             bank_connections!inner (
               salon_id, bank_name, bank_aspsp_name
             )
           )`,
        )
        .eq('type', 'debit')
        .eq('bank_accounts.bank_connections.salon_id', salonId)
        .gte('executed_at', period.start)
        .lt('executed_at', period.end)
        .order('executed_at', { ascending: false })
        .limit(500)
      if (error) throw error
      type Joined = BankTransactionRow & {
        bank_accounts?: Array<{
          iban: string | null
          bank_connections?: Array<{
            bank_name: string | null
            bank_aspsp_name: string | null
          }> | null
        }> | null
      }
      return ((data ?? []) as unknown as Joined[]).map((r): BankOutflowRow => {
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
          linked_visit_id: r.linked_visit_id,
          linked_other_income_id: r.linked_other_income_id,
          needs_review: r.needs_review,
          bank_name: conn?.bank_name ?? conn?.bank_aspsp_name ?? null,
          account_iban: account?.iban ?? null,
        }
      })
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

/**
 * Прикрепить транзакцию к расходу/визиту/прочему доходу. Передавайте только
 * одну из ссылок — БД-constraint chk_bank_tx_single_link не пустит конфликт.
 * Передача null'ов = отвязать.
 */
export function useLinkBankTransaction(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: {
      transactionId: string
      expenseId?: string | null
      visitId?: string | null
      otherIncomeId?: string | null
      clearNeedsReview?: boolean
    }) => {
      const patch: Record<string, unknown> = {}
      // Если задана связь любого типа — автоматически сбрасываем остальные два
      // FK. Иначе chk_bank_tx_single_link constraint падает на переключении
      // (например visit → other_income: visit_id остаётся со старой связью).
      // Юзер передаёт только новую связь — мы дополняем patch nullами для
      // остальных, кроме случая «отвязка вообще» (всё передано как null).
      const anyLinkSet =
        (args.expenseId !== undefined && args.expenseId !== null) ||
        (args.visitId !== undefined && args.visitId !== null) ||
        (args.otherIncomeId !== undefined && args.otherIncomeId !== null)
      if (anyLinkSet) {
        patch.expense_id = args.expenseId ?? null
        patch.linked_visit_id = args.visitId ?? null
        patch.linked_other_income_id = args.otherIncomeId ?? null
      } else {
        // explicit unlink — все три ключа сбрасываются
        if (args.expenseId !== undefined) patch.expense_id = null
        if (args.visitId !== undefined) patch.linked_visit_id = null
        if (args.otherIncomeId !== undefined) patch.linked_other_income_id = null
      }
      if (args.clearNeedsReview) patch.needs_review = false
      const { error } = await supabase
        .from('bank_transactions')
        .update(patch)
        .eq('id', args.transactionId)
      // PostgrestError — не Error-instance; оборачиваем чтобы получить
      // нормальный .message (без [object Object] в toast.error).
      if (error) throw new Error(error.message || 'Failed to link transaction')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-inflows', salonId] })
      qc.invalidateQueries({ queryKey: ['bank-outflows', salonId] })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
      qc.invalidateQueries({ queryKey: ['visits', salonId] })
      qc.invalidateQueries({ queryKey: ['bank-linked-income-ids', salonId] })
    },
  })
}

/**
 * Идентификаторы расходов/визитов/other_incomes этого салона, которые
 * привязаны к банковским транзакциям + те же id, у которых linked tx
 * стоит в needs_review (требует ручной проверки оператора).
 *
 * Используется в ExpensesPage / VisitsPage / SalesTab для двух маркеров:
 *   1) «Банк» — оплата подтверждена выпиской
 *   2) AlertTriangle — авто-матч низкой уверенности, надо подтвердить
 *
 * Не фильтруем по периоду: связанных txs на салон обычно немного, а юзер
 * может смотреть произвольный месяц. RLS уже ограничивает выборку салоном
 * через bank_accounts → bank_connections.
 */
export type BankLinkedIncomeIds = {
  visitIds: Set<string>
  otherIncomeIds: Set<string>
  expenseIds: Set<string>
  needsReviewVisitIds: Set<string>
  needsReviewOtherIncomeIds: Set<string>
  needsReviewExpenseIds: Set<string>
}

export function useBankLinkedIncomeIds(salonId: string | undefined) {
  return useQuery<BankLinkedIncomeIds>({
    queryKey: ['bank-linked-income-ids', salonId],
    queryFn: async () => {
      const empty: BankLinkedIncomeIds = {
        visitIds: new Set(),
        otherIncomeIds: new Set(),
        expenseIds: new Set(),
        needsReviewVisitIds: new Set(),
        needsReviewOtherIncomeIds: new Set(),
        needsReviewExpenseIds: new Set(),
      }
      if (!salonId) return empty
      const { data, error } = await supabase
        .from('bank_transactions')
        .select(
          `expense_id, linked_visit_id, linked_other_income_id, needs_review,
           bank_accounts!inner (
             bank_connections!inner ( salon_id )
           )`,
        )
        .eq('bank_accounts.bank_connections.salon_id', salonId)
        .or('expense_id.not.is.null,linked_visit_id.not.is.null,linked_other_income_id.not.is.null')
        .limit(2000)
      if (error) throw error
      const result: BankLinkedIncomeIds = {
        visitIds: new Set(),
        otherIncomeIds: new Set(),
        expenseIds: new Set(),
        needsReviewVisitIds: new Set(),
        needsReviewOtherIncomeIds: new Set(),
        needsReviewExpenseIds: new Set(),
      }
      for (const r of (data ?? []) as Array<{
        expense_id: string | null
        linked_visit_id: string | null
        linked_other_income_id: string | null
        needs_review: boolean | null
      }>) {
        if (r.expense_id) result.expenseIds.add(r.expense_id)
        if (r.linked_visit_id) result.visitIds.add(r.linked_visit_id)
        if (r.linked_other_income_id) result.otherIncomeIds.add(r.linked_other_income_id)
        if (r.needs_review) {
          if (r.expense_id) result.needsReviewExpenseIds.add(r.expense_id)
          if (r.linked_visit_id) result.needsReviewVisitIds.add(r.linked_visit_id)
          if (r.linked_other_income_id)
            result.needsReviewOtherIncomeIds.add(r.linked_other_income_id)
        }
      }
      return result
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
      qc.invalidateQueries({ queryKey: ['visits', salonId] })
      qc.invalidateQueries({ queryKey: ['bank-inflows', salonId] })
      qc.invalidateQueries({ queryKey: ['bank-outflows', salonId] })
      qc.invalidateQueries({ queryKey: ['bank-linked-income-ids', salonId] })
    },
  })
}

/**
 * Изменить per-connection частоту авто-синка. Записывает напрямую в
 * bank_connections через anon-key (RLS пропускает owner'а салона). После
 * успеха next cron-tick (каждые 15 минут) увидит обновлённый interval.
 */
export function useUpdateBankSyncInterval(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { connectionId: string; intervalMinutes: number }) => {
      const { error } = await supabase
        .from('bank_connections')
        .update({ sync_interval_minutes: args.intervalMinutes })
        .eq('id', args.connectionId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-connections', salonId] })
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
