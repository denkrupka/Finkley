/**
 * booksy-proxy — интеграция с Booksy (PL marketplace бронирования).
 *
 * Auth-flow (Метод 3 — proxy form):
 *   1) SPA рендерит форму с invisible hCaptcha (sitekey того же Booksy)
 *   2) Юзер вводит email/password, hcaptcha.execute() → captcha_token
 *   3) SPA шлёт {action:'login', salon_id, email, password, captcha_token}
 *   4) Edge function проксит POST на pl.booksy.com/core/v2/business_api/account/login
 *      с x-hcaptcha-token + x-api-key + x-fingerprint
 *   5) Получаем access_token + account info → сохраняем в salon_integrations
 *
 * Fallback (если Booksy вернул request_blocked):
 *   action='login_with_token' — юзер сам вытащил access_token из DevTools и вставил.
 *
 * Sync-flow:
 *   action='sync' → /me/businesses/{biz_id}/resources, service_categories, calendar
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Статичные данные Booksy frontdesk API
const BOOKSY_API = 'https://pl.booksy.com/core/v2/business_api'
const BOOKSY_X_API_KEY = 'frontdesk-76661e2b-25f0-49b4-b33a-9d78957a58e3'
const BOOKSY_X_APP_VERSION = '3.0'
// Хардкод fingerprint как у KIK (Booksy его пока не валидирует строго)
const BOOKSY_X_FINGERPRINT = 'bef920d1-c754-481e-9c13-343690248481'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

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
  account: {
    id: number
    email: string
    first_name: string
    last_name: string
  }
  access_rights?: { access_level: string }
}

type BooksyError = {
  errors?: { code?: string; message?: string }[]
}

/**
 * Распознаём ошибки от Booksy и переводим в человеческий статус.
 * - 401/403 + errors[0].code === 'request_blocked' → 'request_blocked'
 *   (защита Booksy сработала, нужен fallback на ручной токен)
 * - 401/403 без блокировки → 'invalid_credentials'
 * - 429 → 'rate_limited'
 */
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
// Sync logic — Booksy → Finkley
// =============================================================================

type SyncStats = {
  staff_synced: number
  services_synced: number
  visits_synced: number
}

async function syncBooksyData(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  businessId: number,
): Promise<SyncStats> {
  const stats: SyncStats = { staff_synced: 0, services_synced: 0, visits_synced: 0 }

  // 1) Staff (resources) — идемпотентно по external_id (resource_id из Booksy).
  //    Имя обновляем при изменении (Booksy может переименовать). Старые
  //    by-name записи (созданные до этого фикса) переживём — те пишутся
  //    параллельно и без external_id, юзер сольёт руками если надо.
  type ResourcesResp = { resources?: { id: number; name: string; is_active?: boolean }[] }
  const resourcesRes = await booksyGet<ResourcesResp>(
    `/me/businesses/${businessId}/resources`,
    accessToken,
  )
  if (!resourcesRes.ok) throw new Error(`resources_${resourcesRes.reason}`)
  for (const r of resourcesRes.data.resources ?? []) {
    const extId = String(r.id)
    let { data: existing } = await admin
      .from('staff')
      .select('id')
      .eq('salon_id', salonId)
      .eq('external_source', 'booksy')
      .eq('external_id', extId)
      .maybeSingle()
    // Fallback by-name (для записей, синканутых до введения external_id)
    if (!existing) {
      const { data: byName } = await admin
        .from('staff')
        .select('id')
        .eq('salon_id', salonId)
        .eq('full_name', r.name)
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
    if (existing) {
      await admin
        .from('staff')
        .update({ full_name: r.name, is_active: r.is_active !== false })
        .eq('id', existing.id)
    } else {
      await admin.from('staff').insert({
        salon_id: salonId,
        full_name: r.name,
        payout_scheme: 'percent_revenue',
        payout_percent: 40,
        is_active: r.is_active !== false,
        external_source: 'booksy',
        external_id: extId,
      })
      stats.staff_synced++
    }
  }

  // 2) Services — то же самое: lookup по external_id, апдейт цены/длительности.
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
      let { data: existing } = await admin
        .from('services')
        .select('id')
        .eq('salon_id', salonId)
        .eq('external_source', 'booksy')
        .eq('external_id', extId)
        .maybeSingle()
      if (!existing) {
        const { data: byName } = await admin
          .from('services')
          .select('id')
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
        await admin
          .from('services')
          .update({
            name: s.name,
            default_price_cents: priceCents,
            default_duration_min: s.duration ?? null,
          })
          .eq('id', existing.id)
      } else {
        await admin.from('services').insert({
          salon_id: salonId,
          name: s.name,
          default_price_cents: priceCents,
          default_duration_min: s.duration ?? null,
          external_source: 'booksy',
          external_id: extId,
        })
        stats.services_synced++
      }
    }
  }

  // 3) Visits — последние 30 дней + 7 вперёд через GET /calendar.
  //    Booksy возвращает один subbooking = одно "booking" в calendar response.
  //    Цены в calendar нет — берём из synced services по имени (если 0 — visit
  //    создаём с amount=0, юзер дозаполнит). Только status='F' (finished).
  await syncVisits(admin, salonId, accessToken, businessId, stats)

  return stats
}

type CalendarBooking = {
  id: number
  appointment_uid: number
  booked_from: string // "2026-05-07T10:00"
  booked_till: string
  status: string // 'F' = finished, 'A' = active, 'X' = cancelled, etc.
  type: string
  resources?: { id: number }[]
  service?: { id: number; name: string }
  customer?: { id: number; name?: string; phone?: string }
}

type CalendarResp = {
  bookings?: Record<string, CalendarBooking>
}

/**
 * Caches для резолва Booksy ID → наш UUID, чтобы не бить БД на каждый
 * booking при синке визитов. Все три таблицы — staff/services/clients —
 * имеют external_id (booksy: resource.id / service.id / customer.id).
 */
type Caches = {
  staffByExtId: Map<string, string>
  serviceByExtId: Map<string, { id: string; price: number }>
  clientByExtId: Map<string, string>
}

async function buildCaches(admin: SupabaseClient, salonId: string): Promise<Caches> {
  const caches: Caches = {
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

/**
 * Маппинг Booksy payment_type_code → наш payment_method enum.
 * Booksy реально отдаёт: cash, credit_card, tap_to_pay, split, egift_card,
 * blik, terminal_card, prepayment. 'transfer' Booksy НЕ использует —
 * банковские переводы там не пробивают. Поэтому мы 'transfer' не выставляем
 * автоматически из Booksy: всё нераспознанное → 'cash' (default для PL).
 *
 * Наш enum: 'cash', 'card', 'transfer', 'online', 'mixed'.
 */
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
      if (code) console.warn(`unknown booksy payment_type_code: ${code}, falling back to cash`)
      return 'cash'
  }
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
      transaction_info?: {
        payment_type_code?: string
        total?: string
      } | null
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
    business_customer?: { full_name?: string; cell_phone?: string; first_name?: string }
  }
}

type BasketItem = {
  id: string
  name_line_1?: string
  total?: number // в копейках уже (basket items приходят в копейках!)
}

type BasketResponse = {
  result?: {
    total_elements?: { type: string; amount: { amount: number } }[]
    payments_summary?: { payment_type?: { code?: string } }
    items?: BasketItem[]
  }
}

/**
 * POST /pos/transactions с dry_run=true возвращает rows с item_price даже
 * для услуг с публично скрытой ценой ("Nie pokazuj"). Используем для:
 *   - получения реальной цены будущих/неоплаченных визитов (серый учёт)
 *   - обновления default_price_cents в наших services
 *
 * Booksy позволяет dry_run только для существующих booking_id (subbooking).
 */
type DryRunResp = {
  transaction?: {
    rows?: {
      booking_id?: number | null
      product_id?: number | null
      service_variant_id?: number | null
      item_price?: number
      total?: number
      commission_staffer_id?: number | null
    }[]
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
  stats: SyncStats,
): Promise<void> {
  const caches = await buildCaches(admin, salonId)

  // Bulk-load уже импортированных visits.external_id → можно пропустить
  // тяжёлый GET /appointments/{uid} если ВСЕ subbookings уже в БД.
  const { data: existingVisits } = await admin
    .from('visits')
    .select('external_id')
    .eq('salon_id', salonId)
    .eq('source', 'booksy')
    .is('deleted_at', null)
  const existingExternalIds = new Set<string>()
  for (const r of existingVisits ?? []) {
    if (r.external_id) existingExternalIds.add(r.external_id)
  }

  // Timeout-safe budget: edge function умирает через 60s, режемся пораньше.
  // Если не уложились — следующий cron-tick (через 2-60 мин) добъёт остаток.
  const startTs = Date.now()
  const BUDGET_MS = 45_000

  // Период: 60 дней назад .. 60 дней вперёд (для прогноза)
  const now = new Date()
  const start = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
  const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

  // 1) Собираем bookings по неделям. Импортируем все статусы кроме отменённых.
  //    Booksy статусы: F=finished, A=active, C=confirmed, X=cancelled, N=no-show.
  const apptUidToBookings = new Map<number, CalendarBooking[]>()
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 7)) {
    const periodStart = fmtDate(cursor)
    const weekEnd = new Date(cursor)
    weekEnd.setDate(weekEnd.getDate() + 6)
    if (weekEnd > end) weekEnd.setTime(end.getTime())
    const periodEnd = fmtDate(weekEnd)

    const url =
      `/me/businesses/${businessId}/calendar` +
      `?start_date=${periodStart}&end_date=${periodEnd}` +
      `&include_unconfirmed=true&version=3&resources_per_page=100`
    const calRes = await booksyGet<CalendarResp>(url, accessToken)
    if (!calRes.ok) throw new Error(`calendar_${calRes.reason}`)

    for (const b of Object.values(calRes.data.bookings ?? {})) {
      if (b.status === 'X' || b.status === 'N') continue // отменённые/no-show
      if (!b.appointment_uid) continue
      const arr = apptUidToBookings.get(b.appointment_uid) ?? []
      arr.push(b)
      apptUidToBookings.set(b.appointment_uid, arr)
    }
  }

  // 2) Для каждого appointment: GET detail → создаём ОДИН visit per subbooking.
  //    Так выручка по услугам считается корректно, а multi-service записи видны
  //    в списке как несколько строк (мастер/услуга/сумма у каждой свои).
  for (const [apptUid, bookings] of apptUidToBookings) {
    if (Date.now() - startTs > BUDGET_MS) {
      console.warn(`sync budget reached, deferring rest to next tick`)
      break
    }

    // Если ВСЕ booking.id (= subbooking.id) этого appointment уже в БД —
    // пропускаем тяжёлый detail-fetch. Огромный выигрыш на повторном синке.
    const allKnown = bookings.every((b) => existingExternalIds.has(`subbk:${b.id}`))
    if (allKnown) continue

    const detailRes = await booksyGet<AppointmentDetail>(
      `/me/businesses/${businessId}/appointments/${apptUid}/`,
      accessToken,
    )
    if (!detailRes.ok) {
      console.warn(`appointment ${apptUid} fetch failed:`, detailRes.reason)
      continue
    }
    const a = detailRes.data.appointment
    const customer = bookings[0].customer
    if (!customer?.id) continue

    const isPaid = a.status === 'F' && !!a.basket_id

    // Find or create client (один на appointment, общий для всех subbookings)
    const clientExtId = String(customer.id)
    let clientId = caches.clientByExtId.get(clientExtId) ?? null
    if (!clientId) {
      const profile = detailRes.data.customer?.customer_profile
      const name = profile?.full_name?.trim() || customer.name || 'Booksy client'
      const phone = profile?.cell_phone?.trim() || customer.phone || null
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
      if (insErr) {
        console.warn(`client insert failed for ext=${clientExtId}:`, insErr.message)
      }
      if (newClient) {
        clientId = newClient.id
        caches.clientByExtId.set(clientExtId, clientId)
      }
    }

    // Грузим basket (для оплаченных) — там реальные цены per-item, payment_method,
    // tips. Делаем один раз на appointment, мапим items на subbookings по name.
    let basketItems: BasketItem[] = []
    let paymentMethod: 'cash' | 'card' | 'transfer' | 'online' | 'mixed' = 'cash'
    let totalTipCents = 0
    let totalDiscountCents = 0
    if (isPaid && a.basket_id) {
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

    // Маппим subbookings → calendar bookings (по subbk.id == calendar booking.id)
    // и → basket items (по имени услуги).
    const subbookings = a.subbookings ?? []
    const list = subbookings.length
      ? subbookings
      : bookings.map((b) => ({
          id: b.id,
          booked_from: b.booked_from,
          staffer_id: b.resources?.[0]?.id ?? null,
          service: { name: b.service?.name, id: b.service?.id },
        }))

    // dry_run для всех bookings разом, если default цены пустые
    let dryRunByBookingId = new Map<number, number>() // booking_id → cents
    if (!isPaid) {
      const needDryRun = list.some((s) => {
        const svcId = s.service?.id
        const cached = svcId ? caches.serviceByExtId.get(String(svcId)) : undefined
        return !cached || cached.price === 0
      })
      if (needDryRun) {
        const ids = list.map((s) => s.id).filter((id): id is number => !!id)
        if (ids.length > 0) {
          const dr = await dryRunForBookings(accessToken, businessId, ids)
          for (const row of dr?.transaction?.rows ?? []) {
            if (typeof row.booking_id === 'number' && typeof row.total === 'number') {
              dryRunByBookingId.set(row.booking_id, Math.round(row.total * 100))
            }
          }
        }
      }
    }

    // group_key для multi-service записи — UI свернёт визиты в раскрывашку
    const groupKey = list.length > 1 ? `booksy:appt:${apptUid}` : null

    // Создаём visit per subbooking
    for (let i = 0; i < list.length; i++) {
      const sub = list[i]
      if (!sub) continue
      const externalId = `subbk:${sub.id}`
      // Используем bulk-loaded set вместо отдельного запроса в БД (быстрее)
      if (existingExternalIds.has(externalId)) continue

      const stafferId = sub.staffer_id ?? bookings[0].resources?.[0]?.id ?? null
      const staffId = stafferId ? (caches.staffByExtId.get(String(stafferId)) ?? null) : null
      const svcExtId = sub.service?.id
      const svcCached = svcExtId ? caches.serviceByExtId.get(String(svcExtId)) : undefined
      const serviceId = svcCached?.id ?? null
      const serviceName = sub.service?.name ?? 'Service'

      // Цена: 1) basket item match by name, 2) dry_run, 3) default service price
      let amountCents = 0
      if (isPaid && basketItems.length) {
        const item = basketItems.find((it) =>
          (it.name_line_1 ?? '').toLowerCase().startsWith(serviceName.toLowerCase()),
        )
        if (item?.total) amountCents = item.total
      }
      if (amountCents === 0) {
        amountCents = dryRunByBookingId.get(sub.id) ?? svcCached?.price ?? 0
      }

      // Time из subbooking (точнее чем appointment.booked_from)
      const visitAtIso = new Date(sub.booked_from + ':00+02:00').toISOString()

      // Tips/discount пишем только в первый subbooking (агрегатно), чтобы не
      // дублировать в выручке. KPI считаются по визитам — один раз учтётся.
      const isPrimary = i === 0
      const tipForVisit = isPrimary ? totalTipCents : 0
      const discountForVisit = isPrimary ? totalDiscountCents : 0

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
          payment_method: paymentMethod, // для pending UI скроет (status-driven)
          status: isPaid ? 'paid' : 'pending',
          source: 'booksy',
          external_id: externalId,
          group_key: groupKey,
          comment: null,
        },
        { onConflict: 'salon_id,source,external_id', ignoreDuplicates: true },
      )
      if (!error) {
        existingExternalIds.add(externalId)
        stats.visits_synced++
      }
    }
  }
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
  const { error } = await admin.from('salon_integrations').upsert(
    {
      salon_id: salonId,
      provider: 'booksy',
      status: 'connected',
      credentials,
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
      {
        ok: false,
        error: loginRes.reason,
        message: `Booksy returned ${loginRes.status}`,
      },
      httpStatus,
    )
  }

  type BusinessesResp = { businesses?: { id: number; name: string }[] }
  const bizRes = await booksyGet<BusinessesResp>('/me/businesses', loginRes.data.access_token)
  if (!bizRes.ok) {
    return jsonResponse({ ok: false, error: 'businesses_fetch_failed', reason: bizRes.reason }, 502)
  }
  const business = bizRes.data.businesses?.[0]
  if (!business) {
    return jsonResponse({ ok: false, error: 'no_businesses_in_account' }, 400)
  }

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

/**
 * Fallback: юзер сам вытащил access_token из DevTools (когда Booksy
 * заблокировал прямой логин с request_blocked).
 */
async function handleLoginWithToken(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  accessToken: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }

  // Валидируем токен через /me/businesses
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

  // Эмулируем структуру login response
  const synthLogin: BooksyLoginResponse = {
    access_token: accessToken,
    account: {
      id: 0,
      email: 'manual-token',
      first_name: 'Manual',
      last_name: 'Token',
    },
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

/**
 * Удаляет все визиты с source='booksy' для очистки данных перед свежим синком.
 * Используется при миграции на новый формат external_id или для re-import.
 * НЕ удаляет staff/services/clients — они полезны и без визитов.
 */
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

/** Общая логика синка (используется и для user-trigger, и для cron). */
async function runSyncForSalon(
  admin: SupabaseClient,
  salonId: string,
): Promise<{ ok: true; stats: SyncStats } | { ok: false; status: number; message: string }> {
  const { data: integration } = await admin
    .from('salon_integrations')
    .select('credentials')
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')
    .maybeSingle()
  if (!integration) return { ok: false, status: 404, message: 'not_connected' }

  const creds = integration.credentials as { access_token: string; business_id: number }

  let stats: SyncStats
  try {
    stats = await syncBooksyData(admin, salonId, creds.access_token, creds.business_id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin
      .from('salon_integrations')
      .update({ status: 'error', last_error: msg })
      .eq('salon_id', salonId)
      .eq('provider', 'booksy')
    return { ok: false, status: 502, message: msg }
  }

  await admin
    .from('salon_integrations')
    .update({
      status: 'connected',
      last_sync_at: new Date().toISOString(),
      last_sync_stats: stats,
      last_error: null,
    })
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
  const res = await runSyncForSalon(admin, salonId)
  if (!res.ok) {
    return jsonResponse({ ok: false, error: 'sync_failed', message: res.message }, res.status)
  }
  return jsonResponse({ ok: true, stats: res.stats })
}

/** Cron-запуск синка с rendezvous-token (без user JWT). */
async function handleCronSyncOne(
  admin: SupabaseClient,
  salonId: string,
  token: string,
): Promise<Response> {
  // Валидируем + помечаем токен использованным атомарно
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
  const res = await runSyncForSalon(admin, salonId)
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

// =============================================================================
// Entry
// =============================================================================

Deno.serve(async (req: Request) => {
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

  // Cron action: проверяем rendezvous-token, без user JWT
  if (body.action === 'cron_sync_one') {
    if (!body.token) return jsonResponse({ ok: false, error: 'token_required' }, 400)
    return handleCronSyncOne(admin, body.salon_id, body.token)
  }

  // Все остальные actions требуют user JWT
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
    default:
      return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
  }
})
