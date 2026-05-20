/**
 * booksy-proxy — интеграция с Booksy (PL marketplace бронирования).
 *
 * См. ADR-017: tier-aware full sync + portal-owned жизненный цикл визитов.
 *
 * Tiers:
 *   - visits   (user-interval 2..1440 мин) — /calendar + /appointments + baskets
 *   - clients  (20 мин) — /customers (paginated) + /customers/{id}/bookings (history)
 *   - catalog  (60 мин) — services + staff с фильтром Recepcja/Admin + commission + working_hours + salon opening_hours
 *
 * Anti-overwrite: для catalog/clients синкаемые поля переписываются только если
 * локальное значение совпадает с предыдущим Booksy-значением (хранится в
 * external_snapshot). Если юзер переопределил — Booksy не трогает.
 *
 * Portal-owned визиты: после первого INSERT визит "отрывается" от Booksy.
 * Никаких UPDATE; никаких DELETE из-за пропажи в /calendar.
 *
 * Config-флаги (из онбординга):
 *   booksy_owns_payment_status — если false, все новые визиты создаются как 'pending',
 *     status из Booksy игнорируется.
 *   booksy_can_delete_visits — если true, локальные visits не удаляются никогда
 *     из-за поведения Booksy (уже сейчас так — флаг для UX-объяснения).
 *
 * Actions:
 *   login / login_with_token         — auth-flow (см. ADR-008)
 *   sync                              — мануальный full sync (все 3 tier'а)
 *   cron_sync_one + tiers[]           — cron tick, sync только указанных tier'ов
 *   update_interval                   — частота visits tier
 *   update_config                     — флаги {booksy_owns_payment_status, booksy_can_delete_visits}
 *   create_reservation                — POST /reservations/ блок слота в Booksy
 *   delete_reservation                — удалить ранее созданную нашу резервацию
 *   clear_visits                      — clean re-import всех Booksy-визитов
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { recordSyncResult } from '../_shared/notify.ts'
import { withSentry } from '../_shared/sentry.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const BOOKSY_API = 'https://pl.booksy.com/core/v2/business_api'
const BOOKSY_X_API_KEY = 'frontdesk-76661e2b-25f0-49b4-b33a-9d78957a58e3'
const BOOKSY_X_APP_VERSION = '3.0'
const BOOKSY_X_FINGERPRINT = 'bef920d1-c754-481e-9c13-343690248481'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

// Booksy day_of_week: 0=Sun, 1=Mon, ..., 6=Sat
const DOW_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

// =============================================================================
// Booksy API helpers
// =============================================================================

function booksyHeaders(accessToken?: string, extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'pl',
    'content-type': 'application/json',
    origin: 'https://booksy.com',
    referer: 'https://booksy.com/',
    'user-agent': USER_AGENT,
    'x-api-key': BOOKSY_X_API_KEY,
    'x-app-version': BOOKSY_X_APP_VERSION,
    'x-fingerprint': BOOKSY_X_FINGERPRINT,
    ...(extra ?? {}),
  }
  if (accessToken) h['x-access-token'] = accessToken
  return h
}

type BooksyLoginResponse = {
  access_token: string
  account: { id: number; email: string; first_name: string; last_name: string }
  access_rights?: { access_level: string }
}

type BooksyError = { errors?: { code?: string; message?: string }[] }

function classifyBooksyError(status: number, body: BooksyError): string {
  if (status === 429) return 'rate_limited'
  if (status === 401 || status === 403) {
    const code = body.errors?.[0]?.code
    if (code === 'request_blocked') return 'request_blocked'
    return 'invalid_credentials'
  }
  return 'booksy_error'
}

async function booksyLogin(
  email: string,
  password: string,
  hcaptchaToken: string,
): Promise<
  { ok: true; data: BooksyLoginResponse } | { ok: false; status: number; reason: string }
> {
  const res = await fetch(`${BOOKSY_API}/account/login`, {
    method: 'POST',
    headers: booksyHeaders(undefined, { 'x-hcaptcha-token': hcaptchaToken }),
    body: JSON.stringify({ email, password }),
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {}
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      reason: classifyBooksyError(res.status, parsed as BooksyError),
    }
  }
  return { ok: true, data: parsed as BooksyLoginResponse }
}

async function booksyGet<T = unknown>(
  path: string,
  accessToken: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; reason: string }> {
  const res = await fetch(`${BOOKSY_API}${path}`, { headers: booksyHeaders(accessToken) })
  const text = await res.text()
  if (!res.ok) {
    let parsed: unknown = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      // ignore
    }
    return {
      ok: false,
      status: res.status,
      reason: classifyBooksyError(res.status, parsed as BooksyError),
    }
  }
  return { ok: true, data: JSON.parse(text) as T }
}

// =============================================================================
// Anti-overwrite snapshot helpers (ADR-017 §4)
// =============================================================================

/**
 * Возвращает поле для UPDATE если можно перезаписать:
 *  - первый раз видим snapshot → перезаписываем
 *  - Booksy значение не менялось → не трогаем (но и не перезаписываем)
 *  - локальное == прошлому Booksy → юзер не трогал, перезаписываем
 *  - локальное != прошлому Booksy → юзер переопределил, не трогаем
 * Возвращает undefined если перезаписывать НЕ нужно.
 */
function shouldOverwrite<T>(localValue: T, booksyPrev: T | undefined, booksyNow: T): T | undefined {
  // Сравнение jsonb-объектов делаем через JSON.stringify
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  if (booksyPrev === undefined || booksyPrev === null) return booksyNow
  if (eq(booksyNow, booksyPrev)) return undefined
  if (eq(localValue, booksyPrev)) return booksyNow
  return undefined
}

// =============================================================================
// Booksy data types
// =============================================================================

type ResourceListItem = { id: number; name: string; is_active?: boolean }

type ResourceDetail = {
  id: number
  type: string
  name: string
  active: boolean
  visible: boolean
  visible_on_calendar?: boolean
  description?: string
  position?: string
  staff_email?: string | null
  staff_cell_phone?: string | null
  staff_access_level?: 'staff' | 'manager' | 'reception' | 'owner' | string
  services?: number[]
  working_hours?: { day_of_week: number; hours: { hour_from: string; hour_till: string }[] }[]
  photo?: number | null
  photo_url?: string | null
}

type CommissionResp = {
  commission_defaults?: {
    service_commission_type?: string
    service_commission_rate?: string
    product_commission_type?: string
    product_commission_rate?: string
  }
}

type WorkingHoursResp = {
  resource_id?: number
  working_hours?: { day_of_week: number; hours: { hour_from: string; hour_till: string }[] }[]
  hours_apply_from?: string | null
}

type OpeningHoursResp = {
  opening_hours?: { day_of_week: number; hours: { hour_from: string; hour_till: string }[] }[]
  hours_apply_from?: string | null
}

type CustomersListResp = {
  count: number
  page: number
  per_page: number
  customers: {
    id: number
    first_name?: string | null
    last_name?: string | null
    cell_phone?: string | null
    email?: string | null
    discount?: number
    blacklisted?: boolean
    visit_frequency?: number
    no_shows?: number
    is_user?: boolean
    from_promo?: boolean
    invited?: boolean
    badge?: string | null
    customer_profile?: { birthday?: string | null; full_name?: string | null } | null
  }[]
}

/**
 * Маппинг compact-полей Booksy customer → массив наших tags.
 * Booksy не отдаёт custom tags (#vip_*) на compact-уровне, поэтому собираем
 * только built-in атрибуты как теги — это позволяет фильтровать в портале
 * (например, увидеть всех blacklisted из Booksy). Tag namespace: `booksy:*`.
 */
function deriveBooksyTags(c: CustomersListResp['customers'][number]): string[] {
  const tags: string[] = []
  if (c.blacklisted) tags.push('booksy:blacklisted')
  if (c.from_promo) tags.push('booksy:from_promo')
  if (c.is_user) tags.push('booksy:app_user')
  if ((c.no_shows ?? 0) >= 2) tags.push('booksy:frequent_no_show')
  return tags
}

type CustomerBookingsResp = {
  count: number
  page: number
  per_page: number
  bookings: CustomerBooking[]
}

type CustomerBooking = {
  id: number
  appointment_uid: number
  booked_from: string
  booked_till: string
  booked_from_iso?: string
  status: string
  resources?: { id: number; type: string; name: string }[]
  service?: {
    id: number
    name: string
    variant?: { id: number; price?: number | string; duration?: number; staffers?: number[] }
    staffer_ids?: number[]
  }
  payment_info?: {
    transaction_info?: {
      payment_type_code?: string | null
      total?: string | null
      amount_text?: string | null
      payment_rows?: { amount?: number; payment_type_code?: string }[]
    } | null
  } | null
  total?: string | null
  extra_bookings?: CustomerBooking[]
  combo_children?: CustomerBooking[]
}

// =============================================================================
// Booksy fetch helpers — каталог
// =============================================================================

async function fetchResourceDetail(
  accessToken: string,
  resourceId: number,
): Promise<ResourceDetail | null> {
  const res = await booksyGet<{ resource?: ResourceDetail }>(
    `/me/resources/${resourceId}`,
    accessToken,
  )
  if (!res.ok) {
    console.warn(`resource detail ${resourceId}: ${res.reason}`)
    return null
  }
  return res.data.resource ?? null
}

async function fetchCommission(
  accessToken: string,
  businessId: number,
  resourceId: number,
): Promise<CommissionResp | null> {
  const res = await booksyGet<CommissionResp>(
    `/me/businesses/${businessId}/pos/commissions/resource/${resourceId}`,
    accessToken,
  )
  if (!res.ok) {
    console.warn(`commission ${resourceId}: ${res.reason}`)
    return null
  }
  return res.data
}

async function fetchStaffWorkingHours(
  accessToken: string,
  businessId: number,
  resourceId: number,
): Promise<WorkingHoursResp | null> {
  const res = await booksyGet<WorkingHoursResp>(
    `/me/businesses/${businessId}/shifts/resources/${resourceId}/working_hours`,
    accessToken,
  )
  if (!res.ok) {
    console.warn(`staff working_hours ${resourceId}: ${res.reason}`)
    return null
  }
  return res.data
}

async function fetchSalonOpeningHours(
  accessToken: string,
  businessId: number,
): Promise<OpeningHoursResp | null> {
  const res = await booksyGet<OpeningHoursResp>(
    `/me/businesses/${businessId}/shifts/opening_hours`,
    accessToken,
  )
  if (!res.ok) {
    console.warn(`salon opening_hours: ${res.reason}`)
    return null
  }
  return res.data
}

/**
 * Маппинг Booksy working_hours[] → наш jsonb для staff.weekly_schedule
 * (формат {start, end, off}).
 */
function mapBooksyWorkingHoursToJsonb(
  booksyHours: { day_of_week: number; hours: { hour_from: string; hour_till: string }[] }[],
): Record<string, { start: string; end: string; off: boolean }> {
  const result: Record<string, { start: string; end: string; off: boolean }> = {
    mon: { start: '09:00', end: '19:00', off: true },
    tue: { start: '09:00', end: '19:00', off: true },
    wed: { start: '09:00', end: '19:00', off: true },
    thu: { start: '09:00', end: '19:00', off: true },
    fri: { start: '09:00', end: '19:00', off: true },
    sat: { start: '09:00', end: '19:00', off: true },
    sun: { start: '09:00', end: '19:00', off: true },
  }
  for (const wh of booksyHours ?? []) {
    const key = DOW_TO_KEY[wh.day_of_week]
    const first = wh.hours?.[0]
    if (key && first) {
      result[key] = { start: first.hour_from, end: first.hour_till, off: false }
    }
  }
  return result
}

/**
 * Маппинг Booksy opening_hours[] → наш jsonb для salons.opening_hours
 * (формат {open, close, closed}). См. 20260515000011_salon_hours_holidays.sql.
 * Используем существующее поле — UI SalonHoursCard уже знает этот формат.
 */
function mapBooksyOpeningHoursToJsonb(
  booksyHours: { day_of_week: number; hours: { hour_from: string; hour_till: string }[] }[],
): Record<string, { open?: string; close?: string; closed?: boolean }> {
  const result: Record<string, { open?: string; close?: string; closed?: boolean }> = {
    mon: { closed: true },
    tue: { closed: true },
    wed: { closed: true },
    thu: { closed: true },
    fri: { closed: true },
    sat: { closed: true },
    sun: { closed: true },
  }
  for (const wh of booksyHours ?? []) {
    const key = DOW_TO_KEY[wh.day_of_week]
    const first = wh.hours?.[0]
    if (key && first) {
      result[key] = { open: first.hour_from, close: first.hour_till, closed: false }
    }
  }
  return result
}

/**
 * ADR-017 §13.3: импортируем ВСЕХ людей из Booksy (staff/reception/manager/
 * owner). По запросу владельца — он сам решит, кого деактивировать в
 * портале. Фильтруем только не-людей: type='R' (стулья, кабинеты, оборудование).
 */
function shouldImportAsStaff(detail: ResourceDetail): boolean {
  // Resource type R = ресурс/помещение/оборудование (Krzesło pedicure, Fotel)
  if (detail.type === 'R') return false
  return true
}

// =============================================================================
// Booksy fetch helpers — клиенты
// =============================================================================

async function fetchCustomersPage(
  accessToken: string,
  businessId: number,
  page: number,
  perPage = 100,
): Promise<CustomersListResp | null> {
  const res = await booksyGet<CustomersListResp>(
    `/me/businesses/${businessId}/customers?page=${page}&per_page=${perPage}&compact=true`,
    accessToken,
  )
  if (!res.ok) {
    console.warn(`customers page ${page}: ${res.reason}`)
    return null
  }
  return res.data
}

async function fetchCustomerBookings(
  accessToken: string,
  businessId: number,
  customerId: number,
  state: 'active' | 'inactive',
  page = 1,
  perPage = 50,
): Promise<CustomerBookingsResp | null> {
  const res = await booksyGet<CustomerBookingsResp>(
    `/me/businesses/${businessId}/customers/${customerId}/bookings` +
      `?page=${page}&per_page=${perPage}&inlcude_extra_bookings=true&state=${state}`,
    accessToken,
  )
  if (!res.ok) {
    console.warn(`customer ${customerId} bookings ${state}: ${res.reason}`)
    return null
  }
  return res.data
}

// =============================================================================
// Sync stats type
// =============================================================================

type SyncStats = {
  staff_synced?: number
  staff_filtered_out?: number
  services_synced?: number
  visits_synced?: number
  clients_synced?: number
  history_visits_synced?: number
  salon_hours_synced?: boolean
}

// =============================================================================
// syncCatalog — services + staff + salon hours + commission (hourly)
// =============================================================================

async function syncCatalog(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  businessId: number,
): Promise<SyncStats> {
  const stats: SyncStats = {
    staff_synced: 0,
    staff_filtered_out: 0,
    services_synced: 0,
    salon_hours_synced: false,
  }

  // ── Salon opening hours ──────────────────────────────────────────────
  // Пишем в существующее salons.opening_hours (формат {open, close, closed}),
  // которое читает SalonHoursCard. Snapshot — opening_hours_external_snapshot
  // для anti-overwrite (ADR-017 §4).
  const oh = await fetchSalonOpeningHours(accessToken, businessId)
  if (oh?.opening_hours) {
    const mapped = mapBooksyOpeningHoursToJsonb(oh.opening_hours)
    const rawSnapshot = oh.opening_hours
    const { data: salon } = await admin
      .from('salons')
      .select('opening_hours, opening_hours_external_snapshot')
      .eq('id', salonId)
      .maybeSingle()
    if (salon) {
      const localValue = salon.opening_hours as unknown as Record<
        string,
        { open?: string; close?: string; closed?: boolean }
      > | null
      const prev = salon.opening_hours_external_snapshot as unknown
      const overwrite = shouldOverwrite(localValue, prev as typeof mapped | undefined, mapped)
      const updatePayload: Record<string, unknown> = {
        opening_hours_external_snapshot: rawSnapshot,
      }
      if (overwrite !== undefined) {
        updatePayload.opening_hours = overwrite
      }
      await admin.from('salons').update(updatePayload).eq('id', salonId)
      stats.salon_hours_synced = true
    }
  }

  // ── Services ──────────────────────────────────────────────────────────
  type SvcResp = {
    service_categories?: {
      id: number
      name: string
      services?: { id: number; name: string; price?: { amount?: number }; duration?: number }[]
    }[]
  }
  const svcRes = await booksyGet<SvcResp>(
    `/me/businesses/${businessId}/service_categories`,
    accessToken,
  )
  if (!svcRes.ok) throw new Error(`service_categories_${svcRes.reason}`)

  for (const cat of svcRes.data.service_categories ?? []) {
    for (const s of cat.services ?? []) {
      const extId = String(s.id)
      const priceCents = Math.round((s.price?.amount ?? 0) * 100)
      const booksyNow = { name: s.name, price_cents: priceCents, duration_min: s.duration ?? null }

      let { data: existing } = await admin
        .from('services')
        .select('id, name, default_price_cents, default_duration_min, external_snapshot')
        .eq('salon_id', salonId)
        .eq('external_source', 'booksy')
        .eq('external_id', extId)
        .maybeSingle()
      if (!existing) {
        const { data: byName } = await admin
          .from('services')
          .select('id, name, default_price_cents, default_duration_min, external_snapshot')
          .eq('salon_id', salonId)
          .eq('name', s.name)
          .eq('is_archived', false)
          .is('external_id', null)
          .maybeSingle()
        if (byName) {
          await admin
            .from('services')
            .update({ external_source: 'booksy', external_id: extId })
            .eq('id', byName.id)
          existing = byName
        }
      }

      if (existing) {
        const prev = existing.external_snapshot as
          | { name?: string; price_cents?: number; duration_min?: number | null }
          | null
          | undefined
        const update: Record<string, unknown> = { external_snapshot: booksyNow }
        const nameOverwrite = shouldOverwrite(existing.name, prev?.name, booksyNow.name)
        if (nameOverwrite !== undefined) update.name = nameOverwrite
        const priceOverwrite = shouldOverwrite(
          existing.default_price_cents,
          prev?.price_cents,
          booksyNow.price_cents,
        )
        if (priceOverwrite !== undefined) update.default_price_cents = priceOverwrite
        const durOverwrite = shouldOverwrite(
          existing.default_duration_min,
          prev?.duration_min,
          booksyNow.duration_min,
        )
        if (durOverwrite !== undefined) update.default_duration_min = durOverwrite
        await admin.from('services').update(update).eq('id', existing.id)
      } else {
        await admin.from('services').insert({
          salon_id: salonId,
          name: s.name,
          default_price_cents: priceCents,
          default_duration_min: s.duration ?? null,
          external_source: 'booksy',
          external_id: extId,
          external_snapshot: booksyNow,
        })
        stats.services_synced = (stats.services_synced ?? 0) + 1
      }
    }
  }

  // ── Staff: list → detail → filter → commission + working_hours ────────
  type ResourcesResp = { resources?: ResourceListItem[] }
  const resourcesRes = await booksyGet<ResourcesResp>(
    `/me/businesses/${businessId}/resources`,
    accessToken,
  )
  if (!resourcesRes.ok) throw new Error(`resources_${resourcesRes.reason}`)

  const resourceIds = (resourcesRes.data.resources ?? []).map((r) => r.id)
  // Параллельно тянем detail (max 5 concurrent)
  const details: (ResourceDetail | null)[] = []
  for (let i = 0; i < resourceIds.length; i += 5) {
    const batch = resourceIds.slice(i, i + 5)
    const batchResults = await Promise.all(batch.map((id) => fetchResourceDetail(accessToken, id)))
    details.push(...batchResults)
  }

  for (const detail of details) {
    if (!detail) continue
    const extId = String(detail.id)

    // Лукап существующей записи
    let { data: existing } = await admin
      .from('staff')
      .select(
        'id, full_name, email, avatar_url, payout_percent, retail_payout_percent, weekly_schedule, is_active, external_snapshot, deleted_at',
      )
      .eq('salon_id', salonId)
      .eq('external_source', 'booksy')
      .eq('external_id', extId)
      .maybeSingle()

    // Фильтр: только не-люди (type R — стулья/комнаты)
    if (!shouldImportAsStaff(detail)) {
      stats.staff_filtered_out = (stats.staff_filtered_out ?? 0) + 1
      // Если стул уже был импортирован ранее (до фильтра) — деактивируем,
      // чтобы пропал из календаря и списков. Визиты на нём не трогаем.
      if (existing && existing.is_active) {
        await admin
          .from('staff')
          .update({ is_active: false, visible_on_calendar: false })
          .eq('id', existing.id)
      }
      continue
    }

    // Восстановление: если ранее filtered_out, сбрасываем флаг и активируем.
    // Sync продолжит свою anti-overwrite логику — но is_active=true сейчас
    // нужно форсировать (юзер сказал «импортируй всех»).
    if (existing) {
      const prevSnap = existing.external_snapshot as
        | (Record<string, unknown> & { filtered_out?: boolean })
        | null
      if (prevSnap?.filtered_out === true) {
        const cleanedSnap = { ...prevSnap }
        delete (cleanedSnap as Record<string, unknown>).filtered_out
        await admin
          .from('staff')
          .update({ is_active: detail.active, external_snapshot: cleanedSnap })
          .eq('id', existing.id)
      }
    }

    // Fallback by-name (legacy записи без external_id)
    if (!existing) {
      const { data: byName } = await admin
        .from('staff')
        .select(
          'id, full_name, email, avatar_url, payout_percent, retail_payout_percent, weekly_schedule, is_active, external_snapshot, deleted_at',
        )
        .eq('salon_id', salonId)
        .eq('full_name', detail.name)
        .is('deleted_at', null)
        .is('external_id', null)
        .maybeSingle()
      if (byName) {
        await admin
          .from('staff')
          .update({ external_source: 'booksy', external_id: extId })
          .eq('id', byName.id)
        existing = byName
      }
    }

    // Тянем commission и working_hours (параллельно)
    const [commission, workingHours] = await Promise.all([
      fetchCommission(accessToken, businessId, detail.id),
      fetchStaffWorkingHours(accessToken, businessId, detail.id),
    ])

    // Маппинг commission
    const cd = commission?.commission_defaults
    let booksyServicePct: number | null = null
    let booksyProductPct: number | null = null
    if (cd?.service_commission_type === '%' && cd.service_commission_rate) {
      const n = Number.parseFloat(cd.service_commission_rate)
      if (Number.isFinite(n) && n >= 0 && n <= 100) booksyServicePct = n
    }
    if (cd?.product_commission_type === '%' && cd.product_commission_rate) {
      const n = Number.parseFloat(cd.product_commission_rate)
      if (Number.isFinite(n) && n >= 0 && n <= 100) booksyProductPct = n
    }

    // Маппинг working_hours
    const mappedWeekly = workingHours?.working_hours
      ? mapBooksyWorkingHoursToJsonb(workingHours.working_hours)
      : null

    const booksyNow = {
      name: detail.name,
      email: detail.staff_email ?? null,
      is_active: detail.active,
      payout_percent: booksyServicePct,
      retail_payout_percent: booksyProductPct,
      weekly_schedule: mappedWeekly,
      avatar_url: detail.photo_url ?? null,
    }

    if (existing) {
      const prev = existing.external_snapshot as Partial<typeof booksyNow> | null | undefined
      const update: Record<string, unknown> = { external_snapshot: booksyNow }
      const nameOv = shouldOverwrite(existing.full_name, prev?.name, booksyNow.name)
      if (nameOv !== undefined) update.full_name = nameOv
      const emailOv = shouldOverwrite(existing.email, prev?.email, booksyNow.email)
      if (emailOv !== undefined) update.email = emailOv
      const activeOv = shouldOverwrite(existing.is_active, prev?.is_active, booksyNow.is_active)
      if (activeOv !== undefined) update.is_active = activeOv
      const avatarOv = shouldOverwrite(
        existing.avatar_url as string | null,
        prev?.avatar_url,
        booksyNow.avatar_url,
      )
      if (avatarOv !== undefined) update.avatar_url = avatarOv
      if (booksyNow.payout_percent !== null) {
        const ov = shouldOverwrite(
          existing.payout_percent !== null ? Number(existing.payout_percent) : null,
          prev?.payout_percent,
          booksyNow.payout_percent,
        )
        if (ov !== undefined) update.payout_percent = ov
      }
      if (booksyNow.retail_payout_percent !== null) {
        const ov = shouldOverwrite(
          existing.retail_payout_percent !== null ? Number(existing.retail_payout_percent) : null,
          prev?.retail_payout_percent,
          booksyNow.retail_payout_percent,
        )
        if (ov !== undefined) update.retail_payout_percent = ov
      }
      if (booksyNow.weekly_schedule) {
        const ov = shouldOverwrite(
          existing.weekly_schedule,
          prev?.weekly_schedule,
          booksyNow.weekly_schedule,
        )
        if (ov !== undefined) update.weekly_schedule = ov
      }
      await admin.from('staff').update(update).eq('id', existing.id)
    } else {
      const insert: Record<string, unknown> = {
        salon_id: salonId,
        full_name: detail.name,
        email: booksyNow.email,
        avatar_url: booksyNow.avatar_url,
        payout_scheme: 'percent_revenue',
        payout_percent: booksyNow.payout_percent ?? 40,
        retail_payout_percent: booksyNow.retail_payout_percent,
        is_active: detail.active,
        external_source: 'booksy',
        external_id: extId,
        external_snapshot: booksyNow,
      }
      if (booksyNow.weekly_schedule) insert.weekly_schedule = booksyNow.weekly_schedule
      await admin.from('staff').insert(insert)
      stats.staff_synced = (stats.staff_synced ?? 0) + 1
    }
  }

  return stats
}

// =============================================================================
// syncClients — customers (paginated) + history backfill (20 min tier)
// =============================================================================

async function syncClients(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  businessId: number,
  config: BooksyConfig,
): Promise<SyncStats> {
  const stats: SyncStats = { clients_synced: 0, history_visits_synced: 0 }

  const startTs = Date.now()
  const BUDGET_MS = 50_000

  // Caches для resolve booksy_id → uuid (staff/service)
  const caches = await buildResolveCaches(admin, salonId)
  const existingVisitsExt = await loadExistingVisitExternalIds(admin, salonId)

  // ── Customers paginated ───────────────────────────────────────────────
  let page = 1
  const perPage = 100
  while (Date.now() - startTs < BUDGET_MS) {
    const resp = await fetchCustomersPage(accessToken, businessId, page, perPage)
    if (!resp) break
    if (!resp.customers || resp.customers.length === 0) break

    for (const c of resp.customers) {
      const extId = String(c.id)
      const name =
        c.customer_profile?.full_name?.trim() ||
        [c.first_name, c.last_name].filter(Boolean).join(' ').trim() ||
        c.cell_phone?.trim() ||
        'Booksy client'
      const phone = c.cell_phone?.trim() || null
      const email = c.email?.trim() || null
      const birthday = c.customer_profile?.birthday || null
      const discountPct =
        typeof c.discount === 'number' && c.discount >= 0 && c.discount <= 100 ? c.discount : null

      const derivedTags = deriveBooksyTags(c)
      const booksyNow = {
        name,
        phone,
        email,
        birthday,
        discount_percent: discountPct,
        tags: derivedTags,
      }

      const { data: existing } = await admin
        .from('clients')
        .select('id, name, phone, email, birthday, discount_percent, tags, external_snapshot')
        .eq('salon_id', salonId)
        .eq('external_source', 'booksy')
        .eq('external_id', extId)
        .maybeSingle()

      let clientUuid: string | null = null
      let isNew = false

      if (existing) {
        clientUuid = existing.id
        const prev = existing.external_snapshot as Partial<typeof booksyNow> | null | undefined
        const update: Record<string, unknown> = { external_snapshot: booksyNow }
        const nameOv = shouldOverwrite(existing.name, prev?.name, booksyNow.name)
        if (nameOv !== undefined) update.name = nameOv
        const phoneOv = shouldOverwrite(existing.phone, prev?.phone, booksyNow.phone)
        if (phoneOv !== undefined) update.phone = phoneOv
        const emailOv = shouldOverwrite(existing.email, prev?.email, booksyNow.email)
        if (emailOv !== undefined) update.email = emailOv
        const bdOv = shouldOverwrite(existing.birthday, prev?.birthday, booksyNow.birthday)
        if (bdOv !== undefined) update.birthday = bdOv
        if (discountPct !== null) {
          const dOv = shouldOverwrite(
            existing.discount_percent !== null ? Number(existing.discount_percent) : null,
            prev?.discount_percent,
            booksyNow.discount_percent,
          )
          if (dOv !== undefined) update.discount_percent = dOv
        }
        // Tags — merge: убираем booksy:* из существующих, добавляем актуальные
        // из Booksy. Ручные теги (без booksy: префикса) сохраняем.
        const existingTags = Array.isArray(existing.tags) ? (existing.tags as string[]) : []
        const manualTags = existingTags.filter((t) => !t.startsWith('booksy:'))
        const merged = [...manualTags, ...derivedTags]
        // Применяем только если массив реально поменялся
        if (JSON.stringify(merged.sort()) !== JSON.stringify([...existingTags].sort())) {
          update.tags = merged
        }
        await admin.from('clients').update(update).eq('id', existing.id)
      } else {
        const { data: ins } = await admin
          .from('clients')
          .insert({
            salon_id: salonId,
            name,
            phone,
            email,
            birthday,
            discount_percent: discountPct,
            tags: derivedTags,
            source: 'booksy',
            external_source: 'booksy',
            external_id: extId,
            external_snapshot: booksyNow,
          })
          .select('id')
          .single()
        if (ins) {
          clientUuid = ins.id
          isNew = true
          stats.clients_synced = (stats.clients_synced ?? 0) + 1
        }
      }

      // ── History backfill: только для НОВЫХ клиентов ──
      // Для уже импортированных историю не перетягиваем (тяжёлый запрос,
      // и calendar tier уже подхватит свежие визиты). history_synced=true в
      // external_snapshot — флаг что бэкфилл уже сделан.
      if (clientUuid && (isNew || !existing?.external_snapshot)) {
        if (Date.now() - startTs > BUDGET_MS) break
        const historyAdded = await backfillCustomerHistory(
          admin,
          salonId,
          accessToken,
          businessId,
          c.id,
          clientUuid,
          caches,
          existingVisitsExt,
          config,
        )
        stats.history_visits_synced = (stats.history_visits_synced ?? 0) + historyAdded
        // Помечаем что бэкфилл сделан
        await admin
          .from('clients')
          .update({ external_snapshot: { ...booksyNow, history_synced: true } })
          .eq('id', clientUuid)
      }
    }

    if (resp.customers.length < perPage) break
    if (resp.page * resp.per_page >= resp.count) break
    page++
  }

  return stats
}

/**
 * Импортирует историю визитов клиента из /customers/{id}/bookings.
 * Только state='inactive' (прошлые) — будущие приходят через /calendar tier.
 * Идемпотентно по visits.external_id='subbk:{booking.id}'.
 */
async function backfillCustomerHistory(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  businessId: number,
  customerExtId: number,
  clientUuid: string,
  caches: ResolveCaches,
  existingExt: Set<string>,
  config: BooksyConfig,
): Promise<number> {
  let added = 0
  let page = 1
  const perPage = 50
  // Лимит страниц per-клиента чтобы не закопаться на одном супер-VIP клиенте
  const MAX_PAGES = 5

  while (page <= MAX_PAGES) {
    const resp = await fetchCustomerBookings(
      accessToken,
      businessId,
      customerExtId,
      'inactive',
      page,
      perPage,
    )
    if (!resp || !resp.bookings || resp.bookings.length === 0) break

    for (const b of resp.bookings) {
      added += await insertHistoricalBooking(
        admin,
        salonId,
        b,
        clientUuid,
        caches,
        existingExt,
        config,
      )
      // extra_bookings и combo_children — sub-services того же appointment
      for (const eb of b.extra_bookings ?? []) {
        added += await insertHistoricalBooking(
          admin,
          salonId,
          eb,
          clientUuid,
          caches,
          existingExt,
          config,
        )
      }
    }
    if (resp.bookings.length < perPage) break
    if (resp.page * resp.per_page >= resp.count) break
    page++
  }
  return added
}

async function insertHistoricalBooking(
  admin: SupabaseClient,
  salonId: string,
  b: CustomerBooking,
  clientUuid: string,
  caches: ResolveCaches,
  existingExt: Set<string>,
  config: BooksyConfig,
): Promise<number> {
  const externalId = `subbk:${b.id}`
  if (existingExt.has(externalId)) return 0
  if (!b.booked_from) return 0

  // Status фильтр: cancelled / no_show — не импортируем
  if (b.status === 'X' || b.status === 'N' || b.status === 'C') return 0

  const stafferId = b.resources?.[0]?.id ?? null
  const staffUuid = stafferId ? (caches.staffByExtId.get(String(stafferId)) ?? null) : null
  const svcExtId = b.service?.id
  const svcCached = svcExtId ? caches.serviceByExtId.get(String(svcExtId)) : undefined
  const serviceUuid = svcCached?.id ?? null
  const serviceName = b.service?.name ?? 'Service'

  // Цена: variant.price > basket.total > service default
  let amountCents = 0
  const variantPrice = b.service?.variant?.price
  if (typeof variantPrice === 'number') amountCents = Math.round(variantPrice * 100)
  else if (typeof variantPrice === 'string') {
    const n = Number.parseFloat(variantPrice)
    if (Number.isFinite(n)) amountCents = Math.round(n * 100)
  }
  if (amountCents === 0 && svcCached) amountCents = svcCached.price

  // Payment
  const trx = b.payment_info?.transaction_info
  const isPaid = !!trx && b.status === 'F'
  const paymentMethod = mapPaymentMethod(trx?.payment_type_code ?? null)

  // Статус: если booksy_owns_payment_status=false — всегда pending
  let status: 'paid' | 'pending' = isPaid ? 'paid' : 'pending'
  if (!config.booksy_owns_payment_status) status = 'pending'

  // ISO datetime: booked_from "2024-05-25T17:30" (local) — переведём через timezone_name
  // Booksy выдаёт без TZ, но даты в Booksy всегда в local таймзоне салона.
  // Для PL это Europe/Warsaw. Используем booked_from_iso если есть.
  const visitAtIso = b.booked_from_iso
    ? new Date(b.booked_from_iso).toISOString()
    : new Date(b.booked_from + ':00+02:00').toISOString()

  const { error } = await admin.from('visits').upsert(
    {
      salon_id: salonId,
      staff_id: staffUuid,
      client_id: clientUuid,
      service_id: serviceUuid,
      service_name_snapshot: serviceName,
      visit_at: visitAtIso,
      amount_cents: amountCents,
      tip_cents: 0,
      discount_cents: 0,
      payment_method: paymentMethod,
      status,
      source: 'booksy',
      external_id: externalId,
      group_key: null,
      comment: null,
    },
    { onConflict: 'salon_id,source,external_id', ignoreDuplicates: true },
  )
  if (!error) {
    existingExt.add(externalId)
    return 1
  }
  return 0
}

// =============================================================================
// Caches & visit sync (calendar tier)
// =============================================================================

type ResolveCaches = {
  staffByExtId: Map<string, string>
  serviceByExtId: Map<string, { id: string; price: number }>
  clientByExtId: Map<string, string>
}

type BooksyConfig = {
  booksy_owns_payment_status?: boolean
  booksy_can_delete_visits?: boolean
}

async function buildResolveCaches(admin: SupabaseClient, salonId: string): Promise<ResolveCaches> {
  const caches: ResolveCaches = {
    staffByExtId: new Map(),
    serviceByExtId: new Map(),
    clientByExtId: new Map(),
  }
  const { data: staff } = await admin
    .from('staff')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'booksy')
    .not('external_id', 'is', null)
  for (const s of staff ?? []) {
    if (s.external_id) caches.staffByExtId.set(s.external_id, s.id)
  }
  const { data: services } = await admin
    .from('services')
    .select('id, external_id, default_price_cents')
    .eq('salon_id', salonId)
    .eq('external_source', 'booksy')
    .not('external_id', 'is', null)
  for (const s of services ?? []) {
    if (s.external_id) {
      caches.serviceByExtId.set(s.external_id, {
        id: s.id,
        price: s.default_price_cents ?? 0,
      })
    }
  }
  const { data: clients } = await admin
    .from('clients')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'booksy')
    .not('external_id', 'is', null)
  for (const c of clients ?? []) {
    if (c.external_id) caches.clientByExtId.set(c.external_id, c.id)
  }
  return caches
}

async function loadExistingVisitExternalIds(
  admin: SupabaseClient,
  salonId: string,
): Promise<Set<string>> {
  const { data: existingVisits } = await admin
    .from('visits')
    .select('external_id')
    .eq('salon_id', salonId)
    .eq('source', 'booksy')
    .is('deleted_at', null)
  const set = new Set<string>()
  for (const r of existingVisits ?? []) {
    if (r.external_id) set.add(r.external_id)
  }
  return set
}

function mapPaymentMethod(code?: string | null): 'cash' | 'card' | 'transfer' | 'online' | 'mixed' {
  switch (code) {
    case 'cash':
      return 'cash'
    case 'credit_card':
    case 'tap_to_pay':
    case 'terminal_card':
      return 'card'
    case 'split':
      return 'mixed'
    case 'egift_card':
    case 'blik':
    case 'prepayment':
      return 'online'
    default:
      return 'cash'
  }
}

type CalendarBooking = {
  id: number
  appointment_uid: number
  booked_from: string
  booked_till: string
  status: string
  type: string
  resources?: { id: number }[]
  service?: { id: number; name: string }
  customer?: { id: number; name?: string; phone?: string }
}

type CalendarResp = { bookings?: Record<string, CalendarBooking> }

type AppointmentDetail = {
  appointment: {
    appointment_id: number
    appointment_uid: number
    booked_from: string
    booked_till: string
    status: string
    total_value?: number
    total_discount_amount?: number
    basket_id?: string | null
    payment_info?: {
      transaction_info?: { payment_type_code?: string; total?: string } | null
    }
    subbookings?: {
      id: number
      booked_from: string
      staffer_id?: number | null
      service?: { name?: string; id?: number }
    }[]
    customer: { id: number; mode?: string }
  }
  customer?: {
    customer_profile?: { full_name?: string; cell_phone?: string; email?: string }
  }
}

type BasketItem = { id: string; name_line_1?: string; total?: number }

type BasketResponse = {
  result?: {
    total_elements?: { type: string; amount: { amount: number } }[]
    payments_summary?: { payment_type?: { code?: string } }
    items?: BasketItem[]
  }
}

type DryRunResp = {
  transaction?: {
    rows?: { booking_id?: number | null; total?: number; commission_staffer_id?: number | null }[]
  }
}

async function dryRunForBookings(
  accessToken: string,
  businessId: number,
  bookingIds: number[],
): Promise<DryRunResp | null> {
  const res = await fetch(`${BOOKSY_API}/me/businesses/${businessId}/pos/transactions`, {
    method: 'POST',
    headers: booksyHeaders(accessToken),
    body: JSON.stringify({
      transaction_type: 'P',
      customer_card_id: null,
      payment_rows: [{ mode: 'C' }],
      bookings: bookingIds.map((id) => ({ booking_id: id })),
      travel_fee: null,
      vouchers: [],
      addons: [],
      products: [],
      force_customer: false,
      dry_run: true,
      selected_register_id: null,
      compatibilities: { stripe_terminal: true, square: true, split: true },
    }),
  })
  if (!res.ok) return null
  return (await res.json()) as DryRunResp
}

async function syncVisits(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  businessId: number,
  config: BooksyConfig,
  stats: SyncStats,
): Promise<void> {
  const caches = await buildResolveCaches(admin, salonId)
  const existingExt = await loadExistingVisitExternalIds(admin, salonId)
  stats.visits_synced = stats.visits_synced ?? 0

  const startTs = Date.now()
  const BUDGET_MS = 45_000

  const now = new Date()
  const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
  const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

  const weeks: { start: string; end: string }[] = []
  for (let cursor = new Date(end); cursor >= start; cursor.setDate(cursor.getDate() - 7)) {
    const weekStart = new Date(cursor)
    weekStart.setDate(weekStart.getDate() - 6)
    if (weekStart < start) weekStart.setTime(start.getTime())
    weeks.push({ start: fmtDate(weekStart), end: fmtDate(cursor) })
  }

  const apptDetailCache = new Map<
    number,
    {
      basketItems: BasketItem[]
      paymentMethod: 'cash' | 'card' | 'transfer' | 'online' | 'mixed'
      totalTipCents: number
      totalDiscountCents: number
      profile?: { full_name?: string; cell_phone?: string; email?: string }
    } | null
  >()

  for (const week of weeks) {
    if (Date.now() - startTs > BUDGET_MS) break

    const url =
      `/me/businesses/${businessId}/calendar` +
      `?start_date=${week.start}&end_date=${week.end}` +
      `&include_unconfirmed=true&version=3&resources_per_page=100`
    const calRes = await booksyGet<CalendarResp>(url, accessToken)
    if (!calRes.ok) continue

    const byAppt = new Map<number, CalendarBooking[]>()
    for (const b of Object.values(calRes.data.bookings ?? {})) {
      if (b.status === 'X' || b.status === 'N') continue
      if (!b.appointment_uid) continue
      const arr = byAppt.get(b.appointment_uid) ?? []
      arr.push(b)
      byAppt.set(b.appointment_uid, arr)
    }

    for (const [apptUid, bookings] of byAppt) {
      if (Date.now() - startTs > BUDGET_MS) break

      const allKnown = bookings.every((b) => existingExt.has(`subbk:${b.id}`))
      if (allKnown) continue

      const isPaidBooksy = bookings[0]!.status === 'F'
      const customer = bookings[0]!.customer
      if (!customer?.id) continue

      let detail = apptDetailCache.get(apptUid)
      if (detail === undefined && isPaidBooksy) {
        const detailRes = await booksyGet<AppointmentDetail>(
          `/me/businesses/${businessId}/appointments/${apptUid}/`,
          accessToken,
        )
        if (!detailRes.ok) {
          apptDetailCache.set(apptUid, null)
          detail = null
        } else {
          const a = detailRes.data.appointment
          const profile = detailRes.data.customer?.customer_profile
          let basketItems: BasketItem[] = []
          let paymentMethod: 'cash' | 'card' | 'transfer' | 'online' | 'mixed' = 'cash'
          let totalTipCents = 0
          let totalDiscountCents = 0
          if (a.basket_id) {
            paymentMethod = mapPaymentMethod(a.payment_info?.transaction_info?.payment_type_code)
            totalDiscountCents = Math.round((a.total_discount_amount ?? 0) * 100)
            const basketRes = await booksyGet<BasketResponse>(
              `/me/businesses/${businessId}/payments/baskets/${a.basket_id}`,
              accessToken,
            )
            if (basketRes.ok) {
              basketItems = basketRes.data.result?.items ?? []
              const tips = basketRes.data.result?.total_elements?.find((e) => e.type === 'tips')
              if (tips?.amount?.amount) totalTipCents = tips.amount.amount
            }
          }
          detail = { basketItems, paymentMethod, totalTipCents, totalDiscountCents, profile }
          apptDetailCache.set(apptUid, detail)
        }
      }

      const dryRunByBookingId = new Map<number, number>()
      if (!isPaidBooksy) {
        const needDryRun = bookings.some((b) => {
          const svcId = b.service?.id
          const cached = svcId ? caches.serviceByExtId.get(String(svcId)) : undefined
          return !cached || cached.price === 0
        })
        if (needDryRun) {
          const ids = bookings.map((b) => b.id).filter((id): id is number => !!id)
          const dr = await dryRunForBookings(accessToken, businessId, ids)
          for (const row of dr?.transaction?.rows ?? []) {
            if (typeof row.booking_id === 'number' && typeof row.total === 'number') {
              dryRunByBookingId.set(row.booking_id, Math.round(row.total * 100))
            }
          }
        }
      }

      // Find/create client
      const clientExtId = String(customer.id)
      let clientId = caches.clientByExtId.get(clientExtId) ?? null
      if (!clientId) {
        const profile = detail?.profile
        const name = profile?.full_name?.trim() || customer.name?.trim() || 'Booksy client'
        const phone = profile?.cell_phone?.trim() || customer.phone?.trim() || null
        const email = profile?.email?.trim() || null
        const { data: newClient, error: insErr } = await admin
          .from('clients')
          .insert({
            salon_id: salonId,
            name,
            phone,
            email,
            source: 'booksy',
            external_source: 'booksy',
            external_id: clientExtId,
          })
          .select('id')
          .single()
        if (insErr) console.warn(`client insert ${clientExtId}: ${insErr.message}`)
        if (newClient) {
          clientId = newClient.id
          caches.clientByExtId.set(clientExtId, clientId)
        }
      }

      const groupKey = bookings.length > 1 ? `booksy:appt:${apptUid}` : null

      for (let i = 0; i < bookings.length; i++) {
        const b = bookings[i]!
        const externalId = `subbk:${b.id}`
        if (existingExt.has(externalId)) continue

        const stafferId = b.resources?.[0]?.id ?? null
        const staffId = stafferId ? (caches.staffByExtId.get(String(stafferId)) ?? null) : null
        const svcExtId = b.service?.id
        const svcCached = svcExtId ? caches.serviceByExtId.get(String(svcExtId)) : undefined
        const serviceId = svcCached?.id ?? null
        const serviceName = b.service?.name ?? 'Service'

        let amountCents = 0
        if (isPaidBooksy && detail?.basketItems.length) {
          const item = detail.basketItems.find((it) =>
            (it.name_line_1 ?? '').toLowerCase().startsWith(serviceName.toLowerCase()),
          )
          if (item?.total) amountCents = item.total
        }
        if (amountCents === 0) {
          amountCents = dryRunByBookingId.get(b.id) ?? svcCached?.price ?? 0
        }

        const visitAtIso = new Date(b.booked_from + ':00+02:00').toISOString()
        const isPrimary = i === 0
        const tipForVisit = isPrimary ? (detail?.totalTipCents ?? 0) : 0
        const discountForVisit = isPrimary ? (detail?.totalDiscountCents ?? 0) : 0
        const paymentMethod = detail?.paymentMethod ?? 'cash'

        // ADR-017 §5: если booksy_owns_payment_status=false — ВСЕ новые
        // визиты pending независимо от Booksy status
        let status: 'paid' | 'pending' = isPaidBooksy ? 'paid' : 'pending'
        if (!config.booksy_owns_payment_status) status = 'pending'

        const { error } = await admin.from('visits').upsert(
          {
            salon_id: salonId,
            staff_id: staffId,
            client_id: clientId,
            service_id: serviceId,
            service_name_snapshot: serviceName,
            visit_at: visitAtIso,
            amount_cents: amountCents,
            tip_cents: tipForVisit,
            discount_cents: discountForVisit,
            payment_method: paymentMethod,
            status,
            source: 'booksy',
            external_id: externalId,
            group_key: groupKey,
            comment: null,
          },
          { onConflict: 'salon_id,source,external_id', ignoreDuplicates: true },
        )
        if (!error) {
          existingExt.add(externalId)
          stats.visits_synced! += 1
        }
      }
    }
  }
}

// =============================================================================
// Orchestrator: runs subset of tiers
// =============================================================================

async function runTieredSync(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  businessId: number,
  config: BooksyConfig,
  tiers: ('catalog' | 'clients' | 'visits')[],
): Promise<SyncStats> {
  const stats: SyncStats = {}
  const tierTimestamps: Record<string, string> = {}
  const nowIso = new Date().toISOString()

  if (tiers.includes('catalog')) {
    const r = await syncCatalog(admin, salonId, accessToken, businessId)
    Object.assign(stats, r)
    tierTimestamps.last_catalog_sync_at = nowIso
  }
  if (tiers.includes('clients')) {
    const r = await syncClients(admin, salonId, accessToken, businessId, config)
    Object.assign(stats, r)
    tierTimestamps.last_clients_sync_at = nowIso
  }
  if (tiers.includes('visits')) {
    await syncVisits(admin, salonId, accessToken, businessId, config, stats)
    tierTimestamps.last_sync_at = nowIso
  }

  // Помечаем время каждого выполненного tier'а
  await admin
    .from('salon_integrations')
    .update({ ...tierTimestamps, last_sync_stats: stats })
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')

  return stats
}

// =============================================================================
// Action handlers
// =============================================================================

async function ensureMember(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

async function persistConnection(
  admin: SupabaseClient,
  salonId: string,
  login: BooksyLoginResponse,
  business: { id: number; name: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const credentials = {
    access_token: login.access_token,
    business_id: business.id,
    business_name: business.name,
    account_id: login.account.id,
    account_email: login.account.email,
    access_level: login.access_rights?.access_level,
    last_token_at: new Date().toISOString(),
  }
  // Default config — потом юзер ответит на 2 вопроса в UI и мы обновим
  const { error } = await admin.from('salon_integrations').upsert(
    {
      salon_id: salonId,
      provider: 'booksy',
      status: 'connected',
      credentials,
      config: { booksy_owns_payment_status: true, booksy_can_delete_visits: false },
      last_error: null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'salon_id,provider' },
  )
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

async function handleLogin(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  email: string,
  password: string,
  captchaToken: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  const loginRes = await booksyLogin(email, password, captchaToken)
  if (!loginRes.ok) {
    const httpStatus =
      loginRes.reason === 'rate_limited' ? 429 : loginRes.reason === 'request_blocked' ? 403 : 401
    return jsonResponse(
      { ok: false, error: loginRes.reason, message: `Booksy returned ${loginRes.status}` },
      httpStatus,
    )
  }
  type BusinessesResp = { businesses?: { id: number; name: string }[] }
  const bizRes = await booksyGet<BusinessesResp>('/me/businesses', loginRes.data.access_token)
  if (!bizRes.ok) {
    return jsonResponse({ ok: false, error: 'businesses_fetch_failed', reason: bizRes.reason }, 502)
  }
  const business = bizRes.data.businesses?.[0]
  if (!business) return jsonResponse({ ok: false, error: 'no_businesses_in_account' }, 400)

  const persisted = await persistConnection(admin, salonId, loginRes.data, business)
  if (!persisted.ok) {
    return jsonResponse({ ok: false, error: 'persist_failed', message: persisted.message }, 500)
  }
  return jsonResponse({
    ok: true,
    business: { id: business.id, name: business.name },
    account: { email: loginRes.data.account.email, name: loginRes.data.account.first_name },
  })
}

async function handleLoginWithToken(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  accessToken: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  type BusinessesResp = { businesses?: { id: number; name: string }[] }
  const bizRes = await booksyGet<BusinessesResp>('/me/businesses', accessToken)
  if (!bizRes.ok) {
    return jsonResponse(
      { ok: false, error: 'invalid_token', reason: bizRes.reason, message: 'Token not accepted' },
      401,
    )
  }
  const business = bizRes.data.businesses?.[0]
  if (!business) return jsonResponse({ ok: false, error: 'no_businesses_in_account' }, 400)
  const synthLogin: BooksyLoginResponse = {
    access_token: accessToken,
    account: { id: 0, email: 'manual-token', first_name: 'Manual', last_name: 'Token' },
  }
  const persisted = await persistConnection(admin, salonId, synthLogin, business)
  if (!persisted.ok) {
    return jsonResponse({ ok: false, error: 'persist_failed', message: persisted.message }, 500)
  }
  return jsonResponse({
    ok: true,
    business: { id: business.id, name: business.name },
    account: { email: 'manual-token', name: 'Manual' },
  })
}

async function handleClearVisits(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  const { error, count } = await admin
    .from('visits')
    .delete({ count: 'exact' })
    .eq('salon_id', salonId)
    .eq('source', 'booksy')
  if (error) return jsonResponse({ ok: false, error: 'delete_failed', message: error.message }, 500)
  return jsonResponse({ ok: true, deleted: count ?? 0 })
}

// ── reservation actions ─────────────────────────────────────────────────
// POST /me/businesses/{biz}/reservations/ body:
//   {id:null, reserved_from:"YYYY-MM-DDTHH:MM", reserved_till:"YYYY-MM-DDTHH:MM",
//    resources:[staff_external_id], reason:"...", overbooking:false}
// Response 201: {reservation: {id, reserved_from, reserved_till, resources, reason}}
async function handleCreateReservation(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  input: {
    staff_id_external: string
    start_at: string // ISO (UTC)
    end_at: string
    title: string
    visit_id?: string | null
  },
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  const { data: integration } = await admin
    .from('salon_integrations')
    .select('credentials')
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')
    .eq('status', 'connected')
    .maybeSingle()
  if (!integration) return jsonResponse({ ok: false, error: 'not_connected' }, 404)
  const creds = integration.credentials as { access_token: string; business_id: number }

  // Booksy ожидает datetime в локальной таймзоне САЛОНА без TZ-суффикса:
  // "YYYY-MM-DDTHH:MM". Конвертируем UTC ISO в wall-clock time таймзоны салона
  // через Intl.DateTimeFormat (учитывает DST: летом UTC+2, зимой UTC+1 для PL).
  const { data: salon } = await admin
    .from('salons')
    .select('timezone')
    .eq('id', salonId)
    .maybeSingle()
  const tz = (salon?.timezone as string | undefined) || 'Europe/Warsaw'

  function toBooksyLocal(iso: string): string {
    const d = new Date(iso)
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(d)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
  }

  const staffExt = Number.parseInt(input.staff_id_external, 10)
  if (!Number.isFinite(staffExt)) {
    return jsonResponse({ ok: false, error: 'invalid_staff_external_id' }, 400)
  }

  try {
    const res = await fetch(`${BOOKSY_API}/me/businesses/${creds.business_id}/reservations/`, {
      method: 'POST',
      headers: booksyHeaders(creds.access_token),
      body: JSON.stringify({
        id: null,
        reserved_from: toBooksyLocal(input.start_at),
        reserved_till: toBooksyLocal(input.end_at),
        resources: [staffExt],
        reason: input.title || 'Rezerwacja Finkley',
        overbooking: false,
      }),
    })
    const text = await res.text()
    if (!res.ok) {
      return jsonResponse(
        {
          ok: false,
          error: 'booksy_reservation_failed',
          status: res.status,
          message: text.slice(0, 300),
        },
        502,
      )
    }
    let parsed: { reservation?: { id?: number | string } } = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      // ignore
    }
    const reservationId = parsed.reservation?.id ? String(parsed.reservation.id) : null

    // Если caller передал visit_id — сохраняем reservation_id для последующего delete
    if (reservationId && input.visit_id) {
      await admin
        .from('visits')
        .update({ external_reservation_id: reservationId })
        .eq('id', input.visit_id)
        .eq('salon_id', salonId)
    }
    return jsonResponse({ ok: true, reservation_id: reservationId })
  } catch (e) {
    return jsonResponse(
      {
        ok: false,
        error: 'network_error',
        message: e instanceof Error ? e.message : String(e),
      },
      502,
    )
  }
}

async function handleDeleteReservation(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  reservationId: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  const { data: integration } = await admin
    .from('salon_integrations')
    .select('credentials')
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')
    .eq('status', 'connected')
    .maybeSingle()
  if (!integration) return jsonResponse({ ok: false, error: 'not_connected' }, 404)
  const creds = integration.credentials as { access_token: string; business_id: number }
  try {
    const res = await fetch(
      `${BOOKSY_API}/me/businesses/${creds.business_id}/reservations/${encodeURIComponent(reservationId)}/`,
      { method: 'DELETE', headers: booksyHeaders(creds.access_token) },
    )
    if (!res.ok && res.status !== 404) {
      const txt = await res.text()
      return jsonResponse(
        {
          ok: false,
          error: 'delete_failed',
          status: res.status,
          message: txt.slice(0, 300),
        },
        502,
      )
    }
    return jsonResponse({ ok: true })
  } catch (e) {
    return jsonResponse(
      { ok: false, error: 'network_error', message: e instanceof Error ? e.message : String(e) },
      502,
    )
  }
}

// ── shared sync runners ─────────────────────────────────────────────────

async function runSyncForSalon(
  admin: SupabaseClient,
  salonId: string,
  tiers: ('catalog' | 'clients' | 'visits')[] = ['catalog', 'clients', 'visits'],
): Promise<{ ok: true; stats: SyncStats } | { ok: false; status: number; message: string }> {
  const { data: integration } = await admin
    .from('salon_integrations')
    .select('credentials, config')
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')
    .maybeSingle()
  if (!integration) return { ok: false, status: 404, message: 'not_connected' }

  const creds = integration.credentials as { access_token: string; business_id: number }
  const config = (integration.config as BooksyConfig | null) ?? {}

  let stats: SyncStats
  try {
    stats = await runTieredSync(
      admin,
      salonId,
      creds.access_token,
      creds.business_id,
      config,
      tiers,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const { data: salonRow } = await admin
      .from('salons')
      .select('name')
      .eq('id', salonId)
      .maybeSingle()
    await recordSyncResult(admin, {
      salonId,
      provider: 'booksy',
      ok: false,
      errorMessage: msg,
      salonName: (salonRow as { name?: string } | null)?.name ?? null,
    })
    return { ok: false, status: 502, message: msg }
  }

  await recordSyncResult(admin, { salonId, provider: 'booksy', ok: true })
  await admin
    .from('salon_integrations')
    .update({ status: 'connected' })
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')

  return { ok: true, stats }
}

async function handleSync(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  // Manual sync — все 3 tier'а
  const res = await runSyncForSalon(admin, salonId, ['catalog', 'clients', 'visits'])
  if (!res.ok) {
    return jsonResponse({ ok: false, error: 'sync_failed', message: res.message }, res.status)
  }
  return jsonResponse({ ok: true, stats: res.stats })
}

async function handleCronSyncOne(
  admin: SupabaseClient,
  salonId: string,
  token: string,
  tiers: ('catalog' | 'clients' | 'visits')[],
): Promise<Response> {
  const { data: trig, error: trigErr } = await admin
    .from('booksy_sync_triggers')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .eq('salon_id', salonId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('token')
    .maybeSingle()
  if (trigErr || !trig) {
    return jsonResponse({ ok: false, error: 'invalid_or_expired_token' }, 401)
  }
  const safeTiers = tiers.filter((t) => t === 'catalog' || t === 'clients' || t === 'visits')
  const useTiers = safeTiers.length ? safeTiers : (['visits'] as const)
  const res = await runSyncForSalon(admin, salonId, [...useTiers])
  if (!res.ok) {
    return jsonResponse({ ok: false, error: 'sync_failed', message: res.message }, res.status)
  }
  return jsonResponse({ ok: true, stats: res.stats })
}

async function handleUpdateInterval(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  intervalMinutes: number,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 2 || intervalMinutes > 1440) {
    return jsonResponse({ ok: false, error: 'invalid_interval' }, 400)
  }
  const { error } = await admin
    .from('salon_integrations')
    .update({ sync_interval_minutes: intervalMinutes })
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')
  if (error) return jsonResponse({ ok: false, error: 'update_failed', message: error.message }, 500)
  return jsonResponse({ ok: true })
}

async function handleUpdateConfig(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  patch: Partial<BooksyConfig>,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  // Получаем текущий config, мерджим
  const { data: current } = await admin
    .from('salon_integrations')
    .select('config')
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')
    .maybeSingle()
  if (!current) return jsonResponse({ ok: false, error: 'not_connected' }, 404)
  const merged = {
    ...((current.config as BooksyConfig | null) ?? {}),
    ...patch,
  }
  const { error } = await admin
    .from('salon_integrations')
    .update({ config: merged })
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')
  if (error) return jsonResponse({ ok: false, error: 'update_failed', message: error.message }, 500)
  return jsonResponse({ ok: true, config: merged })
}

// =============================================================================
// Entry
// =============================================================================

Deno.serve(
  withSentry('booksy-proxy', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
    }

    let body: {
      action?: string
      salon_id?: string
      email?: string
      password?: string
      captcha_token?: string
      access_token?: string
      token?: string
      interval_minutes?: number
      tiers?: ('catalog' | 'clients' | 'visits')[]
      booksy_owns_payment_status?: boolean
      booksy_can_delete_visits?: boolean
      staff_id_external?: string
      start_at?: string
      end_at?: string
      title?: string
      visit_id?: string | null
      reservation_id?: string
    }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ ok: false, error: 'bad_request' }, 400)
    }

    if (!body.salon_id) return jsonResponse({ ok: false, error: 'salon_id_required' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Cron action: rendezvous-token, без user JWT
    if (body.action === 'cron_sync_one') {
      if (!body.token) return jsonResponse({ ok: false, error: 'token_required' }, 400)
      return handleCronSyncOne(admin, body.salon_id, body.token, body.tiers ?? ['visits'])
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }
    const userJwt = authHeader.slice('Bearer '.length)
    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    })
    const { data: userRes, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userRes?.user) {
      return jsonResponse({ ok: false, error: 'invalid_token', message: userErr?.message }, 401)
    }
    const userId = userRes.user.id

    switch (body.action) {
      case 'login':
        if (!body.email || !body.password || !body.captcha_token) {
          return jsonResponse({ ok: false, error: 'email_password_captcha_required' }, 400)
        }
        return handleLogin(
          admin,
          userId,
          body.salon_id,
          body.email,
          body.password,
          body.captcha_token,
        )
      case 'login_with_token':
        if (!body.access_token) {
          return jsonResponse({ ok: false, error: 'access_token_required' }, 400)
        }
        return handleLoginWithToken(admin, userId, body.salon_id, body.access_token)
      case 'sync':
        return handleSync(admin, userId, body.salon_id)
      case 'clear_visits':
        return handleClearVisits(admin, userId, body.salon_id)
      case 'update_interval':
        if (typeof body.interval_minutes !== 'number') {
          return jsonResponse({ ok: false, error: 'interval_minutes_required' }, 400)
        }
        return handleUpdateInterval(admin, userId, body.salon_id, body.interval_minutes)
      case 'update_config': {
        const patch: Partial<BooksyConfig> = {}
        if (typeof body.booksy_owns_payment_status === 'boolean')
          patch.booksy_owns_payment_status = body.booksy_owns_payment_status
        if (typeof body.booksy_can_delete_visits === 'boolean')
          patch.booksy_can_delete_visits = body.booksy_can_delete_visits
        if (Object.keys(patch).length === 0) {
          return jsonResponse({ ok: false, error: 'no_config_fields' }, 400)
        }
        return handleUpdateConfig(admin, userId, body.salon_id, patch)
      }
      case 'create_reservation':
        if (
          !body.staff_id_external ||
          !body.start_at ||
          !body.end_at ||
          typeof body.title !== 'string'
        ) {
          return jsonResponse({ ok: false, error: 'reservation_fields_required' }, 400)
        }
        return handleCreateReservation(admin, userId, body.salon_id, {
          staff_id_external: body.staff_id_external,
          start_at: body.start_at,
          end_at: body.end_at,
          title: body.title,
          visit_id: body.visit_id ?? null,
        })
      case 'delete_reservation':
        if (!body.reservation_id) {
          return jsonResponse({ ok: false, error: 'reservation_id_required' }, 400)
        }
        return handleDeleteReservation(admin, userId, body.salon_id, body.reservation_id)
      default:
        return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
    }
  }),
)
