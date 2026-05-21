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
  visits_deleted?: number
  reservations_synced?: number
  reservations_deleted?: number
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
  const existingVisitsExt = new Set((await loadExistingVisits(admin, salonId)).keys())

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

  // duration_min из booked_till - booked_from. Без этого карточка визита
  // рендерится по services.default_duration_min или fallback 60 мин — у нас
  // получался разнотык с Booksy (Manicure 2h vs 1h в портале).
  const durationMin = computeDurationMin(b.booked_from, b.booked_till)

  const { error } = await admin.from('visits').upsert(
    {
      salon_id: salonId,
      staff_id: staffUuid,
      client_id: clientUuid,
      service_id: serviceUuid,
      service_name_snapshot: serviceName,
      visit_at: visitAtIso,
      duration_min: durationMin,
      amount_cents: amountCents,
      tip_cents: 0,
      discount_cents: 0,
      payment_method: paymentMethod,
      status,
      source: 'booksy',
      external_id: externalId,
      external_reservation_id: b.appointment_uid ? String(b.appointment_uid) : null,
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

type ExistingVisitInfo = { id: string; duration_min: number | null }

async function loadExistingVisits(
  admin: SupabaseClient,
  salonId: string,
): Promise<Map<string, ExistingVisitInfo>> {
  const { data: existingVisits } = await admin
    .from('visits')
    .select('id, external_id, duration_min')
    .eq('salon_id', salonId)
    .eq('source', 'booksy')
    .is('deleted_at', null)
  const map = new Map<string, ExistingVisitInfo>()
  for (const r of existingVisits ?? []) {
    if (r.external_id) map.set(r.external_id, { id: r.id, duration_min: r.duration_min })
  }
  return map
}

/**
 * Длительность визита/резервации в минутах из Booksy "YYYY-MM-DDTHH:MM" пары.
 * Используем фиксированный +00:00 для обоих концов — реальный смещение TZ
 * салона сокращается при вычитании, поэтому конкретное значение не важно.
 */
function computeDurationMin(from?: string | null, till?: string | null): number | null {
  if (!from || !till) return null
  const fromMs = new Date(`${from}:00+00:00`).getTime()
  const tillMs = new Date(`${till}:00+00:00`).getTime()
  if (!Number.isFinite(fromMs) || !Number.isFinite(tillMs) || tillMs <= fromMs) return null
  return Math.round((tillMs - fromMs) / 60_000)
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

type CalendarReservationRaw = {
  id?: number | string
  appointment_uid?: number | string
  reserved_from?: string
  reserved_till?: string
  booked_from?: string
  booked_till?: string
  resources?: (number | { id?: number })[]
  reason?: string | null
  description?: string | null
  type?: string
  status?: string // 'A' active, 'C' cancelled, 'X' no-show
}

type CalendarResp = {
  bookings?: Record<string, CalendarBooking>
  reservations?: Record<string, CalendarReservationRaw> | CalendarReservationRaw[]
}

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
  opts?: { rangeStart?: Date; rangeEnd?: Date },
): Promise<void> {
  const caches = await buildResolveCaches(admin, salonId)
  const existingByExt = await loadExistingVisits(admin, salonId)
  const existingExt = new Set(existingByExt.keys())
  stats.visits_synced = stats.visits_synced ?? 0

  // Маппинг payment_method → cash_register_id из financial_settings.cash_registers.
  // Юзер настраивает в Settings → Кассы → колонка «Маппинг оплаты». Если
  // визит из Booksy оплачен наличными — пишем в кассу с маппингом cash.
  const { data: salonForMapping } = await admin
    .from('salons')
    .select('financial_settings')
    .eq('id', salonId)
    .maybeSingle()
  const cashRegisterByMethod: Record<string, string> = {}
  type FinCashItem = {
    id?: string
    archived?: boolean
    payment_method_mapping?: string | null
  }
  const finSettings =
    (salonForMapping?.financial_settings as {
      cash_registers?: { items?: FinCashItem[] }
    } | null) ?? null
  for (const item of finSettings?.cash_registers?.items ?? []) {
    if (item.archived) continue
    if (item.payment_method_mapping && item.id) {
      cashRegisterByMethod[item.payment_method_mapping] = item.id
    }
  }
  const cashRegisterFor = (method: string | null | undefined): string | null =>
    method ? (cashRegisterByMethod[method] ?? null) : null

  // Бэкфилл duration_min для уже импортированных booksy-визитов: до этого
  // изменения duration_min не записывался (UI рендерил по services.default).
  // Заполняем сейчас по (booked_till - booked_from). См. ADR-017 §3 —
  // portal-owned трогает только NULL, ручные правки duration остаются.
  const durationPatches: { id: string; duration_min: number }[] = []

  // Резервы времени мастеров («Rezerwacja czasu») приезжают в том же
  // /calendar ответе под ключом `reservations`. Копим за все недели,
  // дедуплицируем по id и upsert'им в staff_time_blocks одним проходом.
  const reservationsByExtId = new Map<string, CalendarReservationRaw>()

  // Reverse-delete: что мы реально увидели в Booksy за этот sync. Всё, что
  // есть в портале с source='booksy', но НЕ в этих сетах — удалено в Booksy.
  // Чтобы не false-positive из-за частичного syn (budget timeout) — отдельно
  // храним диапазон фактически опрошенных дней.
  const seenVisitExtIds = new Set<string>()
  const seenReservationBooksyIds = new Set<string>()
  const fetchedRange: { start: Date | null; end: Date | null } = { start: null, end: null }

  const startTs = Date.now()
  const BUDGET_MS = 45_000

  const now = new Date()
  // Если opts задан (day-sync) — узкое окно. Иначе ±60 дней (полный sync).
  const start = opts?.rangeStart ?? new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
  const end = opts?.rangeEnd ?? new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

  const weeks: { start: string; end: string }[] = []
  if (opts?.rangeStart && opts?.rangeEnd) {
    // Day/narrow-range mode: один диапазон, без разбивки на недели.
    weeks.push({ start: fmtDate(start), end: fmtDate(end) })
  } else {
    for (let cursor = new Date(end); cursor >= start; cursor.setDate(cursor.getDate() - 7)) {
      const weekStart = new Date(cursor)
      weekStart.setDate(weekStart.getDate() - 6)
      if (weekStart < start) weekStart.setTime(start.getTime())
      weeks.push({ start: fmtDate(weekStart), end: fmtDate(cursor) })
    }
  }

  const apptDetailCache = new Map<
    number,
    {
      basketItems: BasketItem[]
      paymentMethod: 'cash' | 'card' | 'transfer' | 'online' | 'mixed'
      totalTipCents: number
      totalDiscountCents: number
      profile?: { full_name?: string; cell_phone?: string; email?: string }
      hasBasket: boolean
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

    // Запоминаем что эта неделя успешно опрошена — для reverse-delete окна.
    const weekStartDate = new Date(`${week.start}T00:00:00Z`)
    const weekEndDate = new Date(`${week.end}T23:59:59Z`)
    if (!fetchedRange.start || weekStartDate < fetchedRange.start)
      fetchedRange.start = weekStartDate
    if (!fetchedRange.end || weekEndDate > fetchedRange.end) fetchedRange.end = weekEndDate

    // Резервы из этого же ответа
    const weekReservations = Array.isArray(calRes.data.reservations)
      ? calRes.data.reservations
      : Object.values(calRes.data.reservations ?? {})
    for (const r of weekReservations) {
      const apptUid = r?.appointment_uid ?? r?.id
      if (apptUid !== undefined && apptUid !== null) {
        reservationsByExtId.set(String(apptUid), r)
        // В seen — оба ключа: appointment_uid (новый формат) и id (legacy),
        // чтобы reverse-delete не сносил старые блоки, у которых external_id
        // ещё содержит reservation.id вместо uid.
        seenReservationBooksyIds.add(String(apptUid))
        if (r?.id !== undefined && r.id !== null) seenReservationBooksyIds.add(String(r.id))
      }
    }

    const byAppt = new Map<number, CalendarBooking[]>()
    for (const b of Object.values(calRes.data.bookings ?? {})) {
      if (b.status === 'X' || b.status === 'N') continue
      if (!b.appointment_uid) continue
      seenVisitExtIds.add(`subbk:${b.id}`)
      const arr = byAppt.get(b.appointment_uid) ?? []
      arr.push(b)
      byAppt.set(b.appointment_uid, arr)
    }

    for (const [apptUid, bookings] of byAppt) {
      if (Date.now() - startTs > BUDGET_MS) break

      // Для известных бронирований с NULL duration_min копим бэкфилл-патчи.
      for (const b of bookings) {
        const ext = `subbk:${b.id}`
        const existing = existingByExt.get(ext)
        if (existing && existing.duration_min === null) {
          const d = computeDurationMin(b.booked_from, b.booked_till)
          if (d !== null) {
            durationPatches.push({ id: existing.id, duration_min: d })
            existing.duration_min = d
          }
        }
      }

      const allKnown = bookings.every((b) => existingExt.has(`subbk:${b.id}`))
      if (allKnown) continue

      // ВНИМАНИЕ: Booksy status='F' (Finalized) НЕ означает «оплачен».
      // Это значит «визит закрыт» (услуга оказана). Реальная оплата
      // определяется наличием basket_id у appointment + payable=false.
      // Денежные кейсы:
      //   - paid: status='F' && basket_id IS NOT NULL && payable=false
      //   - finalized-but-unpaid: status='F' && basket_id IS NULL (ZAKOŃCZONE
      //     в Booksy UI с кнопкой ROZLICZ)
      //   - upcoming: status='A' (Active/booked)
      // Поэтому isClosedBooksy используем для fetch'а detail, а
      // isPaidBooksy уточняется ПОСЛЕ fetch'а через basket_id.
      const isClosedBooksy = bookings[0]!.status === 'F'
      const customer = bookings[0]!.customer
      if (!customer?.id) continue

      let detail = apptDetailCache.get(apptUid)
      if (detail === undefined && isClosedBooksy) {
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
          const hasBasket = !!a.basket_id
          if (hasBasket) {
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
          detail = {
            basketItems,
            paymentMethod,
            totalTipCents,
            totalDiscountCents,
            profile,
            hasBasket,
          }
          apptDetailCache.set(apptUid, detail)
        }
      }

      // Реальный paid-флаг: статус F И есть basket в Booksy.
      const isPaidBooksy = isClosedBooksy && !!detail?.hasBasket

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
        const durationMin = computeDurationMin(b.booked_from, b.booked_till)
        const isPrimary = i === 0
        const tipForVisit = isPrimary ? (detail?.totalTipCents ?? 0) : 0
        const discountForVisit = isPrimary ? (detail?.totalDiscountCents ?? 0) : 0
        const paymentMethod = detail?.paymentMethod ?? 'cash'

        // ADR-017 §5: если booksy_owns_payment_status=false — ВСЕ новые
        // визиты pending независимо от Booksy status
        let status: 'paid' | 'pending' = isPaidBooksy ? 'paid' : 'pending'
        if (!config.booksy_owns_payment_status) status = 'pending'

        // Bug 1: visit moved in Booksy → portal не обновлялся (upsert
        // ignoreDuplicates пропускал). Bug 1b: после reverse-delete визит
        // оставался soft-deleted, новое появление в Booksy не восстанавливало.
        // Решение: явная ветка update vs insert. Money-поля
        // (amount/tip/discount/status/payment_method) НЕ обновляем —
        // ручные правки в портале сохраняем (ADR-017 portal-owned).
        // Bug 2: external_reservation_id = appointment_uid сохраняем чтоб
        // delete визита в портале мог снять appointment в Booksy.
        const existing = existingByExt.get(externalId)
        if (existing) {
          const updatePatch: Record<string, unknown> = {
            staff_id: staffId,
            service_id: serviceId,
            service_name_snapshot: serviceName,
            visit_at: visitAtIso,
            duration_min: durationMin,
            external_reservation_id: String(apptUid),
            deleted_at: null,
            group_key: groupKey,
          }
          // Upgrade pending → paid когда Booksy теперь показывает оплату
          // (basket появился). Обратное (paid → pending) НЕ делаем — это
          // могло быть ручное «Рассчитать» в портале, не хотим терять.
          if (isPaidBooksy && existing.duration_min !== null) {
            // existing.duration_min проксирует существование объекта; используем
            // отдельный fetch чтобы получить status (см. loadExistingVisits)
          }
          if (isPaidBooksy && config.booksy_owns_payment_status !== false) {
            updatePatch.status = 'paid'
            if (detail?.paymentMethod) {
              updatePatch.payment_method = detail.paymentMethod
              const reg = cashRegisterFor(detail.paymentMethod)
              if (reg) updatePatch.cash_register_id = reg
            }
            // amount_cents апгрейдим только если basket дал ненулевую сумму
            // (типичный сценарий: в Booksy сначала записали, потом оплатили
            // и появилась basket с реальной суммой). Не трогаем если 0.
            if (amountCents > 0) updatePatch.amount_cents = amountCents
            if (isPrimary && (detail?.totalTipCents ?? 0) > 0)
              updatePatch.tip_cents = detail?.totalTipCents
            if (isPrimary && (detail?.totalDiscountCents ?? 0) > 0)
              updatePatch.discount_cents = detail?.totalDiscountCents
          }
          const { error: updErr } = await admin
            .from('visits')
            .update(updatePatch)
            .eq('id', existing.id)
          if (!updErr) {
            existingExt.add(externalId)
            stats.visits_synced! += 1
          }
        } else {
          const { error } = await admin.from('visits').insert({
            salon_id: salonId,
            staff_id: staffId,
            client_id: clientId,
            service_id: serviceId,
            service_name_snapshot: serviceName,
            visit_at: visitAtIso,
            duration_min: durationMin,
            amount_cents: amountCents,
            tip_cents: tipForVisit,
            discount_cents: discountForVisit,
            payment_method: paymentMethod,
            cash_register_id: cashRegisterFor(paymentMethod),
            status,
            source: 'booksy',
            external_id: externalId,
            external_reservation_id: String(apptUid),
            group_key: groupKey,
            comment: null,
          })
          if (!error) {
            existingExt.add(externalId)
            stats.visits_synced! += 1
          }
        }
      }
    }
  }

  // Применяем накопленные duration_min патчи одним батчем (по 100 строк).
  for (let i = 0; i < durationPatches.length; i += 100) {
    const chunk = durationPatches.slice(i, i + 100)
    await Promise.all(
      chunk.map((p) =>
        admin
          .from('visits')
          .update({ duration_min: p.duration_min })
          .eq('id', p.id)
          .is('duration_min', null),
      ),
    )
  }

  // Резервы времени (block-слоты) → staff_time_blocks
  await processReservations(admin, salonId, Array.from(reservationsByExtId.values()), stats)

  // Reverse-delete: всё, что было в портале и не пришло из Booksy в этот sync.
  // Делаем только если опросили хотя бы одну неделю успешно.
  if (fetchedRange.start && fetchedRange.end) {
    await reverseDeleteMissing(admin, salonId, {
      fetchedStart: fetchedRange.start,
      fetchedEnd: fetchedRange.end,
      seenVisitExtIds,
      seenReservationBooksyIds,
      stats,
    })
  }
}

// =============================================================================
// reverseDeleteMissing — удалить локальные booksy-записи, которых не стало в Booksy
// =============================================================================
// Визиты: soft-delete (deleted_at), только БУДУЩИЕ. Исторические сохраняем
// для отчётности — если booksy удалил прошлый визит, это либо ошибка либо
// чистка старья, локальная история выручки важнее.
//
// Резервы: hard-delete (нет финансового веса, можно).
async function reverseDeleteMissing(
  admin: SupabaseClient,
  salonId: string,
  args: {
    fetchedStart: Date
    fetchedEnd: Date
    seenVisitExtIds: Set<string>
    seenReservationBooksyIds: Set<string>
    stats: SyncStats
  },
): Promise<void> {
  const startIso = args.fetchedStart.toISOString()
  const endIso = args.fetchedEnd.toISOString()
  const nowIso = new Date().toISOString()

  // ── Визиты: будущие booksy-визиты в опрошенном окне, которых не пришло
  const { data: localFutureVisits } = await admin
    .from('visits')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('source', 'booksy')
    .is('deleted_at', null)
    .gte('visit_at', nowIso)
    .gte('visit_at', startIso)
    .lte('visit_at', endIso)
  let visitsDeleted = 0
  const visitIdsToDelete: string[] = []
  for (const v of localFutureVisits ?? []) {
    if (v.external_id && !args.seenVisitExtIds.has(v.external_id)) {
      visitIdsToDelete.push(v.id)
    }
  }
  if (visitIdsToDelete.length > 0) {
    const { error } = await admin
      .from('visits')
      .update({ deleted_at: nowIso })
      .in('id', visitIdsToDelete)
    if (error) {
      console.warn(`reverse-delete visits failed: ${error.message}`)
    } else {
      visitsDeleted = visitIdsToDelete.length
    }
  }

  // ── Резервы: все booksy-блоки в опрошенном окне, которых не пришло
  const { data: localBlocks } = await admin
    .from('staff_time_blocks')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'booksy')
    .gte('starts_at', startIso)
    .lte('starts_at', endIso)
  const blockIdsToDelete: string[] = []
  for (const b of localBlocks ?? []) {
    if (!b.external_id) continue
    // external_id формата 'res:{id}' или 'res:{id}:{stafferExt}' — берём числовой id
    const m = b.external_id.match(/^res:([^:]+)/)
    if (!m || !m[1]) continue
    if (!args.seenReservationBooksyIds.has(m[1])) blockIdsToDelete.push(b.id)
  }
  let blocksDeleted = 0
  if (blockIdsToDelete.length > 0) {
    const { error } = await admin.from('staff_time_blocks').delete().in('id', blockIdsToDelete)
    if (error) {
      console.warn(`reverse-delete blocks failed: ${error.message}`)
    } else {
      blocksDeleted = blockIdsToDelete.length
    }
  }

  if (visitsDeleted > 0 || blocksDeleted > 0) {
    console.log(`reverse-delete: ${visitsDeleted} visits, ${blocksDeleted} blocks`)
  }
  args.stats.visits_deleted = (args.stats.visits_deleted ?? 0) + visitsDeleted
  args.stats.reservations_deleted = (args.stats.reservations_deleted ?? 0) + blocksDeleted
}

// =============================================================================
// processReservations — «Rezerwacja czasu» (блокировки слотов мастера)
// =============================================================================
// Booksy возвращает резервы в /calendar ответе под ключом `reservations`.
// Записываем в staff_time_blocks с kind='reservation', external_source='booksy',
// external_id='res:{id}'. Календарь в портале уже рендерит блоки через
// useStaffBlocks — резервы появятся как штрихованные ячейки.

async function processReservations(
  admin: SupabaseClient,
  salonId: string,
  rawList: CalendarReservationRaw[],
  stats: SyncStats,
): Promise<void> {
  stats.reservations_synced = stats.reservations_synced ?? 0
  console.log(`reservations: found ${rawList.length} raw entries`)
  if (rawList.length === 0) return

  const { data: staffRows } = await admin
    .from('staff')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'booksy')
    .not('external_id', 'is', null)
  const staffByExtId = new Map<string, string>()
  for (const s of staffRows ?? []) {
    if (s.external_id) staffByExtId.set(s.external_id, s.id)
  }

  // Резервации, которые мы сами создали в Booksy при записи визитов в портале
  // (visits.external_reservation_id). Их нельзя импортировать обратно как
  // staff_time_blocks — будет наложение поверх визита (Image #20).
  const { data: portalOwnedRes } = await admin
    .from('visits')
    .select('external_reservation_id')
    .eq('salon_id', salonId)
    .not('external_reservation_id', 'is', null)
    .is('deleted_at', null)
  const portalOwnedReservationIds = new Set<string>()
  for (const v of portalOwnedRes ?? []) {
    if (v.external_reservation_id) portalOwnedReservationIds.add(String(v.external_reservation_id))
  }

  // Для cancel'а нужен appointment_uid, а не reservation.id — храним именно
  // его в staff_time_blocks.external_id чтобы delete-reservation работало
  // одинаково и для импортированных, и для созданных в портале блоков.
  const allExternalIds: string[] = []
  for (const r of rawList) {
    const apptUid = r.appointment_uid ?? r.id
    if (apptUid === undefined || apptUid === null) continue
    const resIds = extractReservationResourceIds(r)
    for (const stafferExt of resIds) {
      allExternalIds.push(buildReservationExternalId(String(apptUid), stafferExt, resIds.length))
    }
  }
  const existingExt = new Set<string>()
  if (allExternalIds.length > 0) {
    const { data: existing } = await admin
      .from('staff_time_blocks')
      .select('external_id')
      .eq('salon_id', salonId)
      .eq('external_source', 'booksy')
      .in('external_id', allExternalIds)
    for (const r of existing ?? []) {
      if (r.external_id) existingExt.add(r.external_id)
    }
  }

  for (const r of rawList) {
    const apptUid = r.appointment_uid ?? r.id
    if (apptUid === undefined || apptUid === null) continue
    // Skip: cancelled/no-show резервации Booksy продолжает возвращать
    // в /calendar какое-то время. Без этого фильтра удалённый в портале
    // блок сразу же импортируется обратно следующим sync'ом.
    if (r.status === 'C' || r.status === 'X' || r.status === 'N') continue
    // Skip: эта резервация создана нашим же порталом при записи визита.
    // Сравниваем по обоим возможным ключам (appointment_uid И reservation.id),
    // т.к. старые записи в visits.external_reservation_id могут хранить
    // ещё reservation.id (до фикса с lookup'ом).
    if (
      portalOwnedReservationIds.has(String(apptUid)) ||
      (r.id !== undefined && portalOwnedReservationIds.has(String(r.id)))
    )
      continue
    const from = r.reserved_from ?? r.booked_from
    const till = r.reserved_till ?? r.booked_till
    if (!from || !till) {
      console.warn(`reservation ${r.id} skipped: missing from/till`)
      continue
    }
    const resIds = extractReservationResourceIds(r)
    if (resIds.length === 0) {
      console.warn(`reservation ${r.id} skipped: no resources`)
      continue
    }

    // Booksy выдаёт время в локальной TZ салона без TZ-суффикса. Тот же
    // приём, что и для визитов (+02:00). DST не критичен для блоков
    // внутри суток.
    const startsAt = new Date(`${from}:00+02:00`).toISOString()
    const endsAt = new Date(`${till}:00+02:00`).toISOString()
    const label = (r.reason ?? r.description ?? '')?.trim() || null

    for (const stafferExt of resIds) {
      const staffUuid = staffByExtId.get(stafferExt)
      if (!staffUuid) {
        console.warn(`reservation ${apptUid}: staff_ext=${stafferExt} not mapped`)
        continue
      }
      const blockExternalId = buildReservationExternalId(String(apptUid), stafferExt, resIds.length)
      if (existingExt.has(blockExternalId)) continue

      const { error } = await admin.from('staff_time_blocks').upsert(
        {
          salon_id: salonId,
          staff_id: staffUuid,
          kind: 'reservation',
          starts_at: startsAt,
          ends_at: endsAt,
          label,
          external_source: 'booksy',
          external_id: blockExternalId,
        },
        { onConflict: 'salon_id,external_source,external_id', ignoreDuplicates: true },
      )
      if (!error) {
        existingExt.add(blockExternalId)
        stats.reservations_synced! += 1
      } else {
        console.warn(`reservation upsert ${blockExternalId}: ${error.message}`)
      }
    }
  }
  console.log(`reservations: imported ${stats.reservations_synced}`)
}

function extractReservationResourceIds(r: CalendarReservationRaw): string[] {
  const out: string[] = []
  for (const item of r.resources ?? []) {
    const rawId = typeof item === 'number' ? item : item?.id
    if (rawId !== undefined && rawId !== null) out.push(String(rawId))
  }
  return out
}

function buildReservationExternalId(
  id: string,
  stafferExt: string,
  totalResources: number,
): string {
  return totalResources > 1 ? `res:${id}:${stafferExt}` : `res:${id}`
}

// =============================================================================
// syncReservations — fallback: отдельный GET /reservations/ если в /calendar пусто
// =============================================================================
//
// Booksy /me/businesses/{biz}/reservations/ — это блоки времени, которые
// мастер резервирует на свои дела (pererwa, блогер, осмотр и т.п.). В
// календаре они рисуются полупрозрачным прямоугольником с reason. В нашем
// портале аналог — staff_time_blocks (kind='reservation').
//
// Стратегия: тянем за последние 60 дней + 60 вперёд (тот же window, что и
// /calendar), upsert по (salon_id, external_source='booksy', external_id='res:{id}').
// Игнорируем существующие — резервации portal-owned: после первого импорта
// юзер может отредактировать label/время в портале и Booksy его не перетрёт.

async function syncReservationsFallback(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  businessId: number,
  stats: SyncStats,
): Promise<void> {
  // Если /calendar не вернул reservations — пробуем отдельный endpoint
  // /me/businesses/{biz}/reservations/. Параметры точно не задокументированы;
  // пробуем варианты, логируем ответы для диагностики.
  const now = new Date()
  const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
  const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
  const fmtDt = (d: Date) => `${fmtDate(d)}T${d.toISOString().slice(11, 16)}`

  const urls = [
    `/me/businesses/${businessId}/reservations/?reserved_from=${fmtDt(start)}&reserved_till=${fmtDt(end)}`,
    `/me/businesses/${businessId}/reservations/?reserved_from=${fmtDate(start)}&reserved_till=${fmtDate(end)}`,
    `/me/businesses/${businessId}/reservations/?start_date=${fmtDate(start)}&end_date=${fmtDate(end)}`,
    `/me/businesses/${businessId}/reservations/`,
  ]

  type ReservationsResp = {
    reservations?: CalendarReservationRaw[] | Record<string, CalendarReservationRaw>
  }

  for (const url of urls) {
    const res = await booksyGet<ReservationsResp>(url, accessToken)
    if (!res.ok) {
      console.log(`reservations fallback ${url} → ${res.status} ${res.reason}`)
      continue
    }
    const raw = res.data
    const list = Array.isArray(raw.reservations)
      ? raw.reservations
      : Object.values(raw.reservations ?? {})
    console.log(`reservations fallback ${url} → ${list.length} entries`)
    if (list.length > 0) {
      await processReservations(admin, salonId, list, stats)
      return
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
  opts?: { visitsRange?: { start: Date; end: Date } },
): Promise<SyncStats> {
  const stats: SyncStats = {}
  const tierTimestamps: Record<string, string> = {}
  const nowIso = new Date().toISOString()
  const isNarrowVisits = !!opts?.visitsRange

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
    await syncVisits(
      admin,
      salonId,
      accessToken,
      businessId,
      config,
      stats,
      opts?.visitsRange
        ? { rangeStart: opts.visitsRange.start, rangeEnd: opts.visitsRange.end }
        : undefined,
    )
    // Fallback на отдельный /reservations endpoint только в полном sync —
    // в day-mode мы знаем что reservations пришли из этого же /calendar.
    if (!isNarrowVisits && (!stats.reservations_synced || stats.reservations_synced === 0)) {
      await syncReservationsFallback(admin, salonId, accessToken, businessId, stats)
    }
    // last_sync_at обновляем ТОЛЬКО при полном sync. Day-sync — side channel,
    // не должен сбивать cron-таймер (иначе фон ±60д перестанет крутиться).
    if (!isNarrowVisits) tierTimestamps.last_sync_at = nowIso
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
    let parsed: { reservation?: { id?: number | string }; id?: number | string } = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      // ignore
    }
    // Booksy наблюдалось две формы ответа: {reservation:{id}} и {id}.
    // Пытаемся обе.
    const reservationId = parsed.reservation?.id
      ? String(parsed.reservation.id)
      : parsed.id
        ? String(parsed.id)
        : null
    console.log(
      `create_reservation result: visit_id=${input.visit_id ?? 'none'} reservation_id=${reservationId}`,
    )

    // Для cancel'а Booksy нужен appointment_uid (не reservation.id) — это
    // отдельная umbrella-сущность над резервацией. POST /reservations/ его
    // не возвращает, поэтому делаем follow-up GET /calendar за дату резерва.
    let appointmentUid: string | null = null
    if (reservationId) {
      const dateOnly = input.start_at.slice(0, 10) // YYYY-MM-DD из ISO
      const calRes = await fetch(
        `${BOOKSY_API}/me/businesses/${creds.business_id}/calendar?start_date=${dateOnly}&end_date=${dateOnly}&include_unconfirmed=true&version=3&resources_per_page=100`,
        { headers: booksyHeaders(creds.access_token) },
      )
      if (calRes.ok) {
        const calData = (await calRes.json()) as {
          reservations?:
            | Record<string, { id?: number | string; appointment_uid?: number | string }>
            | { id?: number | string; appointment_uid?: number | string }[]
        }
        const list = Array.isArray(calData.reservations)
          ? calData.reservations
          : Object.values(calData.reservations ?? {})
        const found = list.find((r) => String(r.id) === reservationId)
        if (found?.appointment_uid) appointmentUid = String(found.appointment_uid)
      }
      console.log(`appointment_uid lookup for reservation=${reservationId}: ${appointmentUid}`)
    }

    // Сохраняем appointment_uid (а не reservation.id). Cancel идёт через
    // POST /appointments/{uid}/action/. Fallback на id если lookup упал.
    const storedId = appointmentUid ?? reservationId
    if (storedId && input.visit_id) {
      const { error: updErr } = await admin
        .from('visits')
        .update({ external_reservation_id: storedId })
        .eq('id', input.visit_id)
        .eq('salon_id', salonId)
      if (updErr) {
        console.warn(
          `visits.external_reservation_id update failed for visit=${input.visit_id}: ${updErr.message}`,
        )
      } else {
        console.log(
          `saved external_reservation_id=${storedId} (appt_uid=${appointmentUid ?? 'fallback-to-id'}) on visit=${input.visit_id}`,
        )
      }
    }
    return jsonResponse({ ok: true, reservation_id: storedId })
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
    console.log(
      `delete_reservation: business=${creds.business_id} appointment_uid=${reservationId}`,
    )
    // Booksy DELETE /reservations/{id}/ возвращает 302 redirect на booksy.com
    // — endpoint просто не существует, наш fetch следовал redirect и считал
    // его успехом. Корректная отмена идёт через action endpoint:
    //   POST /appointments/{appointment_uid}/action/ {action:"cancel", _version}.
    // _version берём из GET /appointments/{uid}/ (требуется Booksy для
    // optimistic locking).
    const apptRes = await fetch(
      `${BOOKSY_API}/me/businesses/${creds.business_id}/appointments/${encodeURIComponent(reservationId)}/`,
      { headers: booksyHeaders(creds.access_token) },
    )
    if (!apptRes.ok) {
      const txt = await apptRes.text()
      console.warn(`delete_reservation: GET appointment ${reservationId} → ${apptRes.status}`)
      // 404 — уже нет или передан неверный uid; считаем что отменено
      if (apptRes.status === 404) return jsonResponse({ ok: true, note: 'already_gone' })
      return jsonResponse(
        {
          ok: false,
          error: 'lookup_failed',
          status: apptRes.status,
          message: txt.slice(0, 300),
        },
        502,
      )
    }
    const apptData = (await apptRes.json()) as {
      appointment?: { _version?: number | string; status?: string }
    }
    const version = apptData.appointment?._version
    if (version === undefined) {
      console.warn(`delete_reservation: no _version in appointment ${reservationId}`)
      return jsonResponse({ ok: false, error: 'no_version' }, 502)
    }
    if (apptData.appointment?.status === 'C' || apptData.appointment?.status === 'X') {
      console.log(`delete_reservation: appointment ${reservationId} already cancelled`)
      return jsonResponse({ ok: true, note: 'already_cancelled' })
    }
    const cancelRes = await fetch(
      `${BOOKSY_API}/me/businesses/${creds.business_id}/appointments/${encodeURIComponent(reservationId)}/action/`,
      {
        method: 'POST',
        headers: booksyHeaders(creds.access_token),
        body: JSON.stringify({ action: 'cancel', _version: version }),
      },
    )
    console.log(`delete_reservation: cancel action status=${cancelRes.status}`)
    if (!cancelRes.ok) {
      const txt = await cancelRes.text()
      console.warn(`delete_reservation booksy cancel failed: ${txt.slice(0, 300)}`)
      return jsonResponse(
        {
          ok: false,
          error: 'cancel_failed',
          status: cancelRes.status,
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
  opts?: { visitsRange?: { start: Date; end: Date } },
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
      opts,
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
  day?: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  // Day-sync — только visits для указанного дня (без catalog/clients).
  // Full sync — все 3 tier'а, ±60 дней визиты.
  if (day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
    if (!m) return jsonResponse({ ok: false, error: 'invalid_day_format' }, 400)
    const dayStart = new Date(`${day}T00:00:00Z`)
    const dayEnd = new Date(`${day}T23:59:59Z`)
    const res = await runSyncForSalon(admin, salonId, ['visits'], {
      visitsRange: { start: dayStart, end: dayEnd },
    })
    if (!res.ok) {
      return jsonResponse({ ok: false, error: 'sync_failed', message: res.message }, res.status)
    }
    return jsonResponse({ ok: true, stats: res.stats, day })
  }
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
      day?: string
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
        return handleSync(admin, userId, body.salon_id, body.day)
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
