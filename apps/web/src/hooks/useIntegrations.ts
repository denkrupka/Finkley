import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type IntegrationProvider =
  | 'booksy'
  | 'fresha'
  | 'treatwell'
  | 'yclients'
  | 'wfirma'
  | 'fakturownia'
  | 'infakt'
  | 'ksef'

export type SalonIntegrationPublic = {
  id: string
  salon_id: string
  provider: IntegrationProvider
  status: 'connected' | 'error' | 'disconnected'
  last_sync_at: string | null
  last_sync_stats: {
    // Booksy
    staff_synced?: number
    services_synced?: number
    visits_synced?: number
    // wFirma / KSeF / Fakturownia / iFirma / 360Księgowość
    expenses_synced?: number
    expenses_skipped?: number
  } | null
  last_error: string | null
  connected_at: string
  updated_at: string
  sync_interval_minutes: number
}

/** Доступные интервалы авто-синхронизации Booksy (минуты). */
export const BOOKSY_SYNC_INTERVAL_OPTIONS: { value: number; label_key: string }[] = [
  { value: 2, label_key: 'integrations.interval.2min' },
  { value: 5, label_key: 'integrations.interval.5min' },
  { value: 10, label_key: 'integrations.interval.10min' },
  { value: 20, label_key: 'integrations.interval.20min' },
  { value: 30, label_key: 'integrations.interval.30min' },
  { value: 60, label_key: 'integrations.interval.1h' },
  { value: 240, label_key: 'integrations.interval.4h' },
  { value: 720, label_key: 'integrations.interval.12h' },
  { value: 1440, label_key: 'integrations.interval.24h' },
]

type BooksyResponse<T> = {
  ok?: boolean
  error?: string
  reason?: string
  message?: string
} & T

/** Список активных интеграций салона (без credentials). */
export function useSalonIntegrations(salonId: string | undefined) {
  return useQuery<SalonIntegrationPublic[]>({
    queryKey: ['salon-integrations', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('salon_integrations_public')
        .select('*')
        .eq('salon_id', salonId)
      if (error) throw error
      return (data ?? []) as SalonIntegrationPublic[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

function unpack<T>(data: BooksyResponse<T>): T {
  if (!data.ok) {
    // Возвращаем error code (request_blocked / invalid_credentials / rate_limited)
    // — UI сама форматирует через i18n.
    throw new Error(data.error ?? data.message ?? 'unknown_error')
  }
  return data
}

/** Login на Booksy: фронт решил hCaptcha, шлём токен в proxy. */
export function useBooksyLogin(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { email: string; password: string; captchaToken: string }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: {
          action: 'login',
          salon_id: salonId,
          email: input.email,
          password: input.password,
          captcha_token: input.captchaToken,
        },
      })
      if (error) {
        // FunctionsHttpError — пробуем достать тело ответа
        type WithCtx = { context?: { json?: () => Promise<unknown> } }
        const ctx = (error as unknown as WithCtx).context
        if (ctx?.json) {
          try {
            const body = (await ctx.json()) as BooksyResponse<unknown>
            throw new Error(body.error ?? body.message ?? error.message)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr
          }
        }
        throw error
      }
      return unpack(
        data as BooksyResponse<{ business: { id: number; name: string }; account: unknown }>,
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

/** Fallback: юзер ввёл access_token руками (Booksy заблокировал прямой логин). */
export function useBooksyLoginWithToken(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { accessToken: string }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: {
          action: 'login_with_token',
          salon_id: salonId,
          access_token: input.accessToken,
        },
      })
      if (error) {
        type WithCtx = { context?: { json?: () => Promise<unknown> } }
        const ctx = (error as unknown as WithCtx).context
        if (ctx?.json) {
          try {
            const body = (await ctx.json()) as BooksyResponse<unknown>
            throw new Error(body.error ?? body.message ?? error.message)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr
          }
        }
        throw error
      }
      return unpack(
        data as BooksyResponse<{ business: { id: number; name: string }; account: unknown }>,
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

/** Триггер синка Booksy (полный — staff/services/visits). */
export function useBooksySync(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: { action: 'sync', salon_id: salonId },
      })
      if (error) throw error
      const json = data as {
        ok?: boolean
        error?: string
        message?: string
        stats?: { staff_synced: number; services_synced: number; visits_synced: number }
      }
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'sync_failed')
      return json.stats!
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
      qc.invalidateQueries({ queryKey: ['services', salonId] })
      qc.invalidateQueries({ queryKey: ['visits', salonId] })
    },
  })
}

/** Изменить частоту автосинхронизации Booksy (в минутах). */
export function useUpdateBooksyInterval(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (intervalMinutes: number) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: {
          action: 'update_interval',
          salon_id: salonId,
          interval_minutes: intervalMinutes,
        },
      })
      if (error) throw error
      const json = data as { ok?: boolean; error?: string; message?: string }
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'update_failed')
      return intervalMinutes
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

/** Очистить все импортированные визиты (для re-sync с новым форматом). */
export function useClearBooksyVisits(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: { action: 'clear_visits', salon_id: salonId },
      })
      if (error) throw error
      const json = data as { ok?: boolean; deleted?: number; message?: string; error?: string }
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'clear_failed')
      return json.deleted ?? 0
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
      qc.invalidateQueries({ queryKey: ['visits', salonId] })
    },
  })
}

/** Отключить интеграцию (удалить credentials). */
export function useDisconnectIntegration(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (provider: IntegrationProvider) => {
      const { error } = await supabase
        .from('salon_integrations')
        .delete()
        .eq('salon_id', salonId!)
        .eq('provider', provider)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

// =============================================================================
// wFirma (TASK-31): Hybrid X3 connect — auto-login или ручные ключи
// =============================================================================

type WfirmaResponse<T> = {
  ok?: boolean
  error?: string
  details?: string | null
  message?: string
} & T

function unpackWfirma<T>(data: WfirmaResponse<T>): T {
  if (!data.ok) throw new Error(data.error ?? data.message ?? 'unknown_error')
  return data
}

/** X2: подключение через email+password от wfirma.pl. */
export type WfirmaCompanyChoice = { id: string; name: string }
export type WfirmaConnectResult =
  | { kind: 'connected'; company: { id: string; name: string; nip: string } }
  | { kind: 'choose_company'; companies: WfirmaCompanyChoice[] }

export function useWfirmaConnectWithLogin(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<
    WfirmaConnectResult,
    Error,
    { email: string; password: string; selectedCompanyId?: string }
  >({
    mutationFn: async (input) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('wfirma-proxy', {
        body: {
          action: 'connect_with_login',
          salon_id: salonId,
          email: input.email,
          password: input.password,
          ...(input.selectedCompanyId ? { selected_company_id: input.selectedCompanyId } : {}),
        },
      })
      if (error) throw error
      const json = data as WfirmaResponse<{
        company?: { id: string; name: string; nip: string }
        companies?: WfirmaCompanyChoice[]
      }>
      // В аккаунте wFirma несколько фирм — UI должен показать выбор и
      // повторно отправить запрос с selected_company_id.
      if (!json.ok && json.error === 'choose_company' && Array.isArray(json.companies)) {
        return { kind: 'choose_company', companies: json.companies }
      }
      const ok = unpackWfirma(json)
      if (!ok.company) throw new Error('no_company_in_response')
      return { kind: 'connected', company: ok.company }
    },
    onSuccess: (res) => {
      if (res.kind === 'connected') {
        qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
      }
    },
  })
}

/** X1: подключение ручным вводом 3 ключей. */
export function useWfirmaConnectWithCredentials(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { accessKey: string; secretKey: string; companyId: string }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('wfirma-proxy', {
        body: {
          action: 'connect_with_credentials',
          salon_id: salonId,
          access_key: input.accessKey,
          secret_key: input.secretKey,
          company_id: input.companyId,
        },
      })
      if (error) throw error
      return unpackWfirma(
        data as WfirmaResponse<{ company: { id: string; name: string; nip: string } }>,
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

/** Sync wFirma → Finkley (тянет purchase invoices в expenses). */
export function useWfirmaSync(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('wfirma-proxy', {
        body: { action: 'sync', salon_id: salonId },
      })
      if (error) throw error
      const json = data as WfirmaResponse<{
        stats?: { expenses_synced: number; expenses_skipped: number }
      }>
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'sync_failed')
      return json.stats!
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
    },
  })
}

// =============================================================================
// Universal accounting-portal connector + sync (TASK-47..50)
// =============================================================================

export type AccountingProvider = 'fakturownia' | 'infakt'

/**
 * Приоритет источников учёта (см. ADR-013 §D). wFirma первая, потому что у
 * неё больше всего фич (auto-login, NIP-match, KSeF push). inFakt последний
 * (заявка на партнёрский доступ).
 */
const ACCOUNTING_PRIORITY: Array<'wfirma' | AccountingProvider> = [
  'wfirma',
  'fakturownia',
  'infakt',
]

/**
 * Возвращает id первого подключённого accounting-портала по приоритету
 * или null если ни один не подключён. Используется в expenses UI для
 * выбора куда «отправить расход».
 */
export function pickActiveAccountingProvider(
  integrations: Pick<SalonIntegrationPublic, 'provider' | 'status'>[],
): 'wfirma' | AccountingProvider | null {
  for (const p of ACCOUNTING_PRIORITY) {
    if (integrations.some((i) => i.provider === p && i.status === 'connected')) return p
  }
  return null
}

type AnyResponse = {
  ok?: boolean
  error?: string
  message?: string
  details?: string | null
} & Record<string, unknown>

const ACCOUNTING_FUNCTION_NAME: Record<AccountingProvider, string> = {
  fakturownia: 'fakturownia-proxy',
  infakt: 'infakt-proxy',
}

/**
 * Универсальный коннектор для бухгалтерских порталов с api_token-style auth.
 * Принимает произвольный набор полей (зависит от провайдера) и шлёт их в
 * соответствующий <provider>-proxy с action='connect_with_credentials'.
 */
export function useAccountingConnect(
  provider: AccountingProvider | null,
  salonId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: Record<string, string>) => {
      if (!salonId) throw new Error('no salon')
      if (!provider) throw new Error('no provider')
      const fn = ACCOUNTING_FUNCTION_NAME[provider]
      const { data, error } = await supabase.functions.invoke(fn, {
        body: {
          action: 'connect_with_credentials',
          salon_id: salonId,
          ...input,
        },
      })
      if (error) {
        type WithCtx = { context?: { json?: () => Promise<unknown> } }
        const ctx = (error as unknown as WithCtx).context
        if (ctx?.json) {
          try {
            const body = (await ctx.json()) as AnyResponse
            throw new Error(body.error ?? body.message ?? error.message)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr
          }
        }
        throw error
      }
      const json = data as AnyResponse
      if (!json.ok) throw new Error(json.error ?? json.message ?? 'unknown_error')
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

/**
 * Универсальный push одного расхода Finkley → accounting-портал.
 * Mirror'ит wFirma push: auto=true ставит фильтры (наличие чека +
 * совпадение buyer_nip с company_nip портала), auto=false push безусловно.
 */
export type AccountingPushResult =
  | { kind: 'ok'; externalId: string }
  | { kind: 'skipped'; reason: 'no_receipt' | 'no_buyer_nip' | 'nip_mismatch' }
  | { kind: 'already_pushed'; externalId: string }
  | { kind: 'error'; reason: string }

export function useAccountingPushExpense(
  provider: AccountingProvider | null,
  salonId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation<AccountingPushResult, Error, { expenseId: string; auto: boolean }>({
    mutationFn: async ({ expenseId, auto }) => {
      if (!salonId) throw new Error('no salon')
      if (!provider) throw new Error('no provider')
      const fn = ACCOUNTING_FUNCTION_NAME[provider]
      const idKey = `${provider}_id`
      const { data, error } = await supabase.functions.invoke(fn, {
        body: {
          action: 'push_expense',
          salon_id: salonId,
          expense_id: expenseId,
          auto,
        },
      })
      if (error) {
        type WithCtx = { context?: { json?: () => Promise<unknown> } }
        const ctx = (error as unknown as WithCtx).context
        if (ctx?.json) {
          try {
            const body = (await ctx.json()) as AnyResponse & Record<string, string | undefined>
            const existingId = body[idKey]
            if (body.error === 'already_pushed' && typeof existingId === 'string') {
              return { kind: 'already_pushed', externalId: existingId }
            }
            return { kind: 'error', reason: body.error ?? body.message ?? error.message }
          } catch {
            // ignore
          }
        }
        throw error
      }
      const json = data as AnyResponse & Record<string, string | undefined>
      const externalId = json[idKey]
      if (json.ok && typeof externalId === 'string') {
        return { kind: 'ok', externalId }
      }
      if (!json.ok) {
        switch (json.error) {
          case 'skipped_no_receipt':
            return { kind: 'skipped', reason: 'no_receipt' }
          case 'skipped_no_buyer_nip':
            return { kind: 'skipped', reason: 'no_buyer_nip' }
          case 'skipped_nip_mismatch':
            return { kind: 'skipped', reason: 'nip_mismatch' }
          default:
            return { kind: 'error', reason: json.error ?? json.message ?? 'unknown_error' }
        }
      }
      return { kind: 'error', reason: 'unknown' }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
    },
  })
}

/** Универсальный sync для accounting-порталов. */
export function useAccountingSync(
  provider: AccountingProvider | null,
  salonId: string | undefined,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      if (!provider) throw new Error('no provider')
      const fn = ACCOUNTING_FUNCTION_NAME[provider]
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { action: 'sync', salon_id: salonId },
      })
      if (error) throw error
      const json = data as AnyResponse & {
        stats?: { expenses_synced: number; expenses_skipped: number }
      }
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'sync_failed')
      return json.stats ?? { expenses_synced: 0, expenses_skipped: 0 }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
    },
  })
}

// =============================================================================
// KSeF (TASK-46): прямой коннект к госреестру через token из «Mój KSeF»
// =============================================================================

type KsefResponse<T> = {
  ok?: boolean
  error?: string
  details?: string | null
  message?: string
} & T

function unpackKsef<T>(data: KsefResponse<T>): T {
  if (!data.ok) throw new Error(data.error ?? data.message ?? 'unknown_error')
  return data
}

/** Подключить КСеФ через NIP + token из «Mój KSeF». */
export function useKsefConnect(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { nip: string; token: string }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('ksef-proxy', {
        body: {
          action: 'connect_with_token',
          salon_id: salonId,
          nip: input.nip,
          token: input.token,
        },
      })
      if (error) {
        type WithCtx = { context?: { json?: () => Promise<unknown> } }
        const ctx = (error as unknown as WithCtx).context
        if (ctx?.json) {
          try {
            const body = (await ctx.json()) as KsefResponse<unknown>
            throw new Error(body.error ?? body.message ?? error.message)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr
          }
        }
        throw error
      }
      return unpackKsef(data as KsefResponse<{ nip: string }>)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

/** Sync КСеФ → Finkley (тянет входящие фактуры в expenses). */
export function useKsefSync(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('ksef-proxy', {
        body: { action: 'sync', salon_id: salonId },
      })
      if (error) throw error
      const json = data as KsefResponse<{
        stats?: { expenses_synced: number; expenses_skipped: number }
      }>
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'sync_failed')
      return json.stats!
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
    },
  })
}

/**
 * Push одного расхода Finkley → wFirma.
 *
 * `auto: true`  — соответствует логике из бота (см. ADR-012 §"Auto match"):
 *   едж проверяет наличие чека и совпадение buyer_nip с компанией; если что-то
 *   не сходится — возвращает не-ok с явным `error` и не пушит. Используется
 *   при автоматическом пуше после save в форме.
 * `auto: false` — push в любом случае. Кнопка «Отправить вручную» в UI.
 */
export type WfirmaPushResult =
  | { kind: 'ok'; wfirmaId: string }
  | { kind: 'skipped'; reason: 'no_receipt' | 'no_buyer_nip' | 'nip_mismatch' }
  | { kind: 'already_pushed'; wfirmaId: string }
  | { kind: 'error'; reason: string }

export function useWfirmaPushExpense(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<WfirmaPushResult, Error, { expenseId: string; auto: boolean }>({
    mutationFn: async ({ expenseId, auto }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('wfirma-proxy', {
        body: {
          action: 'push_expense',
          salon_id: salonId,
          expense_id: expenseId,
          auto,
        },
      })
      if (error) {
        // FunctionsHttpError — попробуем достать тело ответа (для already_pushed 409)
        type WithCtx = { context?: { json?: () => Promise<unknown> } }
        const ctx = (error as unknown as WithCtx).context
        if (ctx?.json) {
          try {
            const body = (await ctx.json()) as WfirmaResponse<{ wfirma_id?: string }>
            if (body.error === 'already_pushed' && body.wfirma_id) {
              return { kind: 'already_pushed', wfirmaId: body.wfirma_id }
            }
            return { kind: 'error', reason: body.error ?? body.message ?? error.message }
          } catch {
            // ignore
          }
        }
        throw error
      }
      const json = data as WfirmaResponse<{
        wfirma_id?: string
        buyer_nip?: string
        expected_nip?: string
      }>
      if (json.ok && json.wfirma_id) return { kind: 'ok', wfirmaId: json.wfirma_id }
      if (!json.ok) {
        switch (json.error) {
          case 'skipped_no_receipt':
            return { kind: 'skipped', reason: 'no_receipt' }
          case 'skipped_no_buyer_nip':
            return { kind: 'skipped', reason: 'no_buyer_nip' }
          case 'skipped_nip_mismatch':
            return { kind: 'skipped', reason: 'nip_mismatch' }
          default:
            return { kind: 'error', reason: json.error ?? json.message ?? 'unknown_error' }
        }
      }
      return { kind: 'error', reason: 'unknown' }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
    },
  })
}
